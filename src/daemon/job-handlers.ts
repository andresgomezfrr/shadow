import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { ShadowConfig } from '../config/schema.js';
import type { ShadowDatabase } from '../storage/database.js';
import type { EventBus } from '../web/event-bus.js';

// --- Types ---

export type JobHandlerResult = {
  llmCalls: number;
  tokensUsed: number;
  phases: string[];
  result: Record<string, unknown>;
};

export type JobContext = {
  jobId: string;
  config: ShadowConfig;
  db: ShadowDatabase;
  eventBus: EventBus;
  setPhase: (phase: string | null) => void;
};

export type DaemonSharedState = {
  lastHeartbeatAt: string | null;
  nextHeartbeatAt: string | null;
  lastConsolidationAt: string | null;
  pendingGitEvents: Array<{ repoId: string; repoName: string; type: string; ts: string }>;
  pendingRemoteSyncResults: Array<{ repoId: string; repoName: string; newRemoteCommits: number; behindBranches: Array<{ branch: string; behind: number; ahead: number }>; newCommitMessages: string[] }>;
  activeProjects: Array<{ projectId: string; projectName: string; score: number }>;
  consecutiveIdleTicks: number;
};

export type JobCategory = 'llm' | 'io';

export type JobHandlerEntry = {
  category: JobCategory;
  fn: (ctx: JobContext, shared: DaemonSharedState) => Promise<JobHandlerResult>;
};

// --- Helpers ---

/** Query items created during this job's execution for result enrichment */
function recentItems(db: ShadowDatabase, table: 'memories' | 'observations' | 'suggestions', since: string, limit = 5): Array<{ id: string; title: string }> {
  if (table === 'memories') {
    return db.listMemories({ createdSince: since, limit }).map(m => ({ id: m.id, title: m.title }));
  }
  if (table === 'observations') {
    return db.listObservations({ limit: limit * 2 })
      .filter(o => o.createdAt >= since)
      .slice(0, limit)
      .map(o => ({ id: o.id, title: o.title }));
  }
  // suggestions
  return db.listSuggestions({ limit: limit * 2 })
    .filter(s => s.createdAt >= since)
    .slice(0, limit)
    .map(s => ({ id: s.id, title: s.title }));
}

// --- Handlers ---

