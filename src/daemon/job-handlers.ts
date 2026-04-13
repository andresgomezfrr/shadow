import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ShadowConfig } from '../config/schema.js';
import type { ShadowDatabase } from '../storage/database.js';
import type { EventBus } from '../web/event-bus.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Types ---

export type JobHandlerResult = {
  llmCalls: number;
  tokensUsed: number;
  phases: string[];
  result: Record<string, unknown>;
  lastError?: string;
};

export type JobContext = {
  jobId: string;
  config: ShadowConfig;
  db: ShadowDatabase;
  eventBus: EventBus;
  setPhase: (phase: string | null) => void;
  /** AbortSignal that fires when the job is cancelled (timeout or killAll). Pass to fetch() calls. */
  signal: AbortSignal;
};

export type DaemonSharedState = {
  draining: boolean;
  lastHeartbeatAt: string | null;
  nextHeartbeatAt: string | null;
  lastConsolidationAt: string | null;
  pendingGitEvents: Array<{ repoId: string; repoName: string; type: string; ts: string }>;
  pendingRemoteSyncResults: Array<{ repoId: string; repoName: string; newRemoteCommits: number; behindBranches: Array<{ branch: string; behind: number; ahead: number }>; newCommitMessages: string[] }>;
  activeProjects: Array<{ projectId: string; projectName: string; score: number }>;
  consecutiveIdleTicks: number;
  consecutiveGhostJobs: number;
  lastGhostHint: string | null;
};

export type JobCategory = 'llm' | 'io';

export type JobHandlerEntry = {
  category: JobCategory;
  fn: (ctx: JobContext, shared: DaemonSharedState) => Promise<JobHandlerResult>;
  timeoutMs?: number;
};

// --- Helpers (exported for handler sub-modules) ---

/** Build a short error hint from a BackendExecutionResult for ghost job diagnostics */
export function errorHint(result: { status: string; exitCode: number | null }): string | undefined {
  if (result.status === 'success') return undefined;
  return `${result.status}${result.exitCode != null ? ` (exit ${result.exitCode})` : ''}`;
}

/** Query items created during this job's execution for result enrichment */
export function recentItems(db: ShadowDatabase, table: 'memories' | 'observations' | 'suggestions', since: string, limit = 5): Array<{ id: string; title: string }> {
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

  ctx.setPhase('prepare');

  // Detect active projects from recent interactions + conversations
  let detectedProjects: Array<{ projectId: string; projectName: string; score: number }> = [];
  try {
    const { detectActiveProjects } = await import('../analysis/project-detection.js');
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

    detectedProjects = detectActiveProjects(db, recentInteractions, recentConvTexts, shared.pendingRemoteSyncResults);
    if (detectedProjects.length > 0) {
      console.error(`[daemon] Active projects: ${detectedProjects.map(p => `${p.projectName}(${p.score.toFixed(0)})`).join(', ')}`);
    }
  } catch (e) {
    console.error('[daemon] Project detection failed:', e instanceof Error ? e.message : e);
  }

  // Persist to daemon state
  shared.activeProjects = detectedProjects;

  // Build enrichment context from cached MCP data (mark as reported only after heartbeat succeeds)
  let enrichmentCtx: string | undefined;
  let enrichmentItemIds: string[] = [];
  try {
    const { buildEnrichmentContext } = await import('../analysis/enrichment.js');
    const enrichmentResult = buildEnrichmentContext(db);
    if (enrichmentResult) {
      enrichmentCtx = enrichmentResult.context;
      enrichmentItemIds = enrichmentResult.itemIds;
    }
  } catch { /* enrichment not available */ }

  const { runHeartbeat } = await import('../analysis/state-machine.js');

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
    onPhase: (phase) => ctx.setPhase(phase),
  });

  // Mark enrichment items as reported only after heartbeat succeeds
  for (const id of enrichmentItemIds) db.markEnrichmentReported(id);

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
    if (profileForSuggest.bondTier >= 2) {
      const lastSuggest = db.getLastJob('suggest');
      const suggestGap = lastSuggest ? Date.now() - new Date(lastSuggest.startedAt).getTime() : Infinity;
      if (suggestGap >= config.suggestReactiveMinGapMs) {
        db.enqueueJob('suggest', { priority: 8, triggerSource: 'reactive' });
      }
    }
  }

  // Post-heartbeat: reactive repo-profile if repos have new commits since last profile
  try {
    const { execSync, execFileSync } = await import('node:child_process');
    if (!db.hasQueuedOrRunning('repo-profile')) {
      const lastProfile = db.getLastJob('repo-profile');
      const gapMs = lastProfile ? Date.now() - new Date(lastProfile.startedAt).getTime() : Infinity;
      const minGapMs = 2 * 60 * 60 * 1000; // 2h min gap
      if (gapMs >= minGapMs) {
        const needsProfile = db.listRepos().some(r => {
          if (!r.contextUpdatedAt) return true;
          try {
            const log = execFileSync('git', ['log', `--since=${r.contextUpdatedAt}`, '--oneline'], {
              cwd: r.path, encoding: 'utf-8', timeout: 5000, stdio: 'pipe',
            }).trim();
            return log.length > 0;
          } catch { return false; }
        });
        if (needsProfile) {
          db.enqueueJob('repo-profile', { priority: 3, triggerSource: 'reactive' });
          console.error('[daemon] Reactive repo-profile triggered: repos with new local commits');
        }
      }
    }
  } catch { /* best-effort */ }

  return handlerResult;
}

