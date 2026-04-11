import type { JobContext, JobHandlerResult, DaemonSharedState } from '../job-handlers.js';
import { errorHint, recentItems } from '../job-handlers.js';

export async function handleSuggest(ctx: JobContext): Promise<JobHandlerResult> {
  const { activitySuggest, activityNotify } = await import('../../analysis/activities.js');
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
  ctx.setPhase('notify');
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

export async function handleSuggestDeep(ctx: JobContext, _shared: DaemonSharedState): Promise<JobHandlerResult> {
  ctx.setPhase('scan');

  const job = ctx.db.getJob(ctx.jobId);
  const repoId = (job?.result as Record<string, unknown>)?.repoId as string;
  if (!repoId) return { llmCalls: 0, tokensUsed: 0, phases: ['scan'], result: { error: 'no repoId' } };

  const repo = ctx.db.getRepo(repoId);
  if (!repo) return { llmCalls: 0, tokensUsed: 0, phases: ['scan'], result: { error: 'repo not found' } };

  // Gather rich context
  const repoProfile = repo.contextMd ?? 'No profile available.';
  const observations = ctx.db.listObservations({ entityType: 'repo', entityId: repoId, limit: 20 });
  const memories = ctx.db.listMemories({ archived: false, entityType: 'repo', entityId: repoId, limit: 20 });
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
  const { loadPendingCorrections } = await import('../../memory/retrieval.js');
  const corrections = loadPendingCorrections(ctx.db, [{ type: 'repo', id: repoId }]);

  // External context from enrichment
  const { getEnrichmentSummary } = await import('../../analysis/enrichment.js');
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

  const { selectAdapter } = await import('../../backend/index.js');
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
  const suggestionItems: Array<{ id: string; title: string }> = [];

  if (result.status === 'success' && result.output) {
    ctx.setPhase('validate');

    const { safeParseJson } = await import('../../backend/json-repair.js');
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
      const { checkSuggestionDuplicate } = await import('../../memory/dedup.js');
      const { generateAndStoreEmbedding } = await import('../../memory/lifecycle.js');

      for (const s of parsed.data.suggestions) {
        if (s.impactScore < 3 || s.confidenceScore < 50) continue;

        // Dedup vs existing suggestions
        const dedupPending = await checkSuggestionDuplicate(ctx.db, { kind: s.kind, title: s.title, summaryMd: s.summaryMd }, 'open');
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
          ctx.db.updateEntityLinks('suggestions', created.id, entities);
        } catch { /* best-effort */ }

        // Generate embedding
        try {
          await generateAndStoreEmbedding(ctx.db, 'suggestion', created.id, { kind: created.kind, title: created.title, summaryMd: created.summaryMd });
        } catch { /* best-effort */ }

        suggestionsCreated++;
        suggestionItems.push({ id: created.id, title: s.title });
      }
    }
  }

  // Notify for created suggestions
  if (suggestionsCreated > 0) {
    ctx.setPhase('notify');
    for (const item of suggestionItems) {
      ctx.db.createEvent({ kind: 'suggestion_ready', priority: 6, payload: { message: `Deep scan suggestion: ${item.title}`, suggestionId: item.id, title: item.title, repoId } });
      ctx.db.updateSuggestion(item.id, { shownAt: new Date().toISOString() });
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
    phases: suggestionsCreated > 0 ? ['scan', 'validate', 'notify'] : ['scan'],
    result: { repoName: repo.name, suggestionsCreated, suggestionItems, repoId },
    lastError: errorHint(result),
  };
}