async function handleHeartbeat(ctx: JobContext, shared: DaemonSharedState): Promise<JobHandlerResult> {
  const { config, db, eventBus } = ctx;
  const jobStart = new Date().toISOString();

  // Get last completed heartbeat for context (the claimed one is now 'running', skip it)
  const previousHeartbeat = db.listJobs({ type: 'heartbeat', status: 'completed', limit: 1 })[0] ?? null;

  ctx.setPhase('observe');

  // Detect active projects from recent interactions + conversations
  let detectedProjects: Array<{ projectId: string; projectName: string; score: number }> = [];
  try {
    const { detectActiveProjects } = await import('../heartbeat/project-detection.js');
    const sinceIso = previousHeartbeat?.startedAt
      ? previousHeartbeat.startedAt
      : new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const sinceMs = new Date(sinceIso).getTime();

    // Load recent interactions
    let recentInteractions: Array<{ file: string; tool: string; ts: string }> = [];
    try {
      const intPath = resolve(config.resolvedDataDir, 'interactions.jsonl');
      const lines = readFileSync(intPath, 'utf8').trim().split('\n').filter(Boolean);
      recentInteractions = lines.flatMap(line => {
        try {
          const e = JSON.parse(line) as { ts: string; tool: string; file?: string };
          return new Date(e.ts).getTime() > sinceMs ? [{ ts: e.ts, tool: e.tool, file: e.file ?? '' }] : [];
        } catch { return []; }
      });
    } catch { /* no file */ }

    // Load recent conversations
    let recentConvTexts: Array<{ text: string }> = [];
    try {
      const convPath = resolve(config.resolvedDataDir, 'conversations.jsonl');
      const lines = readFileSync(convPath, 'utf8').trim().split('\n').filter(Boolean);
      recentConvTexts = lines.flatMap(line => {
        try {
          const e = JSON.parse(line) as { ts: string; text?: string };
          return new Date(e.ts).getTime() > sinceMs && e.text ? [{ text: e.text }] : [];
        } catch { return []; }
      });
    } catch { /* no file */ }

    detectedProjects = detectActiveProjects(db, recentInteractions, recentConvTexts);
    if (detectedProjects.length > 0) {
      console.error(`[daemon] Active projects: ${detectedProjects.map(p => `${p.projectName}(${p.score.toFixed(0)})`).join(', ')}`);
    }
  } catch (e) {
    console.error('[daemon] Project detection failed:', e instanceof Error ? e.message : e);
  }

  // Persist to daemon state
  shared.activeProjects = detectedProjects;

  // Build enrichment context from cached MCP data
  let enrichmentCtx: string | undefined;
  try {
    const { buildEnrichmentContext } = await import('../heartbeat/enrichment.js');
    enrichmentCtx = buildEnrichmentContext(db);
  } catch { /* enrichment not available */ }

  ctx.setPhase('analyze');

  const { runHeartbeat } = await import('../heartbeat/state-machine.js');

  // Drain sensor data for heartbeat context
  const gitEvents = shared.pendingGitEvents.splice(0);
  const remoteSyncData = shared.pendingRemoteSyncResults.splice(0);

  const profile = db.ensureProfile();
  const pendingEvts = db.listPendingEvents().length;

  const result = await runHeartbeat({
    config, db, profile, lastHeartbeat: previousHeartbeat, pendingEventCount: pendingEvts,
    pendingGitEvents: gitEvents.length > 0 ? gitEvents : undefined,
    remoteSyncResults: remoteSyncData.length > 0 ? remoteSyncData : undefined,
    enrichmentContext: enrichmentCtx,
    activeProjects: detectedProjects.length > 0 ? detectedProjects : undefined,
  });

  // Enrich result with titles of what was produced
  // Only query if heartbeat actually created items (avoid capturing parallel job output)
  const observationItems = result.observationsCreated > 0
    ? recentItems(db, 'observations', jobStart, result.observationsCreated)
    : [];
  const memoryItems = recentItems(db, 'memories', jobStart);
  const reposAnalyzed = db.listRepos().map(r => r.name);

  const handlerResult: JobHandlerResult = {
    llmCalls: result.llmCalls, tokensUsed: result.tokensUsed, phases: result.phases,
    result: {
      observationsCreated: result.observationsCreated,
      ...(observationItems.length > 0 && { observationItems }),
      memoriesCreated: memoryItems.length,
      ...(memoryItems.length > 0 && { memoryItems }),
      reposAnalyzed,
    },
  };

  // Update shared timestamps (caller reads these after handler returns)
  shared.lastHeartbeatAt = new Date().toISOString();
  shared.nextHeartbeatAt = new Date(Date.now() + config.activityHeartbeatMaxIntervalMs).toISOString();

  // Emit SSE event
  eventBus.emit({ type: 'heartbeat:complete', data: { jobId: ctx.jobId } });

  // Post-heartbeat: consolidate similar observations
  try {
    const { consolidateObservations } = await import('../observation/consolidation.js');
    const obsMerged = await consolidateObservations(db);
    if (obsMerged > 0) console.error(`[daemon] Consolidated ${obsMerged} similar observations`);
  } catch { /* ignore */ }

  // Post-heartbeat: reactive suggest boost (only if many observations + enough gap)
  const observationsCreated = (handlerResult.result.observationsCreated as number) ?? 0;
  if (observationsCreated >= config.suggestReactiveThreshold) {
    const profileForSuggest = db.ensureProfile();
    if (profileForSuggest.trustLevel >= 2) {
      const lastSuggest = db.getLastJob('suggest');
      const suggestGap = lastSuggest ? Date.now() - new Date(lastSuggest.startedAt).getTime() : Infinity;
      if (suggestGap >= config.suggestReactiveMinGapMs) {
        db.enqueueJob('suggest', { priority: 8, triggerSource: 'reactive' });
      }
    }
  }

  return handlerResult;
}

async function handleSuggest(ctx: JobContext): Promise<JobHandlerResult> {
  const { activitySuggest, activityNotify } = await import('../heartbeat/activities.js');
  const jobStart = new Date().toISOString();

  ctx.setPhase('suggest');

  const unprocessed = ctx.db.listObservations({ processed: false });
  const profile = ctx.db.ensureProfile();
  const actCtx = {
    config: ctx.config, db: ctx.db, profile,
    lastHeartbeat: ctx.db.getLastJob('heartbeat'),
    pendingEventCount: ctx.db.listPendingEvents().length,
  };
  const suggestResult = await activitySuggest(actCtx, unprocessed);
  await activityNotify(actCtx);

  const suggestionItems = recentItems(ctx.db, 'suggestions', jobStart);

  return {
    llmCalls: suggestResult.llmCalls, tokensUsed: suggestResult.tokensUsed,
    phases: ['suggest', 'notify'],
    result: {
      suggestionsCreated: suggestResult.suggestionsCreated,
      suggestionItems,
    },
  };
}

