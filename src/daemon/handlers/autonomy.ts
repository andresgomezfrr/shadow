import type { JobContext, JobHandlerResult, DaemonSharedState } from '../job-handlers.js';
import { loadAutonomyConfig, effortWithinLimit } from '../../autonomy/rules.js';
import { log } from '../../log.js';

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

  // Per-suggestion filtering with reasons. `runId` is populated when the
  // action is 'planned' so downstream consumers (UI, MCP) can deep-link to
  // the created run without hunting for it in the reason field. Audit run
  // a109a07f: previously `reason` was overloaded with the runId UUID,
  // breaking the semantic contract of "reason = why this happened".
  type SuggestionEntry = { suggestionId: string; title: string; action: string; reason?: string; runId?: string };
  const allEntries: SuggestionEntry[] = [];
  const passed: typeof allOpen = [];

  for (const s of allOpen) {
    const ageMs = now - new Date(s.createdAt).getTime();
    const ageHours = Math.round(ageMs / 3_600_000);
    if (ageMs < minAgeMs) { allEntries.push({ suggestionId: s.id, title: s.title, action: 'skip', reason: `too young (${ageHours}h < ${planRules.minAgeHours}h)` }); continue; }
    if (s.impactScore < planRules.impactMin) { allEntries.push({ suggestionId: s.id, title: s.title, action: 'skip', reason: `low impact (${s.impactScore} < ${planRules.impactMin})` }); continue; }
    if (s.confidenceScore < planRules.confidenceMin) { allEntries.push({ suggestionId: s.id, title: s.title, action: 'skip', reason: `low confidence (${s.confidenceScore} < ${planRules.confidenceMin})` }); continue; }
    if (s.riskScore > planRules.riskMax) { allEntries.push({ suggestionId: s.id, title: s.title, action: 'skip', reason: `high risk (${s.riskScore} > ${planRules.riskMax})` }); continue; }
    if (!effortWithinLimit(s.effort, planRules.effortMax)) { allEntries.push({ suggestionId: s.id, title: s.title, action: 'skip', reason: `effort too big (${s.effort} > ${planRules.effortMax})` }); continue; }
    if (planRules.kinds.length > 0 && !planRules.kinds.includes(s.kind)) { allEntries.push({ suggestionId: s.id, title: s.title, action: 'skip', reason: `kind not allowed (${s.kind})` }); continue; }
    const suggestionRepoIds = s.repoIds.length > 0 ? s.repoIds : (s.repoId ? [s.repoId] : []);
    if (!suggestionRepoIds.some(rid => planRules.repoIds.includes(rid))) { allEntries.push({ suggestionId: s.id, title: s.title, action: 'skip', reason: 'repo not enabled' }); continue; }
    passed.push(s);
  }

  const candidates = passed
    .sort((a, b) => b.impactScore - a.impactScore)
    .slice(0, planRules.maxPerJob);

  if (candidates.length === 0) {
    return {
      llmCalls: 0, tokensUsed: 0, phases: ['filtering'],
      result: { skipped: true, totalOpen: allOpen.length, candidates: allEntries },
    };
  }

  log.error(`[auto-plan] ${candidates.length} candidates after filtering (from ${allOpen.length} open)`);

  // --- Phase: revalidating (LLM per candidate) ---
  ctx.setPhase('revalidating');

  let totalLlmCalls = 0;
  let totalTokens = 0;
  let autoPlanned = 0;
  let autoDismissed = 0;
  let skipped = 0;
  // Start with the filtered entries from phase 1, then append revalidation/planning results
  const resultCandidates: SuggestionEntry[] = [...allEntries];

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
      resultCandidates.push({ suggestionId: suggestion.id, title: suggestion.title, action: 'skip', reason: 'repo not found' });
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
        signal: ctx.signal,
      });

      totalLlmCalls++;
      const tokens = (result.inputTokens ?? 0) + (result.outputTokens ?? 0);
      totalTokens += tokens;
      ctx.db.recordLlmUsage({ source: 'auto-plan-revalidate', sourceId: suggestion.id, model: ctx.config.models.revalidate, inputTokens: result.inputTokens ?? 0, outputTokens: result.outputTokens ?? 0 });

      if (result.status !== 'success' || !result.output) {
        skipped++;
        resultCandidates.push({ suggestionId: suggestion.id, title: suggestion.title, action: 'skip', reason: 'revalidation LLM failed' });
        continue;
      }

      const parsed = safeParseJson(result.output, verdictSchema, 'auto-plan-revalidate');
      if (!parsed.success) {
        skipped++;
        resultCandidates.push({ suggestionId: suggestion.id, title: suggestion.title, action: 'skip', reason: 'revalidation parse failed' });
        continue;
      }

      if (!parsed.data.stillValid) {
        // Auto-dismiss: suggestion is outdated
        await dismissSuggestion(ctx.db, suggestion.id, `Auto-dismissed: ${parsed.data.reason}`, 'not_applicable');
        autoDismissed++;
        resultCandidates.push({ suggestionId: suggestion.id, title: suggestion.title, action: 'dismissed', reason: parsed.data.reason });
        log.error(`[auto-plan] Dismissed: "${suggestion.title}" — ${parsed.data.reason}`);
        continue;
      }

      // Still valid → accept as plan and create run
      ctx.setPhase('planning');
      const accepted = acceptSuggestion(ctx.db, suggestion.id, 'execute');
      if (accepted.ok && accepted.runCreated) {
        autoPlanned++;
        resultCandidates.push({
          suggestionId: suggestion.id,
          title: suggestion.title,
          action: 'planned',
          reason: 'Plan accepted',
          runId: accepted.runCreated,
        });
        log.error(`[auto-plan] Planned: "${suggestion.title}" → run ${accepted.runCreated.slice(0, 8)}`);
      } else {
        skipped++;
        resultCandidates.push({ suggestionId: suggestion.id, title: suggestion.title, action: 'skip', reason: 'accept failed' });
      }
    } catch (e) {
      log.error(`[auto-plan] Error processing "${suggestion.title}":`, e instanceof Error ? e.message : e);
      skipped++;
      resultCandidates.push({ suggestionId: suggestion.id, title: suggestion.title, action: 'skip', reason: e instanceof Error ? e.message : 'unknown error' });
    }
  }

  // --- Notify ---
  if (autoPlanned > 0 || autoDismissed > 0) {
    ctx.db.createEvent({
      kind: 'auto_plan_complete',
      priority: 5,
      payload: { message: `Auto-plan: ${autoPlanned} planned, ${autoDismissed} dismissed, ${skipped} skipped`, jobId: ctx.jobId, autoPlanned, autoDismissed, skipped },
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

  // `childRunId` is populated when action is 'auto_executed' so consumers
  // can deep-link to the spawned execution run without re-querying.
  // Audit run a109a07f.
  type RunEntry = { runId: string; title?: string; action: string; reason?: string; childRunId?: string };
  const allEntries: RunEntry[] = [];
  const passed: typeof plannedRuns = [];

  for (const run of plannedRuns) {
    const suggestion = run.suggestionId ? ctx.db.getSuggestion(run.suggestionId) : null;
    const title = suggestion?.title ?? run.prompt.slice(0, 80);

    if (!run.suggestionId || !suggestion) {
      allEntries.push({ runId: run.id, title, action: 'skip', reason: 'no suggestion linked' });
      continue;
    }
    if (suggestion.riskScore > executeRules.riskMax) {
      allEntries.push({ runId: run.id, title, action: 'skip', reason: `high risk (${suggestion.riskScore} > ${executeRules.riskMax})` });
      continue;
    }
    if (suggestion.impactScore < executeRules.impactMin) {
      allEntries.push({ runId: run.id, title, action: 'skip', reason: `low impact (${suggestion.impactScore} < ${executeRules.impactMin})` });
      continue;
    }
    if (suggestion.confidenceScore < executeRules.confidenceMin) {
      allEntries.push({ runId: run.id, title, action: 'skip', reason: `low confidence (${suggestion.confidenceScore} < ${executeRules.confidenceMin})` });
      continue;
    }
    if (!effortWithinLimit(suggestion.effort, executeRules.effortMax)) {
      allEntries.push({ runId: run.id, title, action: 'skip', reason: `effort too big (${suggestion.effort} > ${executeRules.effortMax})` });
      continue;
    }
    if (executeRules.kinds.length > 0 && !executeRules.kinds.includes(suggestion.kind)) {
      allEntries.push({ runId: run.id, title, action: 'skip', reason: `kind not allowed (${suggestion.kind})` });
      continue;
    }
    const runRepoIds = run.repoIds.length > 0 ? run.repoIds : [run.repoId];
    if (!runRepoIds.some(rid => executeRules.repoIds.includes(rid))) {
      allEntries.push({ runId: run.id, title, action: 'skip', reason: 'repo not enabled' });
      continue;
    }
    passed.push(run);
  }

  const candidates = passed.slice(0, executeRules.maxPerJob);

  if (candidates.length === 0) {
    return {
      llmCalls: 0, tokensUsed: 0, phases: ['filtering'],
      result: {
        skipped: true,
        totalPlanned: plannedRuns.length,
        candidates: allEntries,
        rules: `impact≥${executeRules.impactMin} conf≥${executeRules.confidenceMin} risk≤${executeRules.riskMax} effort≤${executeRules.effortMax} kinds=${executeRules.kinds.length > 0 ? executeRules.kinds.join(', ') : 'all'} repos=${executeRules.repoIds.length}`,
      },
    };
  }

  log.error(`[auto-execute] ${candidates.length} candidates after filtering (from ${plannedRuns.length} planned)`);

  // --- Phase: executing ---
  ctx.setPhase('executing');

  let autoExecuted = 0;
  let needsReview = 0;
  let filtered = 0;
  const now = new Date().toISOString();

  for (const run of candidates) {
    if (ctx.signal.aborted) break;

    const suggestion = run.suggestionId ? ctx.db.getSuggestion(run.suggestionId) : null;
    const title = suggestion?.title ?? run.prompt.slice(0, 80);

    // HARDCODED safety gate: confidence must be high with zero doubts
    const confidenceHigh = run.confidence === 'high';
    const zerDoubts = !run.doubts || run.doubts.length === 0;

    if (!confidenceHigh || !zerDoubts) {
      // Mark as seen-by-autonomy so this run isn't re-evaluated next tick.
      // autoEvalAt is outcome-agnostic: it only records "auto-execute has
      // looked at this" — the *why* lives in the audit entry + the run's
      // outcome/doubts. See audit R-11.
      ctx.db.updateRun(run.id, { autoEvalAt: now });
      needsReview++;
      const reason = !confidenceHigh
        ? `confidence=${run.confidence} (need high)`
        : `${run.doubts.length} doubt(s): ${run.doubts.slice(0, 2).join('; ')}`;
      allEntries.push({ runId: run.id, title, action: 'needs_review', reason });

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
      log.error(`[auto-execute] Needs review: run ${run.id.slice(0, 8)} — ${reason}`);
      continue;
    }

    // Create child execution run. Parent stays in 'planned' — the aggregation
    // in runner/service.ts will finalize the parent based on the child's
    // result (awaiting_pr if PR created, done if no changes, failed on error).
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
      allEntries.push({ runId: run.id, title, action: 'auto_executed', childRunId: childRun.id });
      log.error(`[auto-execute] Executing: run ${run.id.slice(0, 8)} → child ${childRun.id.slice(0, 8)}`);
    } catch (e) {
      log.error(`[auto-execute] Failed to create execution run for ${run.id.slice(0, 8)}:`, e instanceof Error ? e.message : e);
      ctx.db.updateRun(run.id, { autoEvalAt: now });
      filtered++;
      allEntries.push({ runId: run.id, title, action: 'error', reason: e instanceof Error ? e.message : String(e) });
    }
  }

  // --- Notify ---
  if (autoExecuted > 0) {
    ctx.db.createEvent({
      kind: 'auto_execute_complete',
      priority: 8,
      payload: { message: `Auto-execute: ${autoExecuted} executed, ${needsReview} need review`, jobId: ctx.jobId, autoExecuted, needsReview, filtered },
    });
  }

  return {
    llmCalls: 0, // executor doesn't make LLM calls itself; the RunQueue handles plan execution
    tokensUsed: 0,
    phases: ['filtering', 'executing', 'verifying'],
    result: { autoExecuted, needsReview, filtered, candidates: allEntries },
  };
}
