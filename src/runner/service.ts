import { mkdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';

import type { ShadowConfig } from '../config/load-config.js';
import type { ShadowDatabase } from '../storage/database.js';
import type { RunRecord } from '../storage/models.js';
import type { ObjectivePack, RepoPack } from '../backend/types.js';
import { selectAdapter } from '../backend/index.js';
import { findRelevantMemories } from '../memory/retrieval.js';

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
   * Process the next queued run.
   *
   * 1. Find next queued run
   * 2. Claim it (status -> 'running')
   * 3. Build ObjectivePack with multi-repo support
   * 4. Load relevant memories via findRelevantMemories
   * 5. Execute via selectAdapter(config)
   * 6. Post-process: update run status, record llm_usage, capture git diff, write artifacts
   * 7. Apply trust delta (success: +1.5, failure: -2.0)
   */
  async processNextRun(): Promise<{ processed: boolean; run: RunRecord | null }> {
    // 1. Find next queued run
    const queuedRuns = this.db.listRuns({ status: 'queued' });
    if (queuedRuns.length === 0) {
      return { processed: false, run: null };
    }

    const run = queuedRuns[queuedRuns.length - 1]; // oldest first (list is DESC, so last = oldest)
    const now = new Date().toISOString();

    // 2. Claim it
    this.db.updateRun(run.id, {
      status: 'running',
      startedAt: now,
    });

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

      // 4. Load relevant memories
      const suggestion = run.suggestionId
        ? this.db.getSuggestion(run.suggestionId)
        : null;

      const topics: string[] = [];
      if (suggestion) {
        topics.push(suggestion.title);
        if (suggestion.kind) topics.push(suggestion.kind);
      }
      topics.push(run.kind);

      const relevantMemories = findRelevantMemories(
        this.db,
        {
          topics,
          repoId: run.repoId,
        },
        10,
      );

      // Build the full prompt with personality and context
      const personalityLevel = this.config.personalityLevel;
      const personalityPrompt = getPersonalityPrompt(personalityLevel);

      const memoryContext = relevantMemories.length > 0
        ? `\n\n## Relevant context from memory\n${relevantMemories.map((m) => `- **${m.title}**: ${m.bodyMd.slice(0, 200)}`).join('\n')}`
        : '';

      const repoContext = repos.length > 1
        ? `\n\n## Repositories involved\n${repos.map((r) => `- ${r.name} (${r.path})`).join('\n')}`
        : `\n\n## Repository\n- ${repos[0].name} (${repos[0].path})`;

      // Trust-gated behavior: at trust <= 2, generate a plan; at higher trust, execute
      const currentProfile = this.db.ensureProfile();
      // Plan-only mode: generate implementation plan, not code
      // Execution runs (child of a plan) skip this restriction
      const planOnly = run.kind !== 'execution' && currentProfile.trustLevel <= 2;
      const taskSection = planOnly
        ? [
            '\n\n## Task',
            run.prompt,
            '',
            'IMPORTANT: Generate a detailed IMPLEMENTATION PLAN only. Do NOT write code directly.',
            'Structure your response as:',
            '## Files to modify',
            'List each file path and what needs to change.',
            '## Changes per file',
            'For each file, describe the specific changes and why.',
            '## Risks and edge cases',
            'What could go wrong.',
            '## Verification steps',
            'How to test the changes.',
            '',
            'Format as clean Markdown.',
          ].join('\n')
        : `\n\n## Task\n${run.prompt}`;

      const fullPrompt = [
        personalityPrompt,
        repoContext,
        memoryContext,
        taskSection,
      ].join('');

      // Prepare artifact directory
      const artifactDir = join(
        this.config.resolvedArtifactsDir ?? join(homedir(), '.shadow', 'artifacts'),
        'runs',
        run.id,
      );
      mkdirSync(artifactDir, { recursive: true });

      const pack: ObjectivePack = {
        runId: run.id,
        repos,
        suggestionId: run.suggestionId,
        title: suggestion?.title ?? `Run: ${run.kind}`,
        goal: run.prompt,
        prompt: fullPrompt,
        relevantMemories,
        artifactDir,
        model: this.config.models.runner,
        timeoutMs: this.config.runnerTimeoutMs,
      };

      // 5. Execute via backend adapter
      const adapter = selectAdapter(this.config);
      const result = await adapter.execute(pack);

      // 6. Post-process
      const finishedAt = new Date().toISOString();
      const isSuccess = result.status === 'success';

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

      // Update run status
      this.db.updateRun(run.id, {
        status: isSuccess ? 'completed' : 'failed',
        resultSummaryMd: result.summaryHint ?? result.output.slice(0, 500),
        errorSummary: isSuccess ? null : (result.output.slice(0, 500) || 'Execution failed'),
        artifactDir,
        sessionId: result.sessionId ?? null,
        finishedAt,
      });

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

      this.db.updateRun(run.id, {
        status: 'failed',
        errorSummary: errorMessage.slice(0, 500),
        finishedAt,
      });

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
}