async function handleConsolidate(ctx: JobContext): Promise<JobHandlerResult> {
  const { activityConsolidate } = await import('../heartbeat/activities.js');

  // Phase 1: Layer maintenance + meta-patterns
  ctx.setPhase('layer-maintenance');
  const profile = ctx.db.ensureProfile();
  const actCtx = {
    config: ctx.config, db: ctx.db, profile,
    lastHeartbeat: ctx.db.getLastJob('heartbeat'),
    pendingEventCount: ctx.db.listPendingEvents().length,
  };
  const consolidateResult = await activityConsolidate(actCtx);

  // Phase 2: Correction enforcement
  ctx.setPhase('corrections');
  let correctionsResult = { processed: 0, archived: 0, edited: 0 };
  try {
    const { enforceCorrections } = await import('../memory/retrieval.js');
    correctionsResult = await enforceCorrections(ctx.db, ctx.config);
    if (correctionsResult.processed > 0) {
      console.error(`[daemon] Corrections enforced: ${correctionsResult.processed} processed, ${correctionsResult.archived} archived, ${correctionsResult.edited} edited`);
    }
  } catch (e) {
    console.error('[daemon] Correction enforcement failed:', e instanceof Error ? e.message : e);
  }

  // Phase 3: Memory merge
  ctx.setPhase('merge');
  let mergeResult = { merged: 0, archived: 0, deduped: 0 };
  try {
    const { mergeRelatedMemories } = await import('../memory/retrieval.js');
    mergeResult = await mergeRelatedMemories(ctx.db, ctx.config);
    if (mergeResult.merged > 0 || mergeResult.deduped > 0) {
      console.error(`[daemon] Memory merge: ${mergeResult.merged} clusters merged, ${mergeResult.archived} archived, ${mergeResult.deduped} deduped`);
    }
  } catch (e) {
    console.error('[daemon] Memory merge failed:', e instanceof Error ? e.message : e);
  }

  const totalLlmCalls = consolidateResult.llmCalls
    + (correctionsResult.processed > 0 ? correctionsResult.processed : 0)
    + mergeResult.merged;

  return {
    llmCalls: totalLlmCalls,
    tokensUsed: consolidateResult.tokensUsed,
    phases: ['layer-maintenance', 'corrections', 'merge', 'meta-patterns'],
    result: {
      memoriesPromoted: consolidateResult.memoriesPromoted,
      memoriesDemoted: consolidateResult.memoriesDemoted,
      memoriesExpired: consolidateResult.memoriesExpired,
      correctionsProcessed: correctionsResult.processed,
      memoriesArchived: correctionsResult.archived,
      memoriesEdited: correctionsResult.edited,
      memoriesMerged: mergeResult.merged,
      memoriesArchivedByMerge: mergeResult.archived,
      memoriesDeduped: mergeResult.deduped,
    },
  };
}

async function handleReflect(ctx: JobContext): Promise<JobHandlerResult> {
  const { activityReflect } = await import('../heartbeat/activities.js');

  ctx.setPhase('reflect');

  const profile = ctx.db.ensureProfile();
  const actCtx = {
    config: ctx.config, db: ctx.db, profile,
    lastHeartbeat: ctx.db.getLastJob('heartbeat'),
    pendingEventCount: ctx.db.listPendingEvents().length,
  };
  const reflectResult = await activityReflect(actCtx);

  // Get soul reflection preview if updated
  let deltaPreview: string | undefined;
  if (!reflectResult.skipped) {
    const soulMem = ctx.db.listMemories({ layer: 'core', limit: 5 })
      .find(m => m.kind === 'soul_reflection');
    if (soulMem) deltaPreview = soulMem.bodyMd.slice(0, 120) + (soulMem.bodyMd.length > 120 ? '...' : '');
  }

  return {
    llmCalls: reflectResult.llmCalls, tokensUsed: reflectResult.tokensUsed,
    phases: reflectResult.skipped ? ['reflect', 'skip'] : ['reflect-delta', 'reflect-evolve'],
    result: {
      skipped: reflectResult.skipped,
      soulUpdated: !reflectResult.skipped,
      ...(reflectResult.reason ? { reason: reflectResult.reason } : {}),
      ...(deltaPreview ? { deltaPreview } : {}),
    },
  };
}

