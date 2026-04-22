import { mkdirSync, writeFileSync } from 'node:fs';
import { execSync, execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';

import type { ShadowConfig } from '../config/load-config.js';
import type { ShadowDatabase } from '../storage/database.js';
import type { RunRecord } from '../storage/models.js';
import type { ObjectivePack, RepoPack } from '../backend/types.js';
import type { EventBus } from '../web/event-bus.js';
import { selectAdapter } from '../backend/index.js';
import { ConfidenceEvaluationSchema, type ConfidenceEvaluation } from './schemas.js';
import { aggregateParentStatus } from './state-machine.js';
import { isEmptyPlanInDisguise } from './plan-validation.js';
import { log } from '../log.js';
import { outputLanguageInstruction } from '../analysis/locale.js';

const DEFAULT_RUNNER_PERSONALITY = 'You are Shadow, a proactive coding companion. Show initiative and personality.';

/**
 * RunnerService processes queued runs by sending them through the configured
 * backend adapter (Claude CLI or Agent SDK).
 */
export class RunnerService {
  constructor(
    private readonly config: ShadowConfig,
    private readonly db: ShadowDatabase,
    private readonly eventBus?: EventBus,
  ) {}

  private setActivity(runId: string, kind: string, activity: string | null): void {
    try { this.db.updateRun(runId, { activity }); } catch { /* best-effort */ }
    this.eventBus?.emit({ type: 'run:phase', data: { runId, runType: kind === 'execution' ? 'run:execute' : 'run:plan', activity } });
  }

  /**
   * Process the next queued run (thin wrapper for processRun).
   */
  async processNextRun(): Promise<{ processed: boolean; run: RunRecord | null }> {
    const queuedRuns = this.db.listRuns({ status: 'queued' });
    if (queuedRuns.length === 0) {
      return { processed: false, run: null };
    }
    const run = queuedRuns[queuedRuns.length - 1]; // oldest first (list is DESC, so last = oldest)
    return this.processRun(run.id);
  }

  /**
   * Process a specific run by ID.
   *
   * 1. Claim it (status -> 'running')
   * 2. Build ObjectivePack with multi-repo support
   * 3. Execute via selectAdapter(config)
   * 4. Post-process: update run status, record llm_usage, capture git diff, write artifacts
   * 5. Apply trust delta (success: +1.5, failure: -2.0)
   */
  async processRun(runId: string): Promise<{ processed: boolean; run: RunRecord | null }> {
    const run = this.db.getRun(runId);
    if (!run) return { processed: false, run: null };
    const now = new Date().toISOString();

    // Claim it
    this.db.transitionRun(run.id, 'running');
    this.db.updateRun(run.id, { startedAt: now });
    this.setActivity(run.id, run.kind, 'preparing');

    // Declared outside try so cleanup can access them in catch
    let worktreePath: string | null = null;
    let mainRepoCwd: string | null = null;
    const repoIds = run.repoIds.length > 0 ? run.repoIds : [run.repoId];
    const repos: RepoPack[] = [];

    try {
      // 3. Build ObjectivePack with multi-repo support

      for (const repoId of repoIds) {
        const repo = this.db.getRepo(repoId);
        if (repo) {
          repos.push({
            id: repo.id,
            name: repo.name,
            path: repo.path,
          });
        }
      }

      // If no repos resolved, use a fallback from the run's primary repoId
      if (repos.length === 0) {
        repos.push({
          id: run.repoId,
          name: run.repoId,
          path: '.',
        });
      }

      // For execution runs, create a git worktree
      if (run.kind === 'execution' && repos[0].path !== '.') {
        mainRepoCwd = repos[0].path;
        const branchName = `shadow/${run.id.slice(0, 8)}`;
        worktreePath = join(repos[0].path, '.shadow-worktrees', run.id.slice(0, 8));
        try {
          mkdirSync(join(repos[0].path, '.shadow-worktrees'), { recursive: true });
          execFileSync('git', ['worktree', 'add', worktreePath, '-b', branchName], {
            cwd: repos[0].path,
            stdio: 'pipe',
            timeout: 10_000,
          });
          // Override repo path with worktree path for execution
          repos[0] = { ...repos[0], path: worktreePath };
          this.db.updateRun(run.id, { worktreePath });
        } catch (wtErr) {
          log.error('[runner] Failed to create worktree, running in main repo:', wtErr instanceof Error ? wtErr.message : wtErr);
          worktreePath = null;
        }
      }

      // 4. Build briefing — Shadow provides context, Claude does the work
      const suggestion = run.suggestionId
        ? this.db.getSuggestion(run.suggestionId)
        : null;

      const repo = this.db.getRepo(run.repoId);
      const soulMem = this.db.listMemories({ archived: false }).find(m => m.kind === 'soul_reflection');
      // Audit P-12: soul goes into --append-system-prompt (system context), not
      // into the user briefing. Semantics correct + user prompt stays focused
      // on the task. Fallback to a small default if the soul memory doesn't
      // exist yet (fresh install, pre-reflect).
      const personalityPrompt = soulMem?.bodyMd
        ? `You are Shadow.\n\n${soulMem.bodyMd}`
        : DEFAULT_RUNNER_PERSONALITY;

      // Always plan first. Execution only via explicit child run (kind=execution).
      const planOnly = run.kind !== 'execution';

      const briefing = [
        `## Suggestion: ${suggestion?.title ?? run.kind}`,
        suggestion?.kind ? `Kind: ${suggestion.kind}` : '',
        '',
        suggestion?.summaryMd ?? run.prompt,
        suggestion?.reasoningMd ? `\n## Reasoning\n${suggestion.reasoningMd}` : '',
        '',
        repos.length > 1
          ? `## Repositories\n${repos.map((r) => `- ${r.name} (${r.path})`).join('\n')}`
          : `## Repository\n- ${repos[0].name} (${repos[0].path})`,
        repo?.testCommand ? `- Test: \`${repo.testCommand}\`` : '',
        repo?.buildCommand ? `- Build: \`${repo.buildCommand}\`` : '',
        repo?.lintCommand ? `- Lint: \`${repo.lintCommand}\`` : '',
        '',
        '## Instructions',
        'You have access to the filesystem and any available MCP tools.',
        'Use them to gather any additional context you need.',
        '',
        '**You are running autonomously.** There is no human to answer questions.',
        '- Make reasonable assumptions when faced with ambiguity and document them in the plan.',
        '- If a tool call is denied or fails, do NOT retry it — adapt your approach using other available tools.',
        '- Never ask questions: proceed with your best interpretation.',
        '',
        planOnly
          ? [
              'Generate a detailed IMPLEMENTATION PLAN. Do NOT write code.',
              'Read the relevant source files, search memories and external tools for context, then structure your plan as:',
              '## Files to modify',
              '## Changes per file',
              '## Risks and edge cases',
              '## Verification steps',
              '',
              '**COMPLETION MARKER**: End your plan file with a line containing exactly:',
              '',
              '    <!-- PLAN COMPLETE -->',
              '',
              'This lets the runner verify you finished rather than being interrupted mid-plan.',
            ].join('\n')
          : [
              'Implement the plan below. Read the relevant files, make the changes, and verify.',
              '',
              '**IMPORTANT**: When finished, commit your changes with `git add -A && git commit -m "<descriptive message>"`.',
              'Uncommitted changes will be lost. Only commit; do NOT push.',
            ].join('\n'),
        outputLanguageInstruction(this.db.ensureProfile().locale),
      ].filter(Boolean).join('\n');

      const fullPrompt = briefing;

      // Prepare artifact directory
      const artifactDir = join(
        this.config.resolvedArtifactsDir ?? join(homedir(), '.shadow', 'artifacts'),
        'runs',
        run.id,
      );
      mkdirSync(artifactDir, { recursive: true });

      // All MCP tools always available. Execution also gets filesystem write access.
      const allowedTools = planOnly ? ['mcp__*'] : ['mcp__*', 'Edit', 'Write', 'Bash'];
      // AskUserQuestion has no place in autonomous sessions — no human is listening.
      // Built-in tools are not covered by --allowedTools globs, so deny explicitly.
      const disallowedTools = ['AskUserQuestion'];
      const permissionMode = planOnly ? 'plan' as const : 'acceptEdits' as const;

      const pack: ObjectivePack = {
        runId: run.id,
        repos,
        suggestionId: run.suggestionId,
        title: suggestion?.title ?? `Run: ${run.kind}`,
        goal: run.prompt,
        prompt: fullPrompt,
        relevantMemories: [],
        artifactDir,
        model: this.config.models.runner,
        effort: this.config.efforts.runner,
        systemPrompt: null, // No override — Claude uses default behavior with MCP tools + filesystem
        appendSystemPrompt: personalityPrompt, // Soul in system context (audit P-12)
        allowedTools,
        disallowedTools,
        permissionMode,
        timeoutMs: this.config.runnerTimeoutMs,
      };

      // 4b. Checkpoint: capture pre-execution state
      const executionCwd = repos[0].path;
      let snapshotRef: string | null = null;
      if (run.kind === 'execution') {
        try {
          snapshotRef = execSync('git rev-parse HEAD', { cwd: executionCwd, encoding: 'utf-8', timeout: 5_000 }).trim();
          this.db.updateRun(run.id, { snapshotRef });
        } catch { /* non-fatal — proceed without snapshot */ }
      }

      // 5. Execute via backend adapter
      this.setActivity(run.id, run.kind, planOnly ? 'planning' : 'executing');
      const adapter = selectAdapter(this.config);
      const result = await adapter.execute(pack);

      // 5a. Capture plan from session transcript (plan mode writes to ~/.claude/plans/)
      // The JSON result field is empty in plan mode — the real plan is in the file.
      const isSuccess = result.status === 'success';
      let effectivePlan: string = result.output;

      if (planOnly && isSuccess && result.sessionId) {
        try {
          const { capturePlanFromSession } = await import('./plan-capture.js');
          const capture = capturePlanFromSession(result.sessionId, executionCwd);
          if (capture.content) {
            effectivePlan = capture.content;
            writeFileSync(join(artifactDir, 'plan.md'), capture.content, 'utf-8');
            log.error(`[runner] Captured plan from session: ${capture.filePath} (${capture.content.length} chars)`);
            // Audit P-04: verify LLM emitted the completion marker. Missing marker
            // is a soft-fail signal — the plan might be a half-written doc that
            // looks structured but stops mid-thought. Log only (user decision:
            // warn, don't fail loud) so downstream confidence eval still runs.
            if (!/<!--\s*PLAN COMPLETE\s*-->/i.test(capture.content.trimEnd().slice(-200))) {
              log.error('[runner] Plan missing "<!-- PLAN COMPLETE -->" marker — proceeding but may be incomplete');
            }
          }
        } catch (err) {
          log.error('[runner] Plan capture failed (non-fatal):', err instanceof Error ? err.message : err);
        }
      }

      // 5a-bis. Empty plan = failure.
      // Claude can exit 0 without writing to ~/.claude/plans/ (e.g. blocked on a question
      // it couldn't ask, hit permission errors, or gave up). Treat that as a real failure
      // instead of passing it downstream as a 'planned' run with empty resultSummaryMd.
      if (planOnly && isSuccess && isEmptyPlanInDisguise(effectivePlan)) {
        const emptyFinishedAt = new Date().toISOString();
        const reason = !effectivePlan.trim()
          ? 'Plan mode produced no output — no plan written to ~/.claude/plans/'
          : 'Plan mode produced no actionable content — missing structure and insufficient detail';
        this.db.transitionRun(run.id, 'failed');
        this.db.updateRun(run.id, {
          errorSummary: reason,
          artifactDir,
          sessionId: result.sessionId ?? null,
          finishedAt: emptyFinishedAt,
        });

        if (run.parentRunId) {
          const parentId = run.parentRunId;
          const siblings = this.db.listRuns({ parentRunId: parentId });
          const parentStatus = aggregateParentStatus(siblings);
          if (parentStatus !== null) {
            this.db.withTransaction(() => {
              this.db.transitionRun(parentId, parentStatus);
              this.db.updateRun(parentId, { finishedAt: emptyFinishedAt });
            });
          }
        }

        try {
          const { applyBondDelta } = await import('../profile/bond.js');
          applyBondDelta(this.db, 'run_failed');
        } catch (e) { log.error('[runner] bond delta failed:', e); }

        this.db.createEvent({
          kind: 'run_failed',
          priority: 7,
          payload: { message: 'Run failed: empty plan', runId: run.id, repoId: run.repoId },
        });

        this.db.createAuditEvent({
          interface: 'runner',
          action: 'run-failure',
          targetKind: 'run',
          targetId: run.id,
          detail: { reason: 'empty_plan', sessionId: result.sessionId },
        });

        this.setActivity(run.id, run.kind, null);
        const updatedRun = this.db.getRun(run.id)!;
        this.cleanupWorktree(worktreePath, mainRepoCwd);
        return { processed: true, run: updatedRun };
      }

      // 5b. Evaluate confidence on plans (signal for the user, no auto-execute)
      if (planOnly && isSuccess) {
        this.setActivity(run.id, run.kind, 'evaluating');
        try {
          const evaluation = await this.evaluateConfidence(effectivePlan, pack);
          this.db.updateRun(run.id, {
            confidence: evaluation.confidence,
            doubts: evaluation.doubts,
          });
          log.error(`[runner] Plan confidence=${evaluation.confidence}, doubts=${evaluation.doubts.length}`);
        } catch {
          // Non-fatal — plan is still valid without confidence score
        }
      }

      // 6. Post-process
      const finishedAt = new Date().toISOString();

      // Write summary artifact
      const outputForSummary = planOnly ? effectivePlan : result.output;
      const summaryContent = [
        `# Run Summary: ${run.id}`,
        '',
        `**Status:** ${result.status}`,
        `**Started:** ${run.startedAt ?? now}`,
        `**Finished:** ${finishedAt}`,
        `**Exit Code:** ${result.exitCode}`,
        '',
        '## Output',
        '',
        outputForSummary,
        '',
        result.summaryHint ? `## Summary\n\n${result.summaryHint}` : '',
      ].join('\n');

      writeFileSync(join(artifactDir, 'summary.md'), summaryContent, 'utf-8');

      // Update run status — child execution runs go straight to 'done' (no review needed)
      const finalStatus = isSuccess ? (run.parentRunId ? 'done' : 'planned') : 'failed';
      this.db.transitionRun(run.id, finalStatus);
      this.db.updateRun(run.id, {
        resultSummaryMd: (planOnly ? effectivePlan : null) || result.summaryHint || result.output,
        errorSummary: isSuccess ? null : (result.output.slice(0, 500) || 'Execution failed'),
        artifactDir,
        sessionId: result.sessionId ?? null,
        outcome: run.parentRunId && isSuccess ? 'executed' : undefined,
        finishedAt,
      });

      // 6b. Capture post-execution state — auto-commit any dirty worktree, then read refs
      if (run.kind === 'execution' && snapshotRef && isSuccess) {
        try {
          // Safety net: capture any edits Claude left uncommitted
          const porcelain = execFileSync('git', ['status', '--porcelain'], {
            cwd: executionCwd, encoding: 'utf-8', timeout: 5_000,
          }).trim();
          if (porcelain) {
            const shortTitle = (suggestion?.title ?? 'auto-execute').slice(0, 60);
            execFileSync('git', ['add', '-A'], { cwd: executionCwd, timeout: 10_000 });
            execFileSync('git', [
              'commit',
              '-m', `[shadow] ${shortTitle}\n\nAuto-committed by Shadow runner (run ${run.id.slice(0, 8)}).`,
            ], {
              cwd: executionCwd,
              env: {
                ...process.env,
                GIT_AUTHOR_NAME: 'Shadow',
                GIT_AUTHOR_EMAIL: 'shadow@local',
                GIT_COMMITTER_NAME: 'Shadow',
                GIT_COMMITTER_EMAIL: 'shadow@local',
              },
              timeout: 15_000,
            });
            log.error(`[runner] Auto-committed dirty worktree for ${run.id.slice(0, 8)}`);
          }

          const resultRef = execSync('git rev-parse HEAD', {
            cwd: executionCwd, encoding: 'utf-8', timeout: 5_000,
          }).trim();
          let diffStat: string | null = null;
          if (resultRef !== snapshotRef) {
            diffStat = execFileSync('git', ['diff', '--stat', `${snapshotRef}..${resultRef}`], {
              cwd: executionCwd, encoding: 'utf-8', timeout: 10_000,
            }).trim();
          }
          this.db.updateRun(run.id, { resultRef, diffStat });
        } catch (e) {
          log.error(`[runner] Checkpoint capture failed for ${run.id.slice(0, 8)}:`, e instanceof Error ? e.message : e);
        }
      }

      // 6c. Post-execution verification (build/lint/test)
      if (run.kind === 'execution' && isSuccess) {
        this.setActivity(run.id, run.kind, 'verifying');
        try {
          const { results: verificationResults, allPassed } = this.runVerification(run.repoId, executionCwd);
          const hasCommands = Object.keys(verificationResults).length > 0;
          const verified = hasCommands ? (allPassed ? 'verified' : 'needs_review') : 'unverified';
          this.db.updateRun(run.id, { verification: verificationResults, verified } as Parameters<typeof this.db.updateRun>[1]);
        } catch { /* non-fatal — verification failure shouldn't block the run */ }
      }

      // 6d. Summary-diff coherence check: detect silent hallucination where the LLM's
      //     summary claims modifications but the diff is empty. Overrides verified and
      //     blocks parent propagation so the user reviews before anything merges.
      let summaryDiffMismatch = false;
      if (run.kind === 'execution' && isSuccess) {
        const current = this.db.getRun(run.id) ?? run;
        const diffEmpty = !current.diffStat || current.diffStat.trim() === '';
        const summary = current.resultSummaryMd ?? '';
        const CHANGE_VERBS = /\b(modif\w+|add\w+|remov\w+|fix\w+|refactor\w+|implement\w+|creat\w+|delet\w+|updat\w+|writ\w+|renam\w+)\b/i;
        if (diffEmpty && CHANGE_VERBS.test(summary)) {
          summaryDiffMismatch = true;
          this.db.updateRun(run.id, {
            verified: 'needs_review',
            closedNote: 'Summary claims changes but diff is empty — review before merging',
          } as Parameters<typeof this.db.updateRun>[1]);
          this.db.createEvent({
            kind: 'plan_needs_review',
            priority: 7,
            payload: {
              runId: run.id,
              reason: 'summary_mismatch',
              title: suggestion?.title ?? `Run ${run.id.slice(0, 8)}`,
              repoId: run.repoId,
            },
          });
          log.error(`[runner] summary-diff mismatch flagged for run ${run.id.slice(0, 8)}`);
        }
      }

      // Propagate to parent via multi-child aggregation — PR-aware for execution children.
      // Skip propagation entirely if summary-diff mismatch: user must review the child
      // before the parent can finalize. Parent stays in 'planned'.
      if (run.parentRunId && !summaryDiffMismatch) {
        const parentId = run.parentRunId;
        const siblings = this.db.listRuns({ parentRunId: parentId });
        const aggregated = aggregateParentStatus(siblings);
        if (aggregated === 'done' && run.kind === 'execution') {
          // Re-fetch current run to get fresh diffStat/prUrl after updates above
          const current = this.db.getRun(run.id) ?? run;
          const hasChanges = !!(current.diffStat && current.diffStat.trim());
          this.db.withTransaction(() => {
            if (current.prUrl) {
              // PR created → parent waits for merge/close (pr-sync job will finalize)
              this.db.transitionRun(parentId, 'awaiting_pr');
              this.db.updateRun(parentId, { finishedAt });
            } else if (!hasChanges) {
              // No-op: Claude ran but nothing to change
              const justification = current.resultSummaryMd?.slice(0, 500) || 'No changes needed';
              this.db.transitionRun(parentId, 'done');
              this.db.updateRun(parentId, {
                finishedAt,
                outcome: 'no_changes',
                closedNote: justification,
              });
            } else {
              // Changes committed but no PR (direct push or manual PR flow)
              this.db.transitionRun(parentId, 'done');
              this.db.updateRun(parentId, { finishedAt, outcome: 'executed' });
            }
          });
        } else if (aggregated !== null) {
          this.db.withTransaction(() => {
            this.db.transitionRun(parentId, aggregated);
            this.db.updateRun(parentId, { finishedAt });
          });
        }
      }

      // Record LLM usage
      if (result.inputTokens !== undefined || result.outputTokens !== undefined) {
        this.db.recordLlmUsage({
          source: 'runner',
          sourceId: run.id,
          model: this.config.models.runner,
          inputTokens: result.inputTokens ?? 0,
          outputTokens: result.outputTokens ?? 0,
        });
      }

      // 7. Apply bond delta (data-driven recomputation of axes)
      try {
        const { applyBondDelta } = await import('../profile/bond.js');
        applyBondDelta(this.db, isSuccess ? 'run_success' : 'run_failed');
      } catch (e) { log.error('[runner] bond delta failed:', e); }

      // Chronicle milestone: first_auto_execute (first successful auto-spawned child run)
      if (isSuccess && run.parentRunId) {
        try {
          const row = this.db.rawDb
            .prepare(
              `SELECT COUNT(*) AS n FROM runs
               WHERE parent_run_id IS NOT NULL AND status = 'done'
                 AND outcome IN ('executed','executed_manual')`,
            )
            .get() as { n: number };
          if (row.n === 1) {
            const { triggerChronicleMilestone } = await import('../analysis/chronicle.js');
            triggerChronicleMilestone(this.db, 'first_auto_execute', {
              title: 'First autonomous execution',
              data: { runId: run.id, repoId: run.repoId, prompt: run.prompt.slice(0, 200) },
            }).catch((e) => log.error('[chronicle] first_auto_execute hook failed:', e));
          }
        } catch (e) { log.error('[chronicle] first_auto_execute hook failed:', e); }
      }

      this.db.createInteraction({
        interface: 'runner',
        kind: 'run-complete',
        outputSummary: `Run ${run.id} ${result.status}.`,
      });

      // Audit trail
      this.db.createAuditEvent({
        interface: 'runner',
        action: isSuccess ? 'run-success' : 'run-failure',
        targetKind: 'run',
        targetId: run.id,
        detail: {
          status: result.status,
          exitCode: result.exitCode,
          artifactDir,
          inputTokens: result.inputTokens ?? 0,
          outputTokens: result.outputTokens ?? 0,
        },
      });

      // Create event for top-level plan runs (not child execution runs)
      if (!run.parentRunId && isSuccess) {
        this.db.createEvent({ kind: 'run_completed', priority: 6, payload: { message: `Plan ready: ${run.prompt.slice(0, 80)}`, runId: run.id, repoId: run.repoId } });
      }

      this.setActivity(run.id, run.kind, null);
      const updatedRun = this.db.getRun(run.id)!;
      this.cleanupWorktree(worktreePath, mainRepoCwd);
      return { processed: true, run: updatedRun };
    } catch (error) {
      // Handle unexpected errors
      this.setActivity(run.id, run.kind, null);
      const finishedAt = new Date().toISOString();
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.db.transitionRun(run.id, 'failed');
      this.db.updateRun(run.id, {
        errorSummary: errorMessage.slice(0, 500),
        finishedAt,
      });

      // Propagate failure to parent via multi-child aggregation
      if (run.parentRunId) {
        const parentId = run.parentRunId;
        const siblings = this.db.listRuns({ parentRunId: parentId });
        const parentStatus = aggregateParentStatus(siblings);
        if (parentStatus !== null) {
          this.db.withTransaction(() => {
            this.db.transitionRun(parentId, parentStatus);
            this.db.updateRun(parentId, { finishedAt });
          });
        }
      }

      // Create run_failed event
      this.db.createEvent({ kind: 'run_failed', priority: 8, payload: { message: `Run failed: ${errorMessage.slice(0, 80)}`, runId: run.id, repoId: run.repoId } });

      // Apply failure bond delta
      try {
        const { applyBondDelta } = await import('../profile/bond.js');
        applyBondDelta(this.db, 'run_failed');
      } catch (e) { log.error('[runner] bond delta failed:', e); }

      this.db.createAuditEvent({
        interface: 'runner',
        action: 'run-error',
        targetKind: 'run',
        targetId: run.id,
        detail: { error: errorMessage },
      });

      const updatedRun = this.db.getRun(run.id)!;
      this.cleanupWorktree(worktreePath, mainRepoCwd);
      return { processed: true, run: updatedRun };
    }
  }

  /** Remove a worktree directory (branch is kept for PR drafts). */
  /**
   * Remove a worktree, retrying once on failure (e.g. transient FS lock).
   * If the second attempt also fails, record a risk observation with the
   * orphaned path so it surfaces in the dashboard — see audit R-12.
   */
  private cleanupWorktree(worktreePath: string | null, repoCwd: string | null): void {
    if (!worktreePath) return;
    const cwd = repoCwd ?? undefined;
    const tryRemove = (): string | null => {
      try {
        execFileSync('git', ['worktree', 'remove', worktreePath, '--force'], { cwd, stdio: 'pipe', timeout: 10_000 });
        return null;
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      }
    };

    const firstErr = tryRemove();
    if (!firstErr) return;

    log.error('[runner] worktree remove failed once, retrying:', firstErr);
    // Small backoff before retry (ephemeral FS lock usually clears in <1s)
    try { execFileSync('sleep', ['1'], { stdio: 'pipe' }); } catch { /* best-effort */ }

    const secondErr = tryRemove();
    if (!secondErr) return;

    log.error('[runner] worktree remove failed twice, recording risk observation:', secondErr);
    // Surface the stuck worktree as an observation so the user can reclaim disk manually
    try {
      const repos = this.db.listRepos();
      const ownerRepo = repos.find((r) => worktreePath.startsWith(r.path));
      if (ownerRepo) {
        this.db.createObservation({
          repoId: ownerRepo.id,
          kind: 'risk',
          severity: 'warning',
          title: `Stuck worktree: ${worktreePath}`,
          detail: { worktreePath, error: secondErr.slice(0, 200), source: 'runner_cleanup' },
        });
      }
    } catch (e) {
      log.error('[runner] failed to record stuck-worktree observation:', e instanceof Error ? e.message : e);
    }
  }

  /**
   * Run build/lint/test verification commands for a repo.
   * Returns individual results and whether all commands passed.
   */
  runVerification(repoId: string, cwd: string): { results: Record<string, { passed: boolean; output: string; durationMs: number }>; allPassed: boolean } {
    const repo = this.db.getRepo(repoId);
    if (!repo) return { results: {}, allPassed: true };

    const results: Record<string, { passed: boolean; output: string; durationMs: number }> = {};
    let allPassed = true;

    for (const [key, cmd] of [
      ['build', repo.buildCommand],
      ['lint', repo.lintCommand],
      ['test', repo.testCommand],
    ] as const) {
      if (!cmd) continue;
      const start = Date.now();
      // spawnSync captures stdout AND stderr regardless of exit status so we
      // preserve warnings/deprecations that arrive on stderr even when the
      // command succeeds — execSync dropped those silently (audit R-10).
      const result = spawnSync('sh', ['-c', cmd], { cwd, encoding: 'utf-8', timeout: 120_000 });
      const stdoutStr = (result.stdout ?? '').toString();
      const stderrStr = (result.stderr ?? '').toString();
      const combined = [
        stdoutStr,
        stderrStr ? `--- stderr ---\n${stderrStr}` : '',
      ].filter(Boolean).join('\n').slice(0, 2000);
      const passed = result.status === 0 && !result.error;
      const fallbackError = result.error ? result.error.message : '';
      results[key] = {
        passed,
        output: combined || fallbackError,
        durationMs: Date.now() - start,
      };
      if (!passed) allPassed = false;
    }

    return { results, allPassed };
  }

  /**
   * Rollback an execution run to its pre-execution state.
   * Requires the run to have a snapshotRef (captured before execution).
   */
  rollbackRun(runId: string): { ok: boolean; error?: string } {
    const run = this.db.getRun(runId);
    if (!run) return { ok: false, error: 'Run not found' };
    if (!run.snapshotRef) return { ok: false, error: 'No snapshot available for this run' };

    const repo = this.db.getRepo(run.repoId);
    if (!repo) return { ok: false, error: 'Repository not found' };

    const cwd = run.worktreePath ?? repo.path;

    try {
      execFileSync('git', ['reset', '--hard', run.snapshotRef], { cwd, timeout: 10_000, stdio: 'pipe' });

      this.db.createAuditEvent({
        interface: 'runner',
        action: 'rollback',
        targetKind: 'run',
        targetId: runId,
        detail: { snapshotRef: run.snapshotRef, resultRef: run.resultRef },
      });

      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Evaluate a generated plan's confidence level and identify doubts.
   * Uses Opus with effort high — this is a critical gate decision for autonomous execution.
   * Falls back to low confidence on any failure.
   */
  private async evaluateConfidence(
    planOutput: string,
    pack: ObjectivePack,
  ): Promise<ConfidenceEvaluation> {
    const FALLBACK: ConfidenceEvaluation = { confidence: 'low', doubts: ['evaluation failed — defaulting to manual review'] };

    if (!planOutput || !planOutput.trim()) {
      return { confidence: 'low', doubts: ['plan output is empty — cannot evaluate'] };
    }

    try {
      const adapter = selectAdapter(this.config);

      const evaluationPrompt = [
        'You are evaluating an implementation plan for autonomous execution.',
        'Your job is to decide if this plan can be safely auto-executed WITHOUT human review.',
        '',
        '## Plan to evaluate',
        '',
        planOutput,
        '',
        '## Goal',
        '',
        pack.goal,
        '',
        '## Evaluation criteria',
        '',
        'Rate confidence as HIGH only if ALL of these are true:',
        '- The plan references specific, concrete files and changes',
        '- The scope is well-bounded (not touching many unrelated areas)',
        '- No changes to authentication, authorization, or security logic',
        '- No data deletion or destructive database operations',
        '- No infrastructure or deployment changes',
        '- No multi-repo coordination needed',
        '- Verification steps are clear (tests, typecheck, etc.)',
        '',
        'Rate confidence as MEDIUM if most criteria are met but some uncertainty exists.',
        'Rate confidence as LOW if significant risks or unknowns are present.',
        '',
        'List specific doubts — concrete reasons why auto-execution might fail or cause issues.',
        '',
        'Respond with ONLY valid JSON, no markdown fences:',
        '{"confidence": "high" | "medium" | "low", "doubts": ["doubt1", "doubt2"]}',
      ].join('\n');

      const evalPack: ObjectivePack = {
        repos: pack.repos,
        title: 'Confidence evaluation',
        goal: 'Evaluate plan confidence',
        prompt: evaluationPrompt,
        relevantMemories: [],
        model: this.config.models.runner,
        effort: 'high',
        systemPrompt: 'Respond with ONLY valid JSON. No markdown, no explanation, no code fences.',
        timeoutMs: 90_000,
        disallowedTools: ['AskUserQuestion'],
      };

      const evalResult = await adapter.execute(evalPack);

      if (evalResult.status !== 'success') {
        log.error('[runner] Confidence evaluation failed:', evalResult.output.slice(0, 200));
        return FALLBACK;
      }

      // Record LLM usage for the evaluation call
      if (evalResult.inputTokens !== undefined || evalResult.outputTokens !== undefined) {
        this.db.recordLlmUsage({
          source: 'runner-eval',
          sourceId: pack.runId ?? null,
          model: this.config.models.runner,
          inputTokens: evalResult.inputTokens ?? 0,
          outputTokens: evalResult.outputTokens ?? 0,
        });
      }

      // Parse output — try to extract JSON from the response
      const raw = evalResult.output.trim();
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        log.error('[runner] Confidence evaluation returned non-JSON:', raw.slice(0, 200));
        return FALLBACK;
      }

      const parsed = ConfidenceEvaluationSchema.safeParse(JSON.parse(jsonMatch[0]));
      if (!parsed.success) {
        log.error('[runner] Confidence evaluation schema validation failed:', parsed.error.message);
        return FALLBACK;
      }

      return parsed.data;
    } catch (err) {
      log.error('[runner] Confidence evaluation error:', err instanceof Error ? err.message : err);
      return FALLBACK;
    }
  }
}