export async function handleSuggestProject(ctx: JobContext): Promise<JobHandlerResult> {
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
  const memories = ctx.db.listMemories({ archived: false, entityType: 'project', entityId: projectId, limit: 20 });
  const dismissPatterns = ctx.db.getDismissPatterns();

  // External context from enrichment
  const { getEnrichmentSummary } = await import('../../analysis/enrichment.js');
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

  const { selectAdapter } = await import('../../backend/index.js');
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
  const suggestionItems: Array<{ id: string; title: string }> = [];

  if (result.status === 'success' && result.output) {
    ctx.setPhase('validate');

    const { safeParseJson } = await import('../../backend/json-repair.js');
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
      const { checkSuggestionDuplicate } = await import('../../memory/dedup.js');
      const { generateAndStoreEmbedding } = await import('../../memory/lifecycle.js');

      for (const s of parsed.data.suggestions) {
        if (s.impactScore < 3 || s.confidenceScore < 50) continue;

        const dedupPending = await checkSuggestionDuplicate(ctx.db, { kind: s.kind, title: s.title, summaryMd: s.summaryMd }, 'open');
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
          ctx.db.updateEntityLinks('suggestions', created.id, entities);
        } catch { /* best-effort */ }

        // Generate embedding
        try {
          await generateAndStoreEmbedding(ctx.db, 'suggestion', created.id, { kind: created.kind, title: created.title, summaryMd: created.summaryMd });
        } catch { /* best-effort */ }

        suggestionsCreated++;
        suggestionItems.push({ id: created.id, title: s.title });
      }
    }
  }

  // Notify for created suggestions
  if (suggestionsCreated > 0) {
    ctx.setPhase('notify');
    for (const item of suggestionItems) {
      ctx.db.createEvent({ kind: 'suggestion_ready', priority: 6, payload: { message: `Cross-repo suggestion: ${item.title}`, suggestionId: item.id, title: item.title } });
      ctx.db.updateSuggestion(item.id, { shownAt: new Date().toISOString() });
    }
  }

  return {
    llmCalls: 1, tokensUsed: tokens,
    phases: suggestionsCreated > 0 ? ['analyze', 'validate', 'notify'] : ['analyze'],
    result: { projectName: project.name, suggestionsCreated, suggestionItems },
    lastError: errorHint(result),
  };
}

