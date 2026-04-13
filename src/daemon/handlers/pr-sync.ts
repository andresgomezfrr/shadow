import { execFileSync } from 'node:child_process';
import type { JobContext, JobHandlerResult, DaemonSharedState } from '../job-handlers.js';

type PrViewJson = {
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  mergedAt?: string | null;
};

type ProcessedEntry = { runId: string; action: 'merged' | 'closed' | 'error'; prUrl?: string; error?: string };

export async function handlePrSync(ctx: JobContext, _shared: DaemonSharedState): Promise<JobHandlerResult> {
  ctx.setPhase('pr-sync');

  const awaitingRuns = ctx.db.listRuns({ status: 'awaiting_pr' });
  let merged = 0;
  let closed = 0;
  let stillOpen = 0;
  let errors = 0;
  const processed: ProcessedEntry[] = [];

  for (const parent of awaitingRuns) {
    const children = ctx.db.listRuns({ parentRunId: parent.id });
    const child = children.find(c => c.prUrl && c.status === 'done');
    if (!child?.prUrl) continue;

    const repo = ctx.db.getRepo(child.repoId);
    if (!repo) {
      errors++;
      processed.push({ runId: parent.id, action: 'error', error: 'repo not found' });
      continue;
    }

    try {
      const prJson = execFileSync(
        'gh', ['pr', 'view', child.prUrl, '--json', 'state,mergedAt'],
        { cwd: repo.path, timeout: 15_000, stdio: 'pipe', encoding: 'utf-8' },
      ).trim();
      const pr = JSON.parse(prJson) as PrViewJson;

      if (pr.state === 'MERGED') {
        ctx.db.transitionRun(parent.id, 'done');
        ctx.db.updateRun(parent.id, { outcome: 'merged' });
        ctx.db.createEvent({
          kind: 'pr_merged',
          priority: 5,
          payload: { message: `PR merged: ${child.prUrl}`, runId: parent.id, prUrl: child.prUrl },
        });
        merged++;
        processed.push({ runId: parent.id, action: 'merged', prUrl: child.prUrl });
      } else if (pr.state === 'CLOSED') {
        ctx.db.transitionRun(parent.id, 'dismissed');
        ctx.db.updateRun(parent.id, { closedNote: 'PR closed without merge' });
        closed++;
        processed.push({ runId: parent.id, action: 'closed', prUrl: child.prUrl });
      } else {
        stillOpen++;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[pr-sync] Failed to check PR for run ${parent.id.slice(0, 8)}:`, msg);
      errors++;
      processed.push({ runId: parent.id, action: 'error', error: msg.slice(0, 200) });
    }
  }

  console.error(`[pr-sync] Checked ${awaitingRuns.length} runs: ${merged} merged, ${closed} closed, ${stillOpen} still open, ${errors} errors`);
  return {
    llmCalls: 0,
    tokensUsed: 0,
    phases: ['pr-sync'],
    result: {
      runsChecked: awaitingRuns.length,
      merged,
      closed,
      stillOpen,
      errors,
      processed,
    },
  };
}