function createDigestHandler(digestType: string): (ctx: JobContext, shared: DaemonSharedState) => Promise<JobHandlerResult> {
  return async (ctx: JobContext) => {
    ctx.setPhase('digest');

    // Get periodStart from the job record (stored when enqueued)
    const jobRecord = ctx.db.getJob(ctx.jobId);
    const periodStart = jobRecord?.result?.periodStart as string | undefined;

    const { activityDailyDigest, activityWeeklyDigest, activityBragDoc } = await import('../heartbeat/digests.js');
    const activities: Record<string, () => Promise<{ contentMd: string; tokensUsed: number }>> = {
      'digest-daily': () => activityDailyDigest(ctx.db, ctx.config, periodStart),
      'digest-weekly': () => activityWeeklyDigest(ctx.db, ctx.config, periodStart),
      'digest-brag': () => activityBragDoc(ctx.db, ctx.config),
    };

    const result = await activities[digestType]!();
    const wordCount = result.contentMd.split(/\s+/).length;

    // Find the digest record just created/updated
    const recentDigests = ctx.db.listDigests?.({ kind: digestType.replace('digest-', ''), limit: 1 }) ?? [];
    const digestId = recentDigests[0]?.id;

    return {
      llmCalls: 1, tokensUsed: result.tokensUsed, phases: [digestType],
      result: { periodStart, digestId, wordCount },
    };
  };
}

async function handleRemoteSync(ctx: JobContext, shared: DaemonSharedState): Promise<JobHandlerResult> {
  ctx.setPhase('remote-sync');

  const { remoteSyncRepos } = await import('../observation/remote-sync.js');
  const results = remoteSyncRepos(ctx.db, ctx.config.remoteSyncBatchSize);
  const withChanges = results.filter(r => r.newRemoteCommits > 0);
  if (withChanges.length > 0) {
    shared.pendingRemoteSyncResults.push(...withChanges);
  }

  return {
    llmCalls: 0, tokensUsed: 0, phases: ['remote-sync'],
    result: {
      reposSynced: results.length,
      reposWithChanges: withChanges.length,
      repoSummaries: results.map(r => ({ name: r.repoName, newCommits: r.newRemoteCommits })),
    },
  };
}

async function handleRepoProfile(ctx: JobContext): Promise<JobHandlerResult> {
  ctx.setPhase('repo-profile');

  // Check if this was a manual trigger — force re-profile all repos
  const job = ctx.db.getJob(ctx.jobId);
  const force = job?.triggerSource === 'manual';

  const { profileRepos } = await import('../observation/repo-profile.js');
  const result = await profileRepos(ctx.db, ctx.config, ctx.config.repoProfileBatchSize, force);

  // Get names of recently profiled repos
  const repoNames = ctx.db.listRepos()
    .filter(r => r.contextUpdatedAt && new Date(r.contextUpdatedAt).getTime() > Date.now() - 5 * 60 * 1000)
    .map(r => r.name);

  return {
    llmCalls: result.llmCalls, tokensUsed: result.tokensUsed,
    phases: ['repo-profile'],
    result: { reposProfiled: result.reposProfiled, repoNames },
  };
}

async function handleContextEnrich(ctx: JobContext): Promise<JobHandlerResult> {
  ctx.setPhase('enrich');
  const jobStart = new Date().toISOString();

  const { activityEnrich } = await import('../heartbeat/enrichment.js');
  const result = await activityEnrich(ctx.db, ctx.config);

  // Get recently cached enrichment items
  const recentItems = ctx.db.listEnrichment?.({ limit: 10 })
    ?.filter((e: { createdAt: string }) => e.createdAt >= jobStart) ?? [];
  const sources = [...new Set(recentItems.map((e: { source: string }) => e.source))];
  const entityNames = recentItems.map((e: { entityName: string | null }) => e.entityName).filter((n): n is string => !!n);

  return {
    llmCalls: result.llmCalls, tokensUsed: result.tokensUsed,
    phases: ['enrich'],
    result: { itemsCollected: result.itemsCollected, sources, entityNames },
  };
}

// --- Registry ---

export function buildHandlerRegistry(): Map<string, JobHandlerEntry> {
  const registry = new Map<string, JobHandlerEntry>();

  registry.set('heartbeat', { category: 'llm', fn: handleHeartbeat });
  registry.set('suggest', { category: 'llm', fn: handleSuggest });
  registry.set('consolidate', { category: 'llm', fn: handleConsolidate });
  registry.set('reflect', { category: 'llm', fn: handleReflect });
  registry.set('remote-sync', { category: 'io', fn: handleRemoteSync });
  registry.set('repo-profile', { category: 'llm', fn: handleRepoProfile });
  registry.set('context-enrich', { category: 'llm', fn: handleContextEnrich });

  // Digest handlers registered with their full type name
  for (const digestType of ['digest-daily', 'digest-weekly', 'digest-brag']) {
    registry.set(digestType, { category: 'llm', fn: createDigestHandler(digestType) });
  }

  return registry;
}
