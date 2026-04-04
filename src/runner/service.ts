import { mkdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';

import type { ShadowConfig } from '../config/load-config.js';
import type { ShadowDatabase } from '../storage/database.js';
import type { RunRecord } from '../storage/models.js';
import type { ObjectivePack, RepoPack } from '../backend/types.js';
import { selectAdapter } from '../backend/index.js';
import { ConfidenceEvaluationSchema, type ConfidenceEvaluation } from './schemas.js';
import { aggregateParentStatus } from './state-machine.js';

/**
 * Personality prompt prefixes by level (1-5).
 */
const PERSONALITY_PROMPTS: Record<number, string> = {
  1: 'You are a minimal, no-frills coding assistant. Be direct and terse.',
  2: 'You are a professional coding assistant. Be clear and concise.',
  3: 'You are a helpful coding assistant. Be friendly but focused.',
  4: 'You are Shadow, a proactive coding companion. Show initiative and personality.',
  5: 'You are Shadow, an enthusiastic and opinionated coding partner. Share insights freely and express yourself.',
};

function getPersonalityPrompt(level: number): string {
  const clamped = Math.max(1, Math.min(5, level));
  return PERSONALITY_PROMPTS[clamped] ?? PERSONALITY_PROMPTS[3];
}

/**
 * RunnerService processes queued runs by sending them through the configured
 * backend adapter (Claude CLI or Agent SDK).
 */
export class RunnerService {
  constructor(
    private readonly config: ShadowConfig,
    private readonly db: ShadowDatabase,
  ) {}

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

    try {
      // 3. Build ObjectivePack with multi-repo support
      const repoIds = run.repoIds.length > 0 ? run.repoIds : [run.repoId];
      const repos: RepoPack[] = [];

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
      let worktreePath: string | null = null;
      if (run.kind === 'execution' && repos[0].path !== '.') {
        const branchName = `shadow/${run.id.slice(0, 8)}`;
        worktreePath = join(repos[0].path, '.shadow-worktrees', run.id.slice(0, 8));
        try {
          mkdirSync(join(repos[0].path, '.shadow-worktrees'), { recursive: true });
          execSync(`git worktree add "${worktreePath}" -b "${branchName}"`, {
            cwd: repos[0].path,
            stdio: 'pipe',
            timeout: 10_000,
          });
          // Override repo path with worktree path for execution
          repos[0] = { ...repos[0], path: worktreePath };
          this.db.updateRun(run.id, { worktreePath });
        } catch (wtErr) {
          console.error('[runner] Failed to create worktree, running in main repo:', wtErr instanceof Error ? wtErr.message : wtErr);
          worktreePath = null;
        }
      }

      // 4. Build briefing — Shadow provides context, Claude does the work
      const suggestion = run.suggestionId
        ? this.db.getSuggestion(run.suggestionId)
        : null;

      const repo = this.db.getRepo(run.repoId);
      const personalityPrompt = getPersonalityPrompt(this.config.personalityLevel);

      const currentProfile = this.db.ensureProfile();
      // Plan-first for L1-4 — auto-execute gated by confidence evaluation (L3+)
      // L4 proactive features not yet implemented, so cap behavior at L3
      const planOnly = run.kind !== 'execution' && currentProfile.trustLevel <= 4;

      const briefing = [
        personalityPrompt,
        '',
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
        'You have access to the filesystem and Shadow MCP tools (shadow_memory_search, shadow_observations, etc.).',
        'Use them to gather any additional context you need.',
        'Use shadow_soul to read your understanding of the developer before planning.',
        '',
        planOnly
          ? [
              'Generate a detailed IMPLEMENTATION PLAN. Do NOT write code directly.',
              'Read the relevant source files, search Shadow memories for context, then structure your plan as:',
              '## Files to modify',
              '## Changes per file',
              '## Risks and edge cases',
              '## Verification steps',
            ].join('\n')
          : 'Implement this change. Read the relevant files, make the changes, and verify.',
      ].filter(Boolean).join('\n');

      const fullPrompt = briefing;

      // Prepare artifact directory
      const artifactDir = join(
        this.config.resolvedArtifactsDir ?? join(homedir(), '.shadow', 'artifacts'),
        'runs',
        run.id,
      );
      mkdirSync(artifactDir, { recursive: true });

      // Execution runs need filesystem write access; plan-only runs only need read + MCP
      const allowedTools = planOnly ? undefined : ['Edit', 'Write', 'Bash'];

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
        allowedTools,
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
      const adapter = selectAdapter(this.config);
      const result = await adapter.execute(pack);

      // 5b. L3 confidence gate — evaluate plan before deciding to auto-execute
      const isSuccess = result.status === 'success';
      if (currentProfile.trustLevel >= 3 && planOnly && isSuccess && !run.parentRunId) {
        const evaluation = await this.evaluateConfidence(result.output, pack);
        this.db.updateRun(run.id, {
          confidence: evaluation.confidence,
          doubts: evaluation.doubts,
        });

        if (evaluation.confidence === 'high' && evaluation.doubts.length === 0) {
          // Auto-execute: create child execution run (picked up by next daemon tick)
          const childRun = this.db.createRun({
            repoId: run.repoId,
            repoIds: run.repoIds.length > 0 ? run.repoIds : undefined,
            suggestionId: run.suggestionId,
            parentRunId: run.id,
            kind: 'execution',
            prompt: result.summaryHint ?? result.output,
          });

          this.db.createAuditEvent({
            interface: 'runner',
            action: 'l3-auto-execute',
            targetKind: 'run',
            targetId: run.id,
            detail: {
              confidence: evaluation.confidence,
              childRunId: childRun.id,
            },
          });

          console.error(`[runner] L3 auto-execute: confidence=${evaluation.confidence}, child run ${childRun.id}`);
        } else {
          console.error(`[runner] L3 gate: confidence=${evaluation.confidence}, doubts=${evaluation.doubts.length} — waiting for user`);
        }
      }

      // 6. Post-process
      const finishedAt = new Date().toISOString();

      // Write summary artifact
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
        result.output,
        '',
        result.summaryHint ? `## Summary\n\n${result.summaryHint}` : '',
      ].join('\n');

      writeFileSync(join(artifactDir, 'summary.md'), summaryContent, 'utf-8');

      // Update run status — child execution runs go straight to 'executed' (no review needed)
      const finalStatus = isSuccess ? (run.parentRunId ? 'executed' : 'completed') : 'failed';
      this.db.transitionRun(run.id, finalStatus);
      this.db.updateRun(run.id, {
        resultSummaryMd: result.summaryHint ?? result.output,
        errorSummary: isSuccess ? null : (result.output.slice(0, 500) || 'Execution failed'),
        artifactDir,
        sessionId: result.sessionId ?? null,
        finishedAt,
      });

      // 6b. Checkpoint: capture post-execution state + diff stat
      if (run.kind === 'execution' && snapshotRef) {
        try {
          const resultRef = execSync('git rev-parse HEAD', { cwd: executionCwd, encoding: 'utf-8', timeout: 5_000 }).trim();
          let diffStat: string | null = null;
          if (resultRef !== snapshotRef) {
            diffStat = execSync(`git diff --stat ${snapshotRef}..${resultRef}`, { cwd: executionCwd, encoding: 'utf-8', timeout: 10_000 }).trim();
          }
          this.db.updateRun(run.id, { resultRef, diffStat });
        } catch { /* non-fatal */ }
      }

      // 6c. Post-execution verification (build/lint/test)
      if (run.kind === 'execution' && isSuccess) {
        try {
          const { results: verificationResults, allPassed } = this.runVerification(run.repoId, executionCwd);
          const hasCommands = Object.keys(verificationResults).length > 0;
          const verified = hasCommands ? (allPassed ? 'verified' : 'needs_review') : 'unverified';
          this.db.updateRun(run.id, { verification: verificationResults, verified } as Parameters<typeof this.db.updateRun>[1]);
        } catch { /* non-fatal — verification failure shouldn't block the run */ }
      }

      // Propagate to parent via multi-child aggregation
      if (run.parentRunId) {
        const siblings = this.db.listRuns({ parentRunId: run.parentRunId });
        const parentStatus = aggregateParentStatus(siblings);
        if (parentStatus !== null) {
          this.db.transitionRun(run.parentRunId, parentStatus);
          this.db.updateRun(run.parentRunId, { finishedAt });
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

      // 7. Apply trust delta
      const trustDelta = isSuccess ? 1.5 : -2.0;
      const profile = this.db.ensureProfile();
      const newTrustScore = Math.max(0, Math.min(100, profile.trustScore + trustDelta));
      this.db.updateProfile(profile.id, { trustScore: newTrustScore });

      this.db.createInteraction({
        interface: 'runner',
        kind: 'run-complete',
        outputSummary: `Run ${run.id} ${result.status}. Trust delta: ${trustDelta >= 0 ? '+' : ''}${trustDelta}`,
        trustDelta,
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

      const updatedRun = this.db.getRun(run.id)!;
      return { processed: true, run: updatedRun };
    } catch (error) {
      // Handle unexpected errors
      const finishedAt = new Date().toISOString();
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.db.transitionRun(run.id, 'failed');
      this.db.updateRun(run.id, {
        errorSummary: errorMessage.slice(0, 500),
        finishedAt,
      });

      // Propagate failure to parent via multi-child aggregation
      if (run.parentRunId) {
        const siblings = this.db.listRuns({ parentRunId: run.parentRunId });
        const parentStatus = aggregateParentStatus(siblings);
        if (parentStatus !== null) {
          this.db.transitionRun(run.parentRunId, parentStatus);
          this.db.updateRun(run.parentRunId, { finishedAt });
        }
      }

      // Apply failure trust delta
      const profile = this.db.ensureProfile();
      const newTrustScore = Math.max(0, Math.min(100, profile.trustScore - 2.0));
      this.db.updateProfile(profile.id, { trustScore: newTrustScore });

      this.db.createAuditEvent({
        interface: 'runner',
        action: 'run-error',
        targetKind: 'run',
        targetId: run.id,
        detail: { error: errorMessage },
      });

      const updatedRun = this.db.getRun(run.id)!;
      return { processed: true, run: updatedRun };
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
      try {
        execSync(cmd, { cwd, encoding: 'utf-8', timeout: 120_000, stdio: 'pipe' });
        results[key] = { passed: true, output: '', durationMs: Date.now() - start };
      } catch (err: unknown) {
        const output = (err instanceof Error ? (err as { stderr?: string }).stderr ?? err.message : String(err)).slice(0, 2000);
        results[key] = { passed: false, output, durationMs: Date.now() - start };
        allPassed = false;
      }
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
      execSync(`git reset --hard ${run.snapshotRef}`, { cwd, timeout: 10_000, stdio: 'pipe' });

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
   * Uses Sonnet with effort high — this is a critical gate decision.
   * Falls back to low confidence on any failure.
   */
  private async evaluateConfidence(
    planOutput: string,
    pack: ObjectivePack,
  ): Promise<ConfidenceEvaluation> {
    const FALLBACK: ConfidenceEvaluation = { confidence: 'low', doubts: ['evaluation failed — defaulting to manual review'] };

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
        model: 'sonnet',
        effort: 'high',
        systemPrompt: 'Respond with ONLY valid JSON. No markdown, no explanation, no code fences.',
        timeoutMs: 60_000,
      };

      const evalResult = await adapter.execute(evalPack);

      if (evalResult.status !== 'success') {
        console.error('[runner] Confidence evaluation failed:', evalResult.output.slice(0, 200));
        return FALLBACK;
      }

      // Record LLM usage for the evaluation call
      if (evalResult.inputTokens !== undefined || evalResult.outputTokens !== undefined) {
        this.db.recordLlmUsage({
          source: 'runner-eval',
          sourceId: pack.runId ?? null,
          model: 'sonnet',
          inputTokens: evalResult.inputTokens ?? 0,
          outputTokens: evalResult.outputTokens ?? 0,
        });
      }

      // Parse output — try to extract JSON from the response
      const raw = evalResult.output.trim();
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error('[runner] Confidence evaluation returned non-JSON:', raw.slice(0, 200));
        return FALLBACK;
      }

      const parsed = ConfidenceEvaluationSchema.safeParse(JSON.parse(jsonMatch[0]));
      if (!parsed.success) {
        console.error('[runner] Confidence evaluation schema validation failed:', parsed.error.message);
        return FALLBACK;
      }

      return parsed.data;
    } catch (err) {
      console.error('[runner] Confidence evaluation error:', err instanceof Error ? err.message : err);
      return FALLBACK;
    }
  }
}
