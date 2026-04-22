import type { JobContext, JobHandlerResult, DaemonSharedState } from '../job-handlers.js';
import { errorHint, classifyError } from '../job-handlers.js';
import { log } from '../../log.js';
import { outputLanguageInstruction } from '../../analysis/locale.js';

export async function handleRemoteSync(ctx: JobContext, shared: DaemonSharedState): Promise<JobHandlerResult> {
  ctx.setPhase('remote-sync');

  // If a specific repoId was passed (manual trigger), only sync that repo
  const job = ctx.db.getJob(ctx.jobId);
  const targetRepoId = (job?.result as Record<string, unknown>)?.repoId as string | undefined;

  const { remoteSyncRepos } = await import('../../observation/remote-sync.js');
  const results = remoteSyncRepos(ctx.db, ctx.config.remoteSyncBatchSize, targetRepoId, (name, i, total) => {
    ctx.setPhase(`remote-sync: ${name} (${i}/${total})`);
  });
  const withChanges = results.filter(r => r.newRemoteCommits > 0);
  if (withChanges.length > 0) {
    shared.pendingRemoteSyncResults.push(...withChanges);
  }

  // Reactive repo-profile: trigger if changed repos need re-profiling (2h min gap)
  if (withChanges.length > 0 && !ctx.db.hasQueuedOrRunning('repo-profile') && shared.networkAvailable && shared.systemAwake) {
    const lastProfile = ctx.db.getLastJob('repo-profile');
    const gapMs = lastProfile ? Date.now() - new Date(lastProfile.startedAt).getTime() : Infinity;
    const minGapMs = 2 * 60 * 60 * 1000; // 2h minimum between profiles
    if (gapMs >= minGapMs) {
      ctx.db.enqueueJob('repo-profile', { priority: 3, triggerSource: 'reactive' });
      log.error(`[daemon] Reactive repo-profile triggered: ${withChanges.length} repos with changes`);
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

export async function handleRepoProfile(ctx: JobContext, shared: DaemonSharedState): Promise<JobHandlerResult> {
  ctx.setPhase('repo-profile');

  const job = ctx.db.getJob(ctx.jobId);
  const force = job?.triggerSource === 'manual';
  const targetRepoId = (job?.result as Record<string, unknown>)?.repoId as string | undefined;

  const { profileRepos } = await import('../../observation/repo-profile.js');
  const result = await profileRepos(ctx.db, ctx.config, ctx.config.repoProfileBatchSize, force, (name, i, total) => {
    ctx.setPhase(`repo-profile: ${name} (${i}/${total})`);
  }, targetRepoId);

  const { profiledRepoIds, profiledRepoNames } = result;

  // Reactive triggers — scoped to actually profiled repos. Skipped when the Mac
  // is in darkwake/offline so we don't spawn LLM children that will fail mid-flight.
  const canSpawnReactive = shared.networkAvailable && shared.systemAwake;

  // 1. First-time suggest-deep trigger for newly profiled repos
  if (canSpawnReactive) {
    try {
      for (const repoId of profiledRepoIds) {
        const prevDeepScans = ctx.db.listJobs({ type: 'suggest-deep', limit: 50 })
          .filter(j => (j.result as Record<string, unknown>)?.repoId === repoId);
        if (prevDeepScans.length === 0 && !ctx.db.hasQueuedOrRunningWithParams('suggest-deep', 'repoId', repoId)) {
          ctx.db.enqueueJob('suggest-deep', { priority: 6, triggerSource: 'first-scan', params: { repoId } });
          log.error(`[daemon] First-time suggest-deep triggered for repo ${repoId.slice(0, 8)}`);
          break; // one at a time
        }
      }
    } catch { /* best-effort */ }
  }

  // 2. Reactive project-profile trigger — only for projects containing profiled repos
  if (canSpawnReactive) {
    try {
      const projects = ctx.db.listProjects().filter(p => {
        const rIds: string[] = p.repoIds ?? [];
        return rIds.length >= 2 && rIds.some(id => profiledRepoIds.includes(id));
      });
      for (const project of projects) {
        if (!ctx.db.hasQueuedOrRunningWithParams('project-profile', 'projectId', project.id)) {
          const lastPp = ctx.db.listJobs({ type: 'project-profile', status: 'completed', limit: 20 })
            .find(j => (j.result as Record<string, unknown>)?.projectId === project.id);
          const gap = lastPp ? Date.now() - new Date(lastPp.startedAt).getTime() : Infinity;
          if (gap >= ctx.config.projectProfileMinGapMs) {
            ctx.db.enqueueJob('project-profile', { priority: 4, triggerSource: 'reactive', params: { projectId: project.id } });
            log.error(`[daemon] Reactive project-profile triggered for ${project.name}`);
            break;
          }
        }
      }
    } catch { /* best-effort */ }
  }

  return {
    llmCalls: result.llmCalls, tokensUsed: result.tokensUsed,
    phases: ['repo-profile'],
    result: { reposProfiled: result.reposProfiled, repoNames: profiledRepoNames },
  };
}

export async function handleContextEnrich(ctx: JobContext, shared: DaemonSharedState): Promise<JobHandlerResult> {
  ctx.setPhase('enrich');

  const { activityEnrich } = await import('../../analysis/enrichment.js');
  const activeProjects = shared.activeProjects.length > 0 ? shared.activeProjects : undefined;
  const result = await activityEnrich(ctx.db, ctx.config, activeProjects, (name, i, total) => {
    ctx.setPhase(`enrich: ${name} (${i}/${total})`);
  });

  return {
    llmCalls: result.llmCalls, tokensUsed: result.tokensUsed,
    phases: ['enrich'],
    result: {
      itemsCollected: result.itemsCollected,
      projectResults: result.projectResults,
    },
  };
}

export async function handleMcpDiscover(ctx: JobContext): Promise<JobHandlerResult> {
  ctx.setPhase('discover');

  const { activityMcpDiscover } = await import('../../analysis/mcp-discover.js');
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

export async function handleProjectProfile(ctx: JobContext): Promise<JobHandlerResult> {
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
  const observations = ctx.db.listObservations({ entityType: 'project', entityId: projectId, limit: 20 });
  const memories = ctx.db.listMemories({ archived: false, entityType: 'project', entityId: projectId, limit: 20 });
  const systems = (project.systemIds ?? []).map(id => ctx.db.getSystem(id)).filter(Boolean);

  // External context from enrichment
  const { getEnrichmentSummary: getEnrichForProfile } = await import('../../analysis/enrichment.js');
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

Be concise. Each field 1-3 lines max. Respond with JSON: { "contextMd": "..." }

${outputLanguageInstruction(ctx.db.ensureProfile().locale)}`;

  const { selectAdapter } = await import('../../backend/index.js');
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
  ctx.db.recordLlmUsage({ source: 'project_profile', sourceId: project.id, model, inputTokens: result.inputTokens ?? 0, outputTokens: result.outputTokens ?? 0 });

  if (result.status === 'success' && result.output) {
    const { safeParseJson } = await import('../../backend/json-repair.js');
    const { z } = await import('zod');
    // Require the two load-bearing sections — otherwise the LLM occasionally
    // returns a truncated or off-template blob and the profile looked "saved"
    // while downstream code (suggest-project, UI) could not parse sections
    // from it (audit P-10). Raw-markdown fallback removed; if parse fails we
    // log + skip the update so next run retries cleanly.
    const schema = z.object({
      contextMd: z.string()
        .refine((s) => s.includes('**Summary**') && s.includes('**Architecture**'), {
          message: 'contextMd must include **Summary** and **Architecture** sections',
        }),
    });
    const parsed = safeParseJson(result.output, schema, 'project-profile');
    if (parsed.success) {
      ctx.db.updateProject(projectId, { contextMd: parsed.data.contextMd, contextUpdatedAt: new Date().toISOString() });
    } else {
      log.error(`[project-profile] skipped update for ${project.name} — ${parsed.error}`);
    }
  }

  return {
    llmCalls: 1, tokensUsed: tokens, phases: ['profile'],
    result: { projectId, projectName: project.name, repoCount: repos.length },
    lastError: errorHint(result),
    lastErrorCode: classifyError(result) ?? undefined,
  };
}
