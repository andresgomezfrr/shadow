import type { JobContext, JobHandlerResult, DaemonSharedState } from '../job-handlers.js';
import { loadAutonomyConfig, effortWithinLimit } from '../../autonomy/rules.js';

// ---------------------------------------------------------------------------
// Auto-Plan Job
// ---------------------------------------------------------------------------

export async function handleAutoPlan(ctx: JobContext, _shared: DaemonSharedState): Promise<JobHandlerResult> {
  const config = loadAutonomyConfig(ctx.db);
  const { planRules } = config;

  if (!planRules.enabled || planRules.repoIds.length === 0) {
    return { llmCalls: 0, tokensUsed: 0, phases: ['filtering'], result: { skipped: true, reason: 'disabled or no repos' } };
  }

  // --- Phase: filtering (DB only, 0 tokens) ---
  ctx.setPhase('filtering');

  const allOpen = ctx.db.listSuggestions({ status: 'open' });
  const now = Date.now();
  const minAgeMs = planRules.minAgeHours * 60 * 60 * 1000;

  // Track why suggestions are filtered out
  const rejections = { tooYoung: 0, lowImpact: 0, lowConfidence: 0, highRisk: 0, effortTooBig: 0, wrongKind: 0, repoNotEnabled: 0 };

  const candidates = allOpen.filter(s => {
    const ageMs = now - new Date(s.createdAt).getTime();
    if (ageMs < minAgeMs) { rejections.tooYoung++; return false; }
    if (s.impactScore < planRules.impactMin) { rejections.lowImpact++; return false; }
    if (s.confidenceScore < planRules.confidenceMin) { rejections.lowConfidence++; return false; }
    if (s.riskScore > planRules.riskMax) { rejections.highRisk++; return false; }
    if (!effortWithinLimit(s.effort, planRules.effortMax)) { rejections.effortTooBig++; return false; }
    if (planRules.kinds.length > 0 && !planRules.kinds.includes(s.kind)) { rejections.wrongKind++; return false; }
    // Repo opt-in: suggestion must belong to an enabled repo
    const suggestionRepoIds = s.repoIds.length > 0 ? s.repoIds : (s.repoId ? [s.repoId] : []);
    if (!suggestionRepoIds.some(rid => planRules.repoIds.includes(rid))) { rejections.repoNotEnabled++; return false; }
    return true;
  })
    .sort((a, b) => b.impactScore - a.impactScore)
    .slice(0, planRules.maxPerJob);

  // Build rejection summary (only include non-zero reasons)
  const rejectionReasons = Object.entries(rejections)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${k}: ${v}`);

  if (candidates.length === 0) {
    const kindsLabel = planRules.kinds.length > 0 ? planRules.kinds.join(', ') : 'all';
    return {
      llmCalls: 0, tokensUsed: 0, phases: ['filtering'],
      result: {
        skipped: true,
        totalOpen: allOpen.length,
        filtered: rejectionReasons,
        rules: `impact≥${planRules.impactMin} conf≥${planRules.confidenceMin} risk≤${planRules.riskMax} effort≤${planRules.effortMax} age≥${planRules.minAgeHours}h kinds=${kindsLabel} repos=${planRules.repoIds.length}`,
      },
    };
  }

  console.error(`[auto-plan] ${candidates.length} candidates after filtering (from ${allOpen.length} open)`);

  // --- Phase: revalidating (LLM per candidate) ---
  ctx.setPhase('revalidating');

  let totalLlmCalls = 0;
  let totalTokens = 0;
  let autoPlanned = 0;
  let autoDismissed = 0;
  let skipped = 0;
  const resultCandidates: Array<{ suggestionId: string; title: string; action: string }> = [];

  const { selectAdapter } = await import('../../backend/index.js');
  const { safeParseJson } = await import('../../backend/json-repair.js');
  const { z } = await import('zod');
  const { dismissSuggestion, acceptSuggestion } = await import('../../suggestion/engine.js');
  const adapter = selectAdapter(ctx.config);

  const verdictSchema = z.object({
    stillValid: z.boolean(),
    reason: z.string(),
  });

  for (const suggestion of candidates) {
    if (ctx.signal.aborted) break;

    const repo = suggestion.repoId ? ctx.db.getRepo(suggestion.repoId) : null;
    if (!repo) {
      skipped++;
      resultCandidates.push({ suggestionId: suggestion.id, title: suggestion.title, action: 'skipped_no_repo' });
      continue;
    }

    // Quick revalidation: does the problem still exist?
    const revalPrompt = [
      `You are Shadow, checking if a suggestion is still relevant for the codebase.`,
      ``,
      `## Suggestion`,
      `**Title:** ${suggestion.title}`,
      `**Kind:** ${suggestion.kind} | **Impact:** ${suggestion.impactScore}/5 | **Risk:** ${suggestion.riskScore}/5`,
      ``,
      suggestion.summaryMd,
      ``,
      suggestion.reasoningMd ? `### Reasoning\n${suggestion.reasoningMd}\n` : '',
      `## Task`,
      `Use Read, Grep, Glob to check if the issue/opportunity described above still exists in the codebase.`,
      `Look at the specific files and patterns mentioned. Be thorough but quick.`,
      ``,
      `Respond with ONLY JSON (no markdown fences):`,
      `{"stillValid": true/false, "reason": "1-2 sentence explanation"}`,
    ].join('\n');

    try {
      const result = await adapter.execute({
        repos: [{ id: repo.id, name: repo.name, path: repo.path }],
        title: `Auto-plan revalidate: ${suggestion.title}`,
        goal: 'Check if suggestion is still valid',
        prompt: revalPrompt,
        relevantMemories: [],
        model: ctx.config.models.revalidate,
        effort: ctx.config.efforts.revalidate,
        systemPrompt: 'Respond with ONLY valid JSON. No markdown, no explanation, no code fences.',
        allowedTools: ['Read', 'Grep', 'Glob'],
      });

      totalLlmCalls++;
      const tokens = (result.inputTokens ?? 0) + (result.outputTokens ?? 0);
      totalTokens += tokens;
      ctx.db.recordLlmUsage({ source: 'auto-plan-revalidate', sourceId: suggestion.id, model: ctx.config.models.revalidate, inputTokens: result.inputTokens ?? 0, outputTokens: result.outputTokens ?? 0 });

      if (result.status !== 'success' || !result.output) {
        skipped++;
        resultCandidates.push({ suggestionId: suggestion.id, title: suggestion.title, action: 'skipped_llm_failed' });
        continue;
      }

      const parsed = safeParseJson(result.output, verdictSchema, 'auto-plan-revalidate');
      if (!parsed.success) {
        skipped++;
        resultCandidates.push({ suggestionId: suggestion.id, title: suggestion.title, action: 'skipped_parse_failed' });
        continue;
      }

      if (!parsed.data.stillValid) {
        // Auto-dismiss: suggestion is outdated
        await dismissSuggestion(ctx.db, suggestion.id, `Auto-dismissed: ${parsed.data.reason}`, 'not_applicable');
        autoDismissed++;
        resultCandidates.push({ suggestionId: suggestion.id, title: suggestion.title, action: 'auto_dismissed' });
        console.error(`[auto-plan] Dismissed: "${suggestion.title}" — ${parsed.data.reason}`);
        continue;
      }

      // Still valid → accept as plan and create run
      ctx.setPhase('planning');
      const accepted = acceptSuggestion(ctx.db, suggestion.id, 'execute');
      if (accepted.ok && accepted.runCreated) {
        autoPlanned++;
        resultCandidates.push({ suggestionId: suggestion.id, title: suggestion.title, action: 'auto_planned' });
        console.error(`[auto-plan] Planned: "${suggestion.title}" → run ${accepted.runCreated.slice(0, 8)}`);
      } else {
        skipped++;
        resultCandidates.push({ suggestionId: suggestion.id, title: suggestion.title, action: 'skipped_accept_failed' });
      }
    } catch (e) {
      console.error(`[auto-plan] Error processing "${suggestion.title}":`, e instanceof Error ? e.message : e);
      skipped++;
      resultCandidates.push({ suggestionId: suggestion.id, title: suggestion.title, action: 'skipped_error' });
    }
  }

  // --- Notify ---
  if (autoPlanned > 0 || autoDismissed > 0) {
    ctx.db.createEvent({
      kind: 'auto_plan_complete',
      priority: 5,
      payload: { message: `Auto-plan: ${autoPlanned} planned, ${autoDismissed} dismissed, ${skipped} skipped`, autoPlanned, autoDismissed, skipped },
    });
  }

  return {
    llmCalls: totalLlmCalls,
    tokensUsed: totalTokens,
    phases: ['filtering', 'revalidating', 'planning'],
    result: { autoPlanned, autoDismissed, skipped, candidates: resultCandidates },
  };
}

