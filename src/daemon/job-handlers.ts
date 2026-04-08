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
};

export type JobContext = {
  jobId: string;
  config: ShadowConfig;
  db: ShadowDatabase;
  eventBus: EventBus;
  setPhase: (phase: string | null) => void;
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

  // Build enrichment context from cached MCP data
  let enrichmentCtx: string | undefined;
  try {
    const { buildEnrichmentContext } = await import('../analysis/enrichment.js');
    enrichmentCtx = buildEnrichmentContext(db);
  } catch { /* enrichment not available */ }

  ctx.setPhase('analyze');

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

  // Post-heartbeat: reactive repo-profile if repos have new commits since last profile
  try {
    const { execSync } = await import('node:child_process');
    if (!db.hasQueuedOrRunning('repo-profile')) {
      const lastProfile = db.getLastJob('repo-profile');
      const gapMs = lastProfile ? Date.now() - new Date(lastProfile.startedAt).getTime() : Infinity;
      const minGapMs = 2 * 60 * 60 * 1000; // 2h min gap
      if (gapMs >= minGapMs) {
        const needsProfile = db.listRepos().some(r => {
          if (!r.contextUpdatedAt) return true;
          try {
            const log = execSync(`git log --since="${r.contextUpdatedAt}" --oneline`, {
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

async function handleSuggest(ctx: JobContext): Promise<JobHandlerResult> {
  const { activitySuggest, activityNotify } = await import('../analysis/activities.js');
  const jobStart = new Date().toISOString();

  ctx.setPhase('suggest');

  // If a specific repoId was passed (manual trigger), filter observations to that repo
  const job = ctx.db.getJob(ctx.jobId);
  const targetRepoId = (job?.result as Record<string, unknown>)?.repoId as string | undefined;

  let unprocessed = ctx.db.listObservations({ processed: false });
  if (targetRepoId) {
    unprocessed = unprocessed.filter(o =>
      o.entities?.some(e => e.type === 'repo' && e.id === targetRepoId),
    );
  }

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
      ...(targetRepoId ? { repoId: targetRepoId } : {}),
    },
  };
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
  const { activityReflect } = await import('../analysis/activities.js');

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

async function handleRemoteSync(ctx: JobContext, shared: DaemonSharedState): Promise<JobHandlerResult> {
  ctx.setPhase('remote-sync');

  // If a specific repoId was passed (manual trigger), only sync that repo
  const job = ctx.db.getJob(ctx.jobId);
  const targetRepoId = (job?.result as Record<string, unknown>)?.repoId as string | undefined;

  const { remoteSyncRepos } = await import('../observation/remote-sync.js');
  const results = remoteSyncRepos(ctx.db, ctx.config.remoteSyncBatchSize, targetRepoId);
  const withChanges = results.filter(r => r.newRemoteCommits > 0);
  if (withChanges.length > 0) {
    shared.pendingRemoteSyncResults.push(...withChanges);
  }

  // Reactive repo-profile: trigger if changed repos need re-profiling (2h min gap)
  if (withChanges.length > 0 && !ctx.db.hasQueuedOrRunning('repo-profile')) {
    const lastProfile = ctx.db.getLastJob('repo-profile');
    const gapMs = lastProfile ? Date.now() - new Date(lastProfile.startedAt).getTime() : Infinity;
    const minGapMs = 2 * 60 * 60 * 1000; // 2h minimum between profiles
    if (gapMs >= minGapMs) {
      ctx.db.enqueueJob('repo-profile', { priority: 3, triggerSource: 'reactive' });
      console.error(`[daemon] Reactive repo-profile triggered: ${withChanges.length} repos with changes`);
    }
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

  // Reactive triggers after profiling

  // 1. First-time suggest-deep trigger for newly profiled repos
  try {
    const allRepos = ctx.db.listRepos();
    for (const rName of repoNames) {
      const r = allRepos.find(rr => rr.name === rName);
      if (!r) continue;
      const prevDeepScans = ctx.db.listJobs({ type: 'suggest-deep', limit: 50 })
        .filter(j => (j.result as Record<string, unknown>)?.repoId === r.id);
      if (prevDeepScans.length === 0 && !ctx.db.hasQueuedOrRunning('suggest-deep')) {
        ctx.db.enqueueJob('suggest-deep', { priority: 6, triggerSource: 'first-scan', params: { repoId: r.id } });
        console.error(`[daemon] First-time suggest-deep triggered for ${r.name}`);
        break; // one at a time
      }
    }
  } catch { /* best-effort */ }

  // 2. Reactive project-profile trigger
  try {
    const projects = ctx.db.listProjects().filter(p => {
      const rIds: string[] = p.repoIds ?? [];
      return rIds.length >= 2;
    });
    for (const project of projects) {
      if (!ctx.db.hasQueuedOrRunning('project-profile')) {
        const lastPp = ctx.db.getLastJob('project-profile');
        const gap = lastPp ? Date.now() - new Date(lastPp.startedAt).getTime() : Infinity;
        if (gap >= ctx.config.projectProfileMinGapMs) {
          ctx.db.enqueueJob('project-profile', { priority: 4, triggerSource: 'reactive', params: { projectId: project.id } });
          console.error(`[daemon] Reactive project-profile triggered for ${project.name}`);
          break;
        }
      }
    }
  } catch { /* best-effort */ }

  return {
    llmCalls: result.llmCalls, tokensUsed: result.tokensUsed,
    phases: ['repo-profile'],
    result: { reposProfiled: result.reposProfiled, repoNames },
  };
}

async function handleContextEnrich(ctx: JobContext, shared: DaemonSharedState): Promise<JobHandlerResult> {
  ctx.setPhase('enrich');
  const jobStart = new Date().toISOString();

  const { activityEnrich } = await import('../analysis/enrichment.js');
  const activeProjects = shared.activeProjects.length > 0 ? shared.activeProjects : undefined;
  const result = await activityEnrich(ctx.db, ctx.config, activeProjects);

  return {
    llmCalls: result.llmCalls, tokensUsed: result.tokensUsed,
    phases: ['enrich'],
    result: {
      itemsCollected: result.itemsCollected,
      projectResults: result.projectResults,
    },
  };
}

// --- MCP Discover Handler ---

async function handleMcpDiscover(ctx: JobContext): Promise<JobHandlerResult> {
  ctx.setPhase('discover');

  const { activityMcpDiscover } = await import('../analysis/mcp-discover.js');
  const result = await activityMcpDiscover(ctx.db, ctx.config);

  return {
    llmCalls: result.llmCalls, tokensUsed: result.tokensUsed,
    phases: ['discover'],
    result: {
      serversDescribed: result.serversDescribed,
      serversTotal: result.serversTotal,
      serverNames: result.serverNames,
    },
  };
}

// --- Project Profile Handler ---

async function handleProjectProfile(ctx: JobContext): Promise<JobHandlerResult> {
  ctx.setPhase('profile');

  const job = ctx.db.getJob(ctx.jobId);
  const projectId = (job?.result as Record<string, unknown>)?.projectId as string;
  if (!projectId) return { llmCalls: 0, tokensUsed: 0, phases: ['profile'], result: { error: 'no projectId' } };

  const project = ctx.db.getProject(projectId);
  if (!project) return { llmCalls: 0, tokensUsed: 0, phases: ['profile'], result: { error: 'project not found' } };

  const repoIds: string[] = project.repoIds ?? [];
  const repos = repoIds.map(id => ctx.db.getRepo(id)).filter(Boolean);
  const repoProfiles = repos.map(r => r!.contextMd ? `### ${r!.name}\n${r!.contextMd}` : `### ${r!.name}\nNo profile yet.`);

  // Gather project context
  const observations = ctx.db.listObservations({ limit: 20 })
    .filter(o => o.entities?.some(e => e.type === 'project' && e.id === projectId));
  const memories = ctx.db.listMemories({ limit: 20, archived: false })
    .filter(m => m.entities?.some(e => e.type === 'project' && e.id === projectId));
  const systems = (project.systemIds ?? []).map(id => ctx.db.getSystem(id)).filter(Boolean);

  // External context from enrichment
  const { getEnrichmentSummary: getEnrichForProfile } = await import('../analysis/enrichment.js');
  const profileEnrichSummary = getEnrichForProfile(ctx.db, { projectId });
  const profileEnrichSection = profileEnrichSummary ? `## External Context (from MCP enrichment)\n${profileEnrichSummary}` : '';

  const prompt = `You are Shadow, analyzing project "${project.name}" to create a cross-repo context profile.
This profile will be used to calibrate cross-repo suggestions and understand the project holistically.

## Repos in this project (${repos.length})
${repoProfiles.join('\n\n')}

${systems.length > 0 ? `## Systems\n${systems.map(s => `- ${s!.name} (${s!.kind}): ${s!.description ?? 'no description'}`).join('\n')}` : ''}

${observations.length > 0 ? `## Active Observations\n${observations.map(o => `- [${o.severity}] ${o.title}`).join('\n')}` : ''}

${memories.length > 0 ? `## Relevant Memories\n${memories.map(m => `- ${m.title}`).join('\n')}` : ''}

${profileEnrichSection}

Produce a structured project profile in markdown with EXACTLY this format:

## ${project.name}
**Summary**: (2-3 sentences: what this project is, why it exists, how the repos work together)
**Architecture**: (how repos relate — who calls whom, shared infrastructure, deployment model)
**Cross-repo patterns**: (shared tech, conventions, design patterns across repos)
**Integration points**: (runtime deps, shared DBs, APIs between repos, config sharing)
**Active tensions**: (divergence, parity gaps, naming drift, version mismatches)
**Valuable cross-repo suggestions**: (what would help this project as a whole — be specific)

Be concise. Each field 1-3 lines max. Respond with JSON: { "contextMd": "..." }`;

  const { selectAdapter } = await import('../backend/index.js');
  const adapter = selectAdapter(ctx.config);
  const model = ctx.config.models.projectProfile;
  const effort = ctx.config.efforts.projectProfile;

  const result = await adapter.execute({
    repos: repos.map(r => ({ id: r!.id, name: r!.name, path: r!.path })),
    title: `Project Profile: ${project.name}`,
    goal: 'Analyze project cross-repo context',
    prompt,
    relevantMemories: [],
    model,
    effort,
    allowedTools: ['Read', 'Grep', 'Glob'],
  });

  const tokens = (result.inputTokens ?? 0) + (result.outputTokens ?? 0);

  if (result.status === 'success' && result.output) {
    const { safeParseJson } = await import('../backend/json-repair.js');
    const { z } = await import('zod');
    const parsed = safeParseJson(result.output, z.object({ contextMd: z.string() }), 'project-profile');
    const contextMd = parsed.success ? parsed.data.contextMd : (result.output.includes('**Summary**') ? result.output.trim() : '');

    if (contextMd) {
      ctx.db.updateProject(projectId, { contextMd, contextUpdatedAt: new Date().toISOString() });
    }
  }

  return {
    llmCalls: 1, tokensUsed: tokens, phases: ['profile'],
    result: { projectName: project.name, repoCount: repos.length },
  };
}

// --- Suggest Deep Handler ---

async function handleSuggestDeep(ctx: JobContext, _shared: DaemonSharedState): Promise<JobHandlerResult> {
  ctx.setPhase('scan');

  const job = ctx.db.getJob(ctx.jobId);
  const repoId = (job?.result as Record<string, unknown>)?.repoId as string;
  if (!repoId) return { llmCalls: 0, tokensUsed: 0, phases: ['scan'], result: { error: 'no repoId' } };

  const repo = ctx.db.getRepo(repoId);
  if (!repo) return { llmCalls: 0, tokensUsed: 0, phases: ['scan'], result: { error: 'repo not found' } };

  // Gather rich context
  const repoProfile = repo.contextMd ?? 'No profile available.';
  const observations = ctx.db.listObservations({ limit: 20 })
    .filter(o => o.entities?.some(e => e.type === 'repo' && e.id === repoId));
  const memories = ctx.db.listMemories({ limit: 20, archived: false })
    .filter(m => m.entities?.some(e => e.type === 'repo' && e.id === repoId));
  const dismissPatterns = ctx.db.getDismissPatterns(repoId);
  const recentAccepted = ctx.db.listSuggestions({ status: 'accepted', limit: 10 })
    .filter(s => s.repoId === repoId);

  // Find project profile if repo belongs to a project
  let projectContext = '';
  const projectsForRepo = ctx.db.listProjects().filter(p => (p.repoIds ?? []).includes(repoId));
  if (projectsForRepo.length > 0 && projectsForRepo[0].contextMd) {
    projectContext = `\n## Project Context\n${projectsForRepo[0].contextMd}`;
  }

  // Load corrections for this repo
  const { loadPendingCorrections } = await import('../memory/retrieval.js');
  const corrections = loadPendingCorrections(ctx.db, [{ type: 'repo', id: repoId }]);

  // External context from enrichment
  const { getEnrichmentSummary } = await import('../analysis/enrichment.js');
  const enrichProjectId = projectsForRepo.length > 0 ? projectsForRepo[0].id : undefined;
  const enrichSection = enrichProjectId ? getEnrichmentSummary(ctx.db, { projectId: enrichProjectId }) : undefined;

  const prompt = `You are Shadow doing a deep review of the ${repo.name} repository.
You have FULL ACCESS to the codebase via tools. Explore freely.

## Repo Profile
${repoProfile}
${projectContext}
${corrections}
${enrichSection ? `\n## External Context (from MCP enrichment)\n${enrichSection}` : ''}

${observations.length > 0 ? `## Active Observations\n${observations.map(o => `- [${o.severity}/${o.kind}] ${o.title}: ${typeof o.detail === 'object' ? JSON.stringify(o.detail).slice(0, 100) : ''}`).join('\n')}` : ''}

${memories.length > 0 ? `## What Shadow Knows\n${memories.map(m => `- [${m.kind}] ${m.title}`).join('\n')}` : ''}

${dismissPatterns.length > 0 ? `## DO NOT suggest (user rejected these patterns)\n${dismissPatterns.map(p => `- ${p.category}: ${p.count} dismissals${p.recentNotes?.length ? ` (${p.recentNotes[0]})` : ''}`).join('\n')}` : ''}

${recentAccepted.length > 0 ? `## Recently Accepted (this direction works)\n${recentAccepted.map(s => `- ${s.title}`).join('\n')}` : ''}

Your mission: explore the codebase and find high-value improvements.
Look for: architecture issues, tech debt, missing features, dependency problems,
security concerns, test coverage gaps, refactoring opportunities, performance issues.

Use Read, Grep, Glob, Bash to explore the code. Use shadow_memory_search for context.
Be thorough but selective — only suggest things that genuinely matter.

Respond with JSON:
{
  "suggestions": [
    {
      "kind": "refactor" | "bug" | "improvement" | "feature",
      "title": "short title",
      "summaryMd": "detailed description in markdown",
      "reasoningMd": "why this matters and what you found in the code",
      "impactScore": 1-5,
      "confidenceScore": 0-100,
      "riskScore": 1-5,
      "files": ["relevant/file/paths"]
    }
  ]
}

Generate 1-5 suggestions. Quality over quantity.`;

  const { selectAdapter } = await import('../backend/index.js');
  const adapter = selectAdapter(ctx.config);

  const result = await adapter.execute({
    repos: [{ id: repo.id, name: repo.name, path: repo.path }],
    title: `Deep Scan: ${repo.name}`,
    goal: 'Deep codebase review for suggestions',
    prompt,
    relevantMemories: [],
    model: ctx.config.models.suggestDeep,
    effort: ctx.config.efforts.suggestDeep,
    systemPrompt: null,
    allowedTools: ['Read', 'Grep', 'Glob', 'Bash'],
  });

  const tokens = (result.inputTokens ?? 0) + (result.outputTokens ?? 0);
  let suggestionsCreated = 0;
  const suggestionTitles: string[] = [];

  if (result.status === 'success' && result.output) {
    ctx.setPhase('validate');

    const { safeParseJson } = await import('../backend/json-repair.js');
    const { z } = await import('zod');
    const schema = z.object({
      suggestions: z.array(z.object({
        kind: z.string(),
        title: z.string(),
        summaryMd: z.string(),
        reasoningMd: z.string().optional(),
        impactScore: z.number().min(1).max(5),
        confidenceScore: z.number().min(0).max(100),
        riskScore: z.number().min(1).max(5),
        files: z.array(z.string()).optional(),
      })),
    });

    const parsed = safeParseJson(result.output, schema, 'suggest-deep');
    if (parsed.success) {
      const { checkSuggestionDuplicate } = await import('../memory/dedup.js');
      const { generateAndStoreEmbedding } = await import('../memory/lifecycle.js');

      for (const s of parsed.data.suggestions) {
        if (s.impactScore < 3 || s.confidenceScore < 50) continue;

        // Dedup vs existing suggestions
        const dedupPending = await checkSuggestionDuplicate(ctx.db, { kind: s.kind, title: s.title, summaryMd: s.summaryMd }, 'pending');
        if (dedupPending.action === 'skip') continue;
        const dedupDismissed = await checkSuggestionDuplicate(ctx.db, { kind: s.kind, title: s.title, summaryMd: s.summaryMd }, 'dismissed');
        if (dedupDismissed.action === 'skip') continue;

        const created = ctx.db.createSuggestion({
          repoId,
          repoIds: [repoId],
          kind: s.kind,
          title: s.title,
          summaryMd: s.summaryMd,
          reasoningMd: s.reasoningMd ?? '',
          impactScore: s.impactScore,
          confidenceScore: s.confidenceScore,
          riskScore: s.riskScore,
          sourceObservationId: null,
          requiredTrustLevel: ctx.db.ensureProfile().trustLevel,
        });

        // Persist entity links
        const entities = [{ type: 'repo' as const, id: repoId }];
        try {
          ctx.db.rawDb.prepare('UPDATE suggestions SET entities_json = ? WHERE id = ?').run(JSON.stringify(entities), created.id);
        } catch { /* best-effort */ }

        // Generate embedding
        try {
          await generateAndStoreEmbedding(ctx.db, 'suggestion', created.id, { kind: created.kind, title: created.title, summaryMd: created.summaryMd });
        } catch { /* best-effort */ }

        suggestionsCreated++;
        suggestionTitles.push(s.title);
      }
    }
  }

  // Post deep-scan: trigger suggest-project if repo belongs to a project with 2+ repos
  try {
    const projects = ctx.db.listProjects().filter(p => {
      const rIds = p.repoIds ?? [];
      return rIds.length >= 2 && rIds.includes(repoId);
    });
    for (const project of projects) {
      if (!ctx.db.hasQueuedOrRunning('suggest-project')) {
        const lastSp = ctx.db.getLastJob('suggest-project');
        const gapDays = lastSp ? (Date.now() - new Date(lastSp.startedAt).getTime()) / (24 * 60 * 60 * 1000) : Infinity;
        if (gapDays >= ctx.config.suggestProjectMinGapDays) {
          ctx.db.enqueueJob('suggest-project', { priority: 5, triggerSource: 'reactive', params: { projectId: project.id } });
          break;
        }
      }
    }
  } catch { /* best-effort */ }

  return {
    llmCalls: 1, tokensUsed: tokens,
    phases: suggestionsCreated > 0 ? ['scan', 'validate'] : ['scan'],
    result: { repoName: repo.name, suggestionsCreated, suggestionTitles, repoId },
  };
}

// --- Suggest Project Handler ---

async function handleSuggestProject(ctx: JobContext): Promise<JobHandlerResult> {
  ctx.setPhase('analyze');

  const job = ctx.db.getJob(ctx.jobId);
  const projectId = (job?.result as Record<string, unknown>)?.projectId as string;
  if (!projectId) return { llmCalls: 0, tokensUsed: 0, phases: ['analyze'], result: { error: 'no projectId' } };

  const project = ctx.db.getProject(projectId);
  if (!project) return { llmCalls: 0, tokensUsed: 0, phases: ['analyze'], result: { error: 'project not found' } };

  const repoIds: string[] = project.repoIds ?? [];
  if (repoIds.length < 2) return { llmCalls: 0, tokensUsed: 0, phases: ['analyze'], result: { error: 'need 2+ repos' } };

  const repos = repoIds.map(id => ctx.db.getRepo(id)).filter(Boolean);
  const repoProfiles = repos.map(r => r!.contextMd ? `### ${r!.name}\n${r!.contextMd}` : `### ${r!.name}\nNo profile.`);
  const projectProfile = project.contextMd ?? 'No project profile.';

  // Cross-project observations
  const crossObs = ctx.db.listObservations({ limit: 20 })
    .filter(o => o.kind === 'cross_project' || o.entities?.some(e => e.type === 'project' && e.id === projectId));
  const memories = ctx.db.listMemories({ limit: 20, archived: false })
    .filter(m => m.entities?.some(e => e.type === 'project' && e.id === projectId));
  const dismissPatterns = ctx.db.getDismissPatterns();

  // External context from enrichment
  const { getEnrichmentSummary } = await import('../analysis/enrichment.js');
  const enrichSection = getEnrichmentSummary(ctx.db, { projectId });

  const prompt = `You are Shadow analyzing project "${project.name}" across ${repos.length} repos.
You have access to READ all repos. Find cross-repo improvement opportunities.

## Project Profile
${projectProfile}

## Repo Profiles
${repoProfiles.join('\n\n')}

${crossObs.length > 0 ? `## Cross-Project Observations\n${crossObs.map(o => `- [${o.severity}] ${o.title}`).join('\n')}` : ''}

${memories.length > 0 ? `## Project Memories\n${memories.map(m => `- ${m.title}`).join('\n')}` : ''}

${enrichSection ? `## External Context (from MCP enrichment)\n${enrichSection}` : ''}

${dismissPatterns.length > 0 ? `## Dismissed Patterns (avoid)\n${dismissPatterns.map(p => `- ${p.category}: ${p.count}x`).join('\n')}` : ''}

Look for cross-repo opportunities:
- Shared libraries that could be extracted
- Duplicated logic across repos
- API contract gaps or inconsistencies
- Dependency version mismatches
- Convention drift between repos
- Shared infrastructure improvements

Use Read, Grep, Glob to compare code across repos. Use shadow_memory_search for context.

Respond with JSON:
{
  "suggestions": [
    {
      "kind": "refactor" | "improvement" | "feature",
      "title": "short title",
      "summaryMd": "description",
      "reasoningMd": "what you found across repos",
      "impactScore": 1-5,
      "confidenceScore": 0-100,
      "riskScore": 1-5,
      "repoNames": ["which repos this affects"]
    }
  ]
}

Generate 1-3 cross-repo suggestions. Only genuinely cross-repo — not single-repo issues.`;

  const { selectAdapter } = await import('../backend/index.js');
  const adapter = selectAdapter(ctx.config);

  const result = await adapter.execute({
    repos: repos.map(r => ({ id: r!.id, name: r!.name, path: r!.path })),
    title: `Project Suggest: ${project.name}`,
    goal: 'Cross-repo suggestion analysis',
    prompt,
    relevantMemories: [],
    model: ctx.config.models.suggestProject,
    effort: ctx.config.efforts.suggestProject,
    systemPrompt: null,
    allowedTools: ['Read', 'Grep', 'Glob'],
  });

  const tokens = (result.inputTokens ?? 0) + (result.outputTokens ?? 0);
  let suggestionsCreated = 0;
  const suggestionTitles: string[] = [];

  if (result.status === 'success' && result.output) {
    ctx.setPhase('validate');

    const { safeParseJson } = await import('../backend/json-repair.js');
    const { z } = await import('zod');
    const schema = z.object({
      suggestions: z.array(z.object({
        kind: z.string(),
        title: z.string(),
        summaryMd: z.string(),
        reasoningMd: z.string().optional(),
        impactScore: z.number().min(1).max(5),
        confidenceScore: z.number().min(0).max(100),
        riskScore: z.number().min(1).max(5),
        repoNames: z.array(z.string()).optional(),
      })),
    });

    const parsed = safeParseJson(result.output, schema, 'suggest-project');
    if (parsed.success) {
      const { checkSuggestionDuplicate } = await import('../memory/dedup.js');
      const { generateAndStoreEmbedding } = await import('../memory/lifecycle.js');

      for (const s of parsed.data.suggestions) {
        if (s.impactScore < 3 || s.confidenceScore < 50) continue;

        const dedupPending = await checkSuggestionDuplicate(ctx.db, { kind: s.kind, title: s.title, summaryMd: s.summaryMd }, 'pending');
        if (dedupPending.action === 'skip') continue;
        const dedupDismissed = await checkSuggestionDuplicate(ctx.db, { kind: s.kind, title: s.title, summaryMd: s.summaryMd }, 'dismissed');
        if (dedupDismissed.action === 'skip') continue;

        // Find repo IDs from repo names
        const affectedRepoIds = (s.repoNames ?? [])
          .map(name => repos.find(r => r!.name === name)?.id)
          .filter(Boolean) as string[];

        const created = ctx.db.createSuggestion({
          repoId: affectedRepoIds[0] ?? repoIds[0],
          repoIds: affectedRepoIds.length > 0 ? affectedRepoIds : repoIds,
          kind: s.kind,
          title: s.title,
          summaryMd: s.summaryMd,
          reasoningMd: s.reasoningMd ?? '',
          impactScore: s.impactScore,
          confidenceScore: s.confidenceScore,
          riskScore: s.riskScore,
          sourceObservationId: null,
          requiredTrustLevel: ctx.db.ensureProfile().trustLevel,
        });

        // Persist entity links
        const entities = [
          { type: 'project' as const, id: projectId },
          ...affectedRepoIds.map(id => ({ type: 'repo' as const, id })),
        ];
        try {
          ctx.db.rawDb.prepare('UPDATE suggestions SET entities_json = ? WHERE id = ?').run(JSON.stringify(entities), created.id);
        } catch { /* best-effort */ }

        // Generate embedding
        try {
          await generateAndStoreEmbedding(ctx.db, 'suggestion', created.id, { kind: created.kind, title: created.title, summaryMd: created.summaryMd });
        } catch { /* best-effort */ }

        suggestionsCreated++;
        suggestionTitles.push(s.title);
      }
    }
  }

  return {
    llmCalls: 1, tokensUsed: tokens,
    phases: suggestionsCreated > 0 ? ['analyze', 'validate'] : ['analyze'],
    result: { projectName: project.name, suggestionsCreated, suggestionTitles },
  };
}

// --- Version Check Handler ---

async function handleVersionCheck(ctx: JobContext): Promise<JobHandlerResult> {
  ctx.setPhase('version-check');

  const projectRoot = resolve(__dirname, '..', '..');
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

  // Digest handlers registered with their full type name
  for (const digestType of ['digest-daily', 'digest-weekly', 'digest-brag']) {
    registry.set(digestType, { category: 'llm', fn: createDigestHandler(digestType) });
  }

  return registry;
}
