import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ShadowDatabase } from '../../storage/database.js';
import type { DaemonSharedState } from '../../daemon/job-handlers.js';
import { json, clampLimit, clampOffset, parseOptionalBody, readBody, OptionalNoteSchema } from '../helpers.js';
import { loadConfig } from '../../config/load-config.js';

export async function handleRunRoutes(
  req: IncomingMessage, res: ServerResponse,
  pathname: string, params: URLSearchParams,
  db: ShadowDatabase,
  _daemonState?: DaemonSharedState,
): Promise<boolean> {

  if (req.method === 'GET') {
    if (pathname === '/api/runs') {
      const status = params.get('status') ?? undefined;
      const repoId = params.get('repoId') ?? undefined;
      const archived = params.get('archived') === 'true' ? true : undefined;
      const limit = clampLimit(params.get('limit'), 30);
      const offset = clampOffset(params.get('offset'));
      const items = db.listRuns({ status, repoId, archived, limit, offset });
      const total = db.countRuns({ status, archived });
      return json(res, { items, total }), true;
    }

    // Run context — full journey chain in one call
    const contextMatch = pathname.match(/^\/api\/runs\/([^/]+)\/context$/);
    if (contextMatch) {
      const run = db.getRun(contextMatch[1]);
      if (!run) return json(res, { error: 'Run not found' }, 404), true;

      // Resolve the "root" run (parent if this is a child)
      const parentRun = run.parentRunId ? db.getRun(run.parentRunId) : null;
      const rootRun = parentRun ?? run;

      // All children of the root run (including archived retries)
      const childRuns = db.listRuns({ parentRunId: rootRun.id, archived: undefined });

      // Source suggestion and observation
      const sourceSuggestion = rootRun.suggestionId ? db.getSuggestion(rootRun.suggestionId) : null;
      const sourceObservation = sourceSuggestion?.sourceObservationId ? db.getObservation(sourceSuggestion.sourceObservationId) : null;

      return json(res, {
        run: rootRun,
        childRuns,
        parentRun,
        sourceSuggestion,
        sourceObservation,
      }), true;
    }

    // PR status — live via gh CLI
    const prStatusMatch = pathname.match(/^\/api\/runs\/([^/]+)\/pr-status$/);
    if (prStatusMatch) {
      const run = db.getRun(prStatusMatch[1]);
      if (!run) return json(res, { error: 'Run not found' }, 404), true;
      if (!run.prUrl) return json(res, { error: 'Run has no PR' }, 400), true;

      try {
        const { execSync } = await import('node:child_process');
        const repo = db.getRepo(run.repoId);
        if (!repo) return json(res, { error: 'Repo not found' }, 404), true;
        const prJson = execSync(
          `gh pr view "${run.prUrl}" --json state,isDraft,reviewDecision,statusCheckRollup,url`,
          { cwd: repo.path, timeout: 15_000, stdio: 'pipe', encoding: 'utf-8' },
        ).trim();
        const pr = JSON.parse(prJson) as { state?: string; isDraft?: boolean; reviewDecision?: string; statusCheckRollup?: Array<{ conclusion?: string; state?: string }>; url?: string };
        // Aggregate checks status
        const checks = pr.statusCheckRollup ?? [];
        let checksStatus: string | null = null;
        if (checks.length > 0) {
          if (checks.some(c => c.conclusion === 'FAILURE' || c.state === 'FAILURE')) checksStatus = 'FAILURE';
          else if (checks.every(c => c.conclusion === 'SUCCESS' || c.state === 'SUCCESS')) checksStatus = 'SUCCESS';
          else checksStatus = 'PENDING';
        }
        return json(res, {
          state: pr.state ?? 'OPEN',
          isDraft: pr.isDraft ?? false,
          reviewDecision: pr.reviewDecision ?? null,
          checksStatus,
          url: pr.url ?? run.prUrl,
        }), true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return json(res, { error: `Failed to fetch PR status: ${msg}` }, 500), true;
      }
    }
  }

  if (req.method === 'POST') {
    const runArchiveMatch = pathname.match(/^\/api\/runs\/([^/]+)\/archive$/);
    if (runArchiveMatch) {
      const [, runId] = runArchiveMatch;
      const run = db.getRun(runId);
      if (!run) return json(res, { error: 'Run not found' }, 404), true;
      db.updateRun(runId, { archived: true });
      return json(res, { ok: true }), true;
    }

    const runVerifyMatch = pathname.match(/^\/api\/runs\/([^/]+)\/verify$/);
    if (runVerifyMatch) {
      const [, runId] = runVerifyMatch;
      const run = db.getRun(runId);
      if (!run) return json(res, { error: 'Run not found' }, 404), true;
      if (run.kind !== 'execution') return json(res, { error: 'Only execution runs can be verified' }, 400), true;

      const repo = db.getRepo(run.repoId);
      if (!repo) return json(res, { error: 'Repository not found' }, 404), true;

      const { RunnerService } = await import('../../runner/service.js');
      const { loadConfig } = await import('../../config/load-config.js');
      const config = loadConfig();
      const runner = new RunnerService(config, db);
      const cwd = run.worktreePath ?? repo.path;
      const verifyResult = runner.runVerification(run.repoId, cwd);
      const hasCommands = Object.keys(verifyResult.results).length > 0;
      const verified = hasCommands ? (verifyResult.allPassed ? 'verified' : 'needs_review') : 'unverified';
      db.updateRun(runId, { verification: verifyResult.results, verified });
      return json(res, { ok: true, verified, verification: verifyResult.results }), true;
    }

    const runRollbackMatch = pathname.match(/^\/api\/runs\/([^/]+)\/rollback$/);
    if (runRollbackMatch) {
      const [, runId] = runRollbackMatch;
      const run = db.getRun(runId);
      if (!run) return json(res, { error: 'Run not found' }, 404), true;
      if (!run.snapshotRef) return json(res, { error: 'No snapshot available for this run' }, 400), true;

      const { RunnerService } = await import('../../runner/service.js');
      const { loadConfig } = await import('../../config/load-config.js');
      const config = loadConfig();
      const runner = new RunnerService(config, db);
      const result = runner.rollbackRun(runId);
      if (!result.ok) return json(res, { error: result.error }, 500), true;
      return json(res, { ok: true }), true;
    }

    const runRetryMatch = pathname.match(/^\/api\/runs\/([^/]+)\/retry$/);
    if (runRetryMatch) {
      const [, runId] = runRetryMatch;
      const run = db.getRun(runId);
      if (!run) return json(res, { error: 'Run not found' }, 404), true;
      if (run.status !== 'failed') return json(res, { error: 'Only failed runs can be retried' }, 400), true;
      const newRun = db.createRun({
        repoId: run.repoId,
        repoIds: run.repoIds,
        suggestionId: run.suggestionId,
        parentRunId: run.parentRunId ?? undefined,
        kind: run.kind,
        prompt: run.prompt,
      });
      db.updateRun(runId, { archived: true });
      return json(res, { ok: true, newRunId: newRun.id }), true;
    }

    const runMatch = pathname.match(/^\/api\/runs\/([^/]+)\/(execute|session|discard|executed-manual)$/);
    if (runMatch) {
      const [, runId, action] = runMatch;
      const run = db.getRun(runId);
      if (!run) return json(res, { error: 'Run not found' }, 404), true;

      if (action === 'discard') {
        try { db.transitionRun(runId, 'discarded'); } catch { return json(res, { error: 'Run must be completed to discard' }, 400), true; }
        const discardBody = await parseOptionalBody(req, res, OptionalNoteSchema);
        if (!discardBody) return true;
        db.createFeedback({ targetKind: 'run', targetId: runId, action: 'discard', note: discardBody.note });

        // Auto-rollback + cleanup worktree on discard
        if (run.snapshotRef) {
          try {
            const { RunnerService } = await import('../../runner/service.js');
            const { loadConfig } = await import('../../config/load-config.js');
            const config = loadConfig();
            const runner = new RunnerService(config, db);
            runner.rollbackRun(runId);
          } catch { /* best-effort rollback */ }
        }
        if (run.worktreePath) {
          try {
            const repo = db.getRepo(run.repoId);
            if (repo) {
              const { execSync } = await import('node:child_process');
              execSync(`git worktree remove "${run.worktreePath}" --force`, { cwd: repo.path, timeout: 10_000, stdio: 'pipe' });
              const branchName = `shadow/${runId.slice(0, 8)}`;
              execSync(`git branch -D "${branchName}"`, { cwd: repo.path, timeout: 5_000, stdio: 'pipe' });
            }
          } catch { /* best-effort cleanup */ }
        }

        return json(res, { ok: true, status: 'discarded' }), true;
      }

      if (action === 'executed-manual') {
        try { db.transitionRun(runId, 'executed_manual'); } catch { return json(res, { error: 'Run must be completed' }, 400), true; }
        return json(res, { ok: true, status: 'executed_manual' }), true;
      }

      if (action === 'execute') {
        try { db.transitionRun(runId, 'executed'); } catch { return json(res, { error: 'Run must be completed to execute' }, 400), true; }
        const childRun = db.createRun({
          repoId: run.repoId,
          repoIds: run.repoIds,
          suggestionId: run.suggestionId,
          parentRunId: run.id,
          kind: 'execution',
          prompt: `Implement the following plan. Write the actual code changes.\n\n${run.resultSummaryMd}`,
        });
        return json(res, { runId: childRun.id, status: 'queued' }), true;
      }

      if (action === 'session') {
        // If the run already has a sessionId, return it
        if (run.sessionId) {
          const repo = db.getRepo(run.repoId);
          const repoPath = repo?.path ?? process.cwd();
          return json(res, { sessionId: run.sessionId, command: `cd ${repoPath} && claude --resume ${run.sessionId}` }), true;
        }
        // Create a session seeded with the plan + context. No --system-prompt so Claude has MCP access.
        const config = loadConfig();
        const { spawn: spawnChild } = await import('node:child_process');
        const { randomUUID } = await import('node:crypto');
        const sessionId: string = randomUUID();
        const suggestion = run.suggestionId ? db.getSuggestion(run.suggestionId) : null;
        const repo = db.getRepo(run.repoId);
        const cwd = repo?.path ?? process.cwd();
        const prompt = [
          `You are Shadow, helping implement a plan. You have MCP tools and filesystem access.`,
          '',
          `## Suggestion: ${suggestion?.title ?? run.kind}`,
          suggestion?.summaryMd ?? run.prompt,
          suggestion?.reasoningMd ? `\n## Reasoning\n${suggestion.reasoningMd}` : '',
          run.resultSummaryMd ? `\n## Plan\n${run.resultSummaryMd}` : '',
          '',
          `## Repository\n- ${repo?.name ?? 'unknown'} (${cwd})`,
          repo?.testCommand ? `- Test: \`${repo.testCommand}\`` : '',
          repo?.buildCommand ? `- Build: \`${repo.buildCommand}\`` : '',
          '',
          'Use shadow_memory_search for relevant context. Read files as needed.',
          'Ready to help implement this. What would you like to start with?',
        ].filter(Boolean).join('\n');
        const env: Record<string, string> = { ...process.env as Record<string, string> };
        const claudeBin = config.claudeBin ?? 'claude';
        if (config.claudeExtraPath) env.PATH = `${config.claudeExtraPath}:${env.PATH ?? ''}`;

        const result = await new Promise<{ stdout: string; error?: boolean; message?: string }>((resolve) => {
          const child = spawnChild(claudeBin, [
            '--print', '--output-format', 'json',
            '--session-id', sessionId,
            prompt,
          ], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
          const chunks: Buffer[] = [];
          child.stdout.on('data', (d: Buffer) => chunks.push(d));
          const timer = setTimeout(() => {
            child.kill('SIGTERM');
            setTimeout(() => child.kill('SIGKILL'), 5_000); // SIGKILL fallback
          }, 120_000);
          child.on('close', () => { clearTimeout(timer); resolve({ stdout: Buffer.concat(chunks).toString('utf8'), error: false }); });
          child.on('error', (err) => { clearTimeout(timer); resolve({ stdout: '', error: true, message: err.message }); });
        });

        if (result.error) {
          return json(res, { error: 'Failed to create session', detail: result.message }, 500), true;
        }
        let finalSessionId = sessionId;
        try {
          const out = JSON.parse(result.stdout || '{}') as { session_id?: string };
          if (out.session_id) finalSessionId = out.session_id;
        } catch { /* use generated */ }
        db.updateRun(runId, { sessionId: finalSessionId });
        return json(res, { sessionId: finalSessionId, command: `cd ${cwd} && claude --resume ${finalSessionId}` }), true;
      }
    }

    // Close journey — done, no more action needed
    const closeMatch = pathname.match(/^\/api\/runs\/([^/]+)\/close$/);
    if (closeMatch) {
      const runId = closeMatch[1];
      const run = db.getRun(runId);
      if (!run) return json(res, { error: 'Run not found' }, 404), true;
      try { db.transitionRun(runId, 'closed'); } catch { return json(res, { error: 'Cannot close run in current status' }, 400), true; }
      const body = await parseOptionalBody(req, res, OptionalNoteSchema);
      if (!body) return true;
      if (body.note) db.updateRun(runId, { closedNote: body.note });
      db.createFeedback({ targetKind: 'run', targetId: runId, action: 'close', note: body.note });
      // Also close pending child runs
      const children = db.listRuns({ parentRunId: runId, archived: undefined });
      for (const child of children) {
        if (!['discarded', 'failed', 'closed'].includes(child.status)) {
          try { db.transitionRun(child.id, 'closed'); } catch { /* skip non-closeable children */ }
        }
      }
      return json(res, { ok: true, status: 'closed' }), true;
    }

    // Cleanup worktree — remove orphaned worktree + branch
    const cleanupMatch = pathname.match(/^\/api\/runs\/([^/]+)\/cleanup-worktree$/);
    if (cleanupMatch) {
      const runId = cleanupMatch[1];
      const run = db.getRun(runId);
      if (!run) return json(res, { error: 'Run not found' }, 404), true;
      if (!run.worktreePath) return json(res, { error: 'No worktree to clean up' }, 400), true;
      const repo = db.getRepo(run.repoId);
      if (!repo) return json(res, { error: 'Repo not found' }, 404), true;
      try {
        const { execSync } = await import('node:child_process');
        try { execSync(`git worktree remove "${run.worktreePath}" --force`, { cwd: repo.path, timeout: 10_000, stdio: 'pipe' }); } catch { /* may not exist */ }
        const branchName = `shadow/${runId.slice(0, 8)}`;
        try { execSync(`git branch -D "${branchName}"`, { cwd: repo.path, timeout: 5_000, stdio: 'pipe' }); } catch { /* may not exist */ }
        db.updateRun(runId, { worktreePath: null as unknown as string });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return json(res, { error: `Cleanup failed: ${msg}` }, 500), true;
      }
      return json(res, { ok: true }), true;
    }

    // Draft PR endpoint
    const draftPrMatch = pathname.match(/^\/api\/runs\/([^/]+)\/draft-pr$/);
    if (draftPrMatch) {
      const runId = draftPrMatch[1];
      const run = db.getRun(runId);
      if (!run) return json(res, { error: 'Run not found' }, 404), true;
      if (!run.worktreePath) return json(res, { error: 'Run has no worktree/branch' }, 400), true;
      if (run.prUrl) return json(res, { ok: true, prUrl: run.prUrl }), true;

      const repo = db.getRepo(run.repoId);
      if (!repo?.remoteUrl || !repo.remoteUrl.includes('github')) {
        return json(res, { error: 'Repo has no GitHub remote' }, 400), true;
      }

      const branchName = `shadow/${run.id.slice(0, 8)}`;

      // Verify branch exists locally before attempting push
      const { execSync: execCheck } = await import('node:child_process');
      try {
        execCheck(`git rev-parse --verify ${branchName}`, { cwd: repo.path, stdio: 'pipe', timeout: 5_000 });
      } catch {
        return json(res, { error: `Branch ${branchName} no longer exists — worktree may have been cleaned up` }, 400), true;
      }

      const suggestion = run.suggestionId ? db.getSuggestion(run.suggestionId) : null;
      const title = suggestion?.title ?? run.prompt.slice(0, 70);
      const body = [
        '## Summary',
        '',
        suggestion?.summaryMd ?? run.prompt,
        '',
        '---',
        `Generated by Shadow (trust L${db.ensureProfile().trustLevel})`,
      ].join('\n');

      const { execSync: exec } = await import('node:child_process');
      try {
        // Push branch to remote
        exec(`git push -u origin ${branchName}`, { cwd: repo.path, stdio: 'pipe', timeout: 30_000 });

        // Create draft PR via gh CLI
        const prOutput = exec(
          `gh pr create --draft --title ${JSON.stringify(title)} --body ${JSON.stringify(body)} --head ${branchName} --base ${repo.defaultBranch}`,
          { cwd: repo.path, stdio: 'pipe', timeout: 30_000, encoding: 'utf-8' },
        ).toString().trim();

        // gh pr create returns the PR URL
        const prUrl = prOutput.split('\n').pop()?.trim() ?? prOutput;
        db.updateRun(runId, { prUrl });

        db.createAuditEvent({
          interface: 'web',
          action: 'create-draft-pr',
          targetKind: 'run',
          targetId: runId,
          detail: { prUrl, branchName },
        });

        return json(res, { ok: true, prUrl }), true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return json(res, { error: `Failed to create draft PR: ${msg}` }, 500), true;
      }
    }
  }

  return false;
}