export async function handleRevalidateSuggestion(ctx: JobContext, _shared: DaemonSharedState): Promise<JobHandlerResult> {
  ctx.setPhase('prepare');

  const job = ctx.db.getJob(ctx.jobId);
  const suggestionId = (job?.result as Record<string, unknown>)?.suggestionId as string;
  if (!suggestionId) return { llmCalls: 0, tokensUsed: 0, phases: ['prepare'], result: { error: 'no suggestionId' } };

  const suggestion = ctx.db.getSuggestion(suggestionId);
  if (!suggestion) return { llmCalls: 0, tokensUsed: 0, phases: ['prepare'], result: { error: 'suggestion not found' } };

  const repo = suggestion.repoId ? ctx.db.getRepo(suggestion.repoId) : null;
  if (!repo) return { llmCalls: 0, tokensUsed: 0, phases: ['prepare'], result: { error: 'repo not found' } };

  // Source observation context
  const sourceObs = suggestion.sourceObservationId ? ctx.db.getObservation(suggestion.sourceObservationId) : null;

  ctx.setPhase('evaluate');

  const prompt = `You are Shadow, re-evaluating a suggestion that was created ${suggestion.createdAt}.
The user wants to know if this suggestion is STILL VALID given the current state of the codebase.

## Suggestion to Re-evaluate
**Title:** ${suggestion.title}
**Kind:** ${suggestion.kind}
**Impact:** ${suggestion.impactScore}/5 · **Confidence:** ${suggestion.confidenceScore}/100 · **Risk:** ${suggestion.riskScore}/5
${suggestion.revalidationCount > 0 ? `**Previously revalidated:** ${suggestion.revalidationCount} time(s)` : ''}

### Summary
${suggestion.summaryMd}

${suggestion.reasoningMd ? `### Reasoning\n${suggestion.reasoningMd}` : ''}

${sourceObs ? `### Source Observation\n[${sourceObs.severity}] ${sourceObs.title} (status: ${sourceObs.status})` : ''}

## Your Task
1. Read the relevant files in the codebase to check if the issue/opportunity still exists
2. Check if the problem was already fixed or if the code has changed significantly
3. Determine if the suggestion is still valid, partially valid, or outdated

Use Read, Grep, Glob to explore the code. Be thorough but focused — check the specific files and patterns the suggestion mentions.

IMPORTANT: After your investigation, your FINAL message must be ONLY a JSON object (no markdown fences, no explanation before or after). This JSON is machine-parsed:
{
  "verdict": "valid" | "outdated" | "partial",
  "verdictNote": "Explanation of why (2-3 sentences). If outdated, explain what changed. If partial, explain what still applies.",
  "title": "Updated title (or same if unchanged)",
  "summaryMd": "Updated summary reflecting current state",
  "reasoningMd": "Updated reasoning with what you found in the code NOW",
  "impactScore": 1-5,
  "confidenceScore": 0-100,
  "riskScore": 1-5,
  "dismissReason": "If verdict is 'outdated', a pre-written dismiss note the user can use as-is or edit"
}`;

  const { selectAdapter } = await import('../../backend/index.js');
  const adapter = selectAdapter(ctx.config);

  const result = await adapter.execute({
    repos: [{ id: repo.id, name: repo.name, path: repo.path }],
    title: `Revalidate: ${suggestion.title}`,
    goal: 'Re-evaluate suggestion against current codebase',
    prompt,
    relevantMemories: [],
    model: ctx.config.models.revalidate,
    effort: ctx.config.efforts.revalidate,
    systemPrompt: null,
    allowedTools: ['Read', 'Grep', 'Glob', 'Bash'],
  });

  const tokens = (result.inputTokens ?? 0) + (result.outputTokens ?? 0);

  if (result.status !== 'success' || !result.output) {
    return { llmCalls: 1, tokensUsed: tokens, phases: ['prepare', 'evaluate'], result: { error: 'LLM call failed', suggestionId }, lastError: errorHint(result) };
  }

  ctx.setPhase('apply');

  const { safeParseJson } = await import('../../backend/json-repair.js');
  const { z } = await import('zod');
  const schema = z.object({
    verdict: z.enum(['valid', 'outdated', 'partial']),
    verdictNote: z.string(),
    title: z.string().optional(),
    summaryMd: z.string().optional(),
    reasoningMd: z.string().optional(),
    impactScore: z.number().min(1).max(5).optional(),
    confidenceScore: z.number().min(0).max(100).optional(),
    riskScore: z.number().min(1).max(5).optional(),
    dismissReason: z.string().nullable().optional(),
  });

  const parsed = safeParseJson(result.output, schema, 'revalidate-suggestion');
  if (!parsed.success) {
    console.error(`[daemon] revalidate-suggestion parse error: ${parsed.error}\nRaw output (first 500): ${result.output.slice(0, 500)}`);
    return { llmCalls: 1, tokensUsed: tokens, phases: ['prepare', 'evaluate', 'apply'], result: { error: `Parse failed: ${parsed.error?.slice(0, 100)}`, suggestionId, rawSnippet: result.output.slice(0, 200) } };
  }

  const v = parsed.data;
  const now = new Date().toISOString();

  // Update suggestion in-place — only update fields the LLM provided
  const updates: Record<string, unknown> = {
    revalidationCount: suggestion.revalidationCount + 1,
    lastRevalidatedAt: now,
    revalidationVerdict: v.verdict,
    revalidationNote: v.verdict === 'outdated' ? (v.dismissReason ?? v.verdictNote) : v.verdictNote,
  };
  if (v.title) updates.title = v.title;
  if (v.summaryMd) updates.summaryMd = v.summaryMd;
  if (v.reasoningMd) updates.reasoningMd = v.reasoningMd;
  // Apply verdict-based score adjustments
  // If Claude provided scores, use them. Otherwise, adjust existing scores by verdict.
  if (v.verdict === 'valid') {
    updates.impactScore = v.impactScore ?? suggestion.impactScore;
    updates.confidenceScore = v.confidenceScore ?? Math.max(suggestion.confidenceScore, 70);
    updates.riskScore = v.riskScore ?? suggestion.riskScore;
  } else if (v.verdict === 'partial') {
    updates.impactScore = v.impactScore ?? Math.round(suggestion.impactScore * 0.8);
    updates.confidenceScore = v.confidenceScore ?? Math.round(suggestion.confidenceScore * 0.6);
    updates.riskScore = v.riskScore ?? suggestion.riskScore;
  } else if (v.verdict === 'outdated') {
    updates.impactScore = v.impactScore ?? suggestion.impactScore;
    updates.confidenceScore = v.confidenceScore ?? 15;
    updates.riskScore = v.riskScore ?? suggestion.riskScore;
  } else {
    if (v.impactScore != null) updates.impactScore = v.impactScore;
    if (v.confidenceScore != null) updates.confidenceScore = v.confidenceScore;
    if (v.riskScore != null) updates.riskScore = v.riskScore;
  }
  ctx.db.updateSuggestion(suggestionId, updates as Parameters<typeof ctx.db.updateSuggestion>[1]);

  // Re-generate embedding with updated content
  try {
    const { generateAndStoreEmbedding } = await import('../../memory/lifecycle.js');
    await generateAndStoreEmbedding(ctx.db, 'suggestion', suggestionId, { title: v.title ?? suggestion.title, summaryMd: v.summaryMd ?? suggestion.summaryMd });
  } catch { /* non-fatal */ }

  return {
    llmCalls: 1,
    tokensUsed: tokens,
    phases: ['prepare', 'evaluate', 'apply'],
    result: {
      suggestionId,
      suggestionTitle: v.title,
      verdict: v.verdict,
      verdictNote: v.verdictNote,
      previousCount: suggestion.revalidationCount,
      newCount: suggestion.revalidationCount + 1,
    },
    lastError: errorHint(result),
  };
}