async function handleConsolidate(ctx: JobContext): Promise<JobHandlerResult> {
  const { activityConsolidate } = await import('../analysis/activities.js');

  // Phase 1: Layer maintenance + meta-patterns
  ctx.setPhase('layer-maintenance');
  const profile = ctx.db.ensureProfile();
  const actCtx = {
    config: ctx.config, db: ctx.db, profile,
    lastHeartbeat: ctx.db.getLastJob('heartbeat'),
    pendingEventCount: ctx.db.listPendingEvents().length,
  };
  let consolidateResult = { memoriesPromoted: 0, memoriesDemoted: 0, memoriesExpired: 0, llmCalls: 0, tokensUsed: 0 };
  try {
    consolidateResult = await activityConsolidate(actCtx);
  } catch (e) {
    console.error('[daemon] Consolidate layer maintenance failed:', e instanceof Error ? e.message : e);
  }

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
  const { activityReflect } = await import('../analysis/activities.js');

  ctx.setPhase('reflect-delta');

  const profile = ctx.db.ensureProfile();
  const actCtx = {
    config: ctx.config, db: ctx.db, profile,
    lastHeartbeat: ctx.db.getLastJob('heartbeat'),
    pendingEventCount: ctx.db.listPendingEvents().length,
  };
  const reflectResult = await activityReflect(actCtx, { onPhase: ctx.setPhase });

  // Get soul reflection preview if updated
  let deltaPreview: string | undefined;
  if (!reflectResult.skipped) {
    const soulMem = ctx.db.listMemories({ layer: 'core', limit: 5 })
      .find(m => m.kind === 'soul_reflection');
    if (soulMem) deltaPreview = soulMem.bodyMd.slice(0, 120) + (soulMem.bodyMd.length > 120 ? '...' : '');
  }

  return {
    llmCalls: reflectResult.llmCalls, tokensUsed: reflectResult.tokensUsed,
    phases: reflectResult.skipped ? ['reflect', 'skip'] : ['reflect-delta', 'reflect-evolve', 'reflect-validate'],
    result: {
      skipped: reflectResult.skipped,
      soulUpdated: reflectResult.soulUpdated ?? !reflectResult.skipped,
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

    const { activityDailyDigest, activityWeeklyDigest, activityBragDoc } = await import('../analysis/digests.js');
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

// Handlers in sub-modules:
// handlers/suggest.ts — handleSuggest, handleSuggestDeep, handleSuggestProject, handleRevalidateSuggestion
// handlers/profiling.ts — handleRemoteSync, handleRepoProfile, handleContextEnrich, handleMcpDiscover, handleProjectProfile

// --- Version Check Handler ---

async function handleVersionCheck(ctx: JobContext): Promise<JobHandlerResult> {
  ctx.setPhase('version-check');

  const { dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const __handlerDir = dirname(fileURLToPath(import.meta.url));
  const projectRoot = resolve(__handlerDir, '..', '..');
  const currentVersion: string = JSON.parse(
    readFileSync(resolve(projectRoot, 'package.json'), 'utf8'),
  ).version;

  const { execSync } = await import('node:child_process');
  let remoteTags: string;
  try {
    remoteTags = execSync('git ls-remote --tags origin "refs/tags/v*"', {
      cwd: projectRoot, encoding: 'utf8', timeout: 15_000,
    });
  } catch {
    console.error('[version-check] Failed to reach remote');
    return { llmCalls: 0, tokensUsed: 0, phases: ['version-check'], result: { error: 'network' } };
  }

  // Parse latest semver tag from ls-remote output
  const tags = remoteTags
    .split('\n')
    .map(line => line.match(/refs\/tags\/(v\d+\.\d+\.\d+)$/)?.[1])
    .filter((t): t is string => !!t);

  if (tags.length === 0) {
    return { llmCalls: 0, tokensUsed: 0, phases: ['version-check'], result: { noTags: true } };
  }

  tags.sort((a, b) => {
    const pa = a.slice(1).split('.').map(Number);
    const pb = b.slice(1).split('.').map(Number);
    return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2];
  });
  const latestTag = tags[tags.length - 1];
  const latestVersion = latestTag.slice(1); // strip 'v'

  // Compare: is remote newer?
  const cv = currentVersion.split('.').map(Number);
  const lv = latestVersion.split('.').map(Number);
  const isNewer = lv[0] > cv[0] || (lv[0] === cv[0] && lv[1] > cv[1]) || (lv[0] === cv[0] && lv[1] === cv[1] && lv[2] > cv[2]);

  if (isNewer) {
    // Avoid duplicate events for same version
    const pending = ctx.db.listPendingEvents();
    const alreadyQueued = pending.some(e => {
      if (e.kind !== 'version_available') return false;
      try { return (e.payload as Record<string, unknown>)?.version === latestVersion; } catch { return false; }
    });

    if (!alreadyQueued) {
      ctx.db.createEvent({
        kind: 'version_available',
        priority: 8,
        payload: {
          version: latestVersion,
          current: currentVersion,
          message: `Shadow ${latestVersion} disponible — ejecuta: shadow upgrade`,
        },
      });
      console.error(`[version-check] New version available: v${latestVersion} (current: v${currentVersion})`);
    }
  }

  return {
    llmCalls: 0, tokensUsed: 0, phases: ['version-check'],
    result: { currentVersion, latestVersion, isNewer },
  };
}

// --- Registry ---

import { handleSuggest, handleSuggestDeep, handleSuggestProject, handleRevalidateSuggestion } from './handlers/suggest.js';
import { handleRemoteSync, handleRepoProfile, handleContextEnrich, handleMcpDiscover, handleProjectProfile } from './handlers/profiling.js';
import { handleAutoPlan, handleAutoExecute } from './handlers/autonomy.js';

export function buildHandlerRegistry(): Map<string, JobHandlerEntry> {
  const registry = new Map<string, JobHandlerEntry>();

  registry.set('heartbeat', { category: 'llm', fn: handleHeartbeat });
  registry.set('suggest', { category: 'llm', fn: handleSuggest });
  registry.set('consolidate', { category: 'llm', fn: handleConsolidate });
  registry.set('reflect', { category: 'llm', fn: handleReflect });
  registry.set('remote-sync', { category: 'io', fn: handleRemoteSync });
  registry.set('repo-profile', { category: 'llm', fn: handleRepoProfile });
  registry.set('context-enrich', { category: 'llm', fn: handleContextEnrich });
  registry.set('mcp-discover', { category: 'llm', fn: handleMcpDiscover });
  registry.set('project-profile', { category: 'llm', fn: handleProjectProfile });
  registry.set('suggest-deep', { category: 'llm', fn: handleSuggestDeep });
  registry.set('suggest-project', { category: 'llm', fn: handleSuggestProject });
  registry.set('version-check', { category: 'io', fn: handleVersionCheck });
  registry.set('revalidate-suggestion', { category: 'llm', fn: handleRevalidateSuggestion });
  registry.set('auto-plan', { category: 'llm', fn: handleAutoPlan, timeoutMs: 30 * 60 * 1000 });
  registry.set('auto-execute', { category: 'llm', fn: handleAutoExecute, timeoutMs: 60 * 60 * 1000 });

  // Digest handlers registered with their full type name
  for (const digestType of ['digest-daily', 'digest-weekly', 'digest-brag']) {
    registry.set(digestType, { category: 'llm', fn: createDigestHandler(digestType) });
  }

  return registry;
}