// ---------------------------------------------------------------------------
// Auto-Execute Job
// ---------------------------------------------------------------------------

export async function handleAutoExecute(ctx: JobContext, _shared: DaemonSharedState): Promise<JobHandlerResult> {
  const config = loadAutonomyConfig(ctx.db);
  const { executeRules } = config;

  if (!executeRules.enabled || executeRules.repoIds.length === 0) {
    return { llmCalls: 0, tokensUsed: 0, phases: ['filtering'], result: { skipped: true, reason: 'disabled or no repos' } };
  }

  // --- Phase: filtering (DB only, 0 tokens) ---
  ctx.setPhase('filtering');

  const plannedRuns = ctx.db.listPlannedRunsForAutoExec();

  const rejections = { noSuggestion: 0, highRisk: 0, lowImpact: 0, lowConfidence: 0, effortTooBig: 0, wrongKind: 0, repoNotEnabled: 0 };

  const candidates = plannedRuns.filter(run => {
    if (!run.suggestionId) { rejections.noSuggestion++; return false; }
    const suggestion = ctx.db.getSuggestion(run.suggestionId);
    if (!suggestion) { rejections.noSuggestion++; return false; }

    if (suggestion.riskScore > executeRules.riskMax) { rejections.highRisk++; return false; }
    if (suggestion.impactScore < executeRules.impactMin) { rejections.lowImpact++; return false; }
    if (suggestion.confidenceScore < executeRules.confidenceMin) { rejections.lowConfidence++; return false; }
    if (!effortWithinLimit(suggestion.effort, executeRules.effortMax)) { rejections.effortTooBig++; return false; }
    if (executeRules.kinds.length > 0 && !executeRules.kinds.includes(suggestion.kind)) { rejections.wrongKind++; return false; }

    const runRepoIds = run.repoIds.length > 0 ? run.repoIds : [run.repoId];
    if (!runRepoIds.some(rid => executeRules.repoIds.includes(rid))) { rejections.repoNotEnabled++; return false; }

    return true;
  }).slice(0, executeRules.maxPerJob);

  const rejectionReasons = Object.entries(rejections)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${k}: ${v}`);

  if (candidates.length === 0) {
    return {
      llmCalls: 0, tokensUsed: 0, phases: ['filtering'],
      result: {
        skipped: true,
        totalPlanned: plannedRuns.length,
        filtered: rejectionReasons,
        rules: `impact≥${executeRules.impactMin} conf≥${executeRules.confidenceMin} risk≤${executeRules.riskMax} effort≤${executeRules.effortMax} kinds=${executeRules.kinds.length > 0 ? executeRules.kinds.join(', ') : 'all'} repos=${executeRules.repoIds.length}`,
      },
    };
  }

  console.error(`[auto-execute] ${candidates.length} candidates after filtering (from ${plannedRuns.length} planned)`);

  // --- Phase: executing ---
  ctx.setPhase('executing');

  let autoExecuted = 0;
  let needsReview = 0;
  let filtered = 0;
  const resultCandidates: Array<{ runId: string; action: string; reason?: string }> = [];
  const now = new Date().toISOString();

  for (const run of candidates) {
    if (ctx.signal.aborted) break;

    // HARDCODED safety gate: confidence must be high with zero doubts
    const confidenceHigh = run.confidence === 'high';
    const zerDoubts = !run.doubts || run.doubts.length === 0;

    if (!confidenceHigh || !zerDoubts) {
      // Mark as reviewed so it doesn't appear again
      ctx.db.updateRun(run.id, { autoEvalAt: now });
      needsReview++;
      const reason = !confidenceHigh
        ? `confidence=${run.confidence} (need high)`
        : `${run.doubts.length} doubt(s): ${run.doubts.slice(0, 2).join('; ')}`;
      resultCandidates.push({ runId: run.id, action: 'needs_review', reason });

      ctx.db.createEvent({
        kind: 'plan_needs_review',
        priority: 7,
        payload: {
          message: `Plan needs review: ${run.prompt.slice(0, 100)}`,
          runId: run.id,
          confidence: run.confidence,
          doubts: run.doubts,
        },
      });
      console.error(`[auto-execute] Needs review: run ${run.id.slice(0, 8)} — ${reason}`);
      continue;
    }

    // Create child execution run
    try {
      const childRun = ctx.db.createRun({
        repoId: run.repoId,
        repoIds: run.repoIds,
        suggestionId: run.suggestionId,
        taskId: run.taskId,
        parentRunId: run.id,
        kind: 'execution',
        prompt: run.resultSummaryMd ?? run.prompt,
      });

      ctx.db.updateRun(run.id, { autoEvalAt: now });
      autoExecuted++;
      resultCandidates.push({ runId: run.id, action: 'auto_executed' });
      console.error(`[auto-execute] Executing: run ${run.id.slice(0, 8)} → child ${childRun.id.slice(0, 8)}`);
    } catch (e) {
      console.error(`[auto-execute] Failed to create execution run for ${run.id.slice(0, 8)}:`, e instanceof Error ? e.message : e);
      ctx.db.updateRun(run.id, { autoEvalAt: now });
      filtered++;
      resultCandidates.push({ runId: run.id, action: 'error', reason: e instanceof Error ? e.message : String(e) });
    }
  }

  // --- Notify ---
  if (autoExecuted > 0) {
    ctx.db.createEvent({
      kind: 'auto_execute_complete',
      priority: 8,
      payload: { message: `Auto-execute: ${autoExecuted} executed, ${needsReview} need review`, autoExecuted, needsReview, filtered },
    });
  }

  return {
    llmCalls: 0, // executor doesn't make LLM calls itself; the RunQueue handles plan execution
    tokensUsed: 0,
    phases: ['filtering', 'executing', 'verifying'],
    result: { autoExecuted, needsReview, filtered, candidates: resultCandidates },
  };
}
