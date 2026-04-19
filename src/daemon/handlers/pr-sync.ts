import { execFile as _execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { JobContext, JobHandlerResult, DaemonSharedState } from '../job-handlers.js';
import type { RunRecord } from '../../storage/models.js';

const execFile = promisify(_execFile);

type PrViewJson = {
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  mergedAt?: string | null;
};

type ProcessedEntry = { runId: string; action: 'merged' | 'closed' | 'error' | 'open'; prUrl?: string; error?: string };

type FetchResult =
  | { kind: 'ok'; pr: PrViewJson; runId: string; child: RunRecord; parent: RunRecord }
  | { kind: 'skip'; runId: string; reason: string }
  | { kind: 'error'; runId: string; error: string };

const BATCH_SIZE = 8;
const GH_TIMEOUT_MS = 15_000;

export async function handlePrSync(ctx: JobContext, shared: DaemonSharedState): Promise<JobHandlerResult> {
  ctx.setPhase('pr-sync');

  if (!shared.networkAvailable) {
    console.error('[pr-sync] Skipping — network unavailable');
    return {
      llmCalls: 0, tokensUsed: 0, phases: ['pr-sync'],
      result: { runsChecked: 0, merged: 0, closed: 0, stillOpen: 0, errors: 0, skipped: 'network_unavailable', processed: [] },
    };
  }

  const awaitingRuns = ctx.db.listRuns({ status: 'awaiting_pr' });
  let merged = 0;
  let closed = 0;
  let stillOpen = 0;
  let errors = 0;
  const processed: ProcessedEntry[] = [];

  for (let i = 0; i < awaitingRuns.length; i += BATCH_SIZE) {
    const chunk = awaitingRuns.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(chunk.map((parent) => fetchPr(ctx, parent)));

    for (const result of results) {
      if (result.kind === 'skip') continue;
      if (result.kind === 'error') {
        console.error(`[pr-sync] Failed to check PR for run ${result.runId.slice(0, 8)}: ${result.error}`);
        errors++;
        processed.push({ runId: result.runId, action: 'error', error: result.error.slice(0, 200) });
        continue;
      }

      const { pr, parent, child } = result;
      if (pr.state === 'MERGED') {
        ctx.db.transitionRun(parent.id, 'done');
        ctx.db.updateRun(parent.id, { outcome: 'merged' });
        ctx.db.createEvent({
          kind: 'pr_merged',
          priority: 5,
          payload: { message: `PR merged: ${child.prUrl}`, runId: parent.id, prUrl: child.prUrl },
        });
        merged++;
        processed.push({ runId: parent.id, action: 'merged', prUrl: child.prUrl ?? undefined });
      } else if (pr.state === 'CLOSED') {
        ctx.db.transitionRun(parent.id, 'dismissed');
        ctx.db.updateRun(parent.id, { closedNote: 'PR closed without merge' });
        closed++;
        processed.push({ runId: parent.id, action: 'closed', prUrl: child.prUrl ?? undefined });
      } else {
        stillOpen++;
        processed.push({ runId: parent.id, action: 'open', prUrl: child.prUrl ?? undefined });
      }
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

async function fetchPr(ctx: JobContext, parent: RunRecord): Promise<FetchResult> {
  const children = ctx.db.listRuns({ parentRunId: parent.id });
  const child = children.find((c) => c.prUrl && c.status === 'done');
  if (!child?.prUrl) return { kind: 'skip', runId: parent.id, reason: 'no child with prUrl' };

  const repo = ctx.db.getRepo(child.repoId);
  if (!repo) return { kind: 'error', runId: parent.id, error: 'repo not found' };

  try {
    const { stdout } = await execFile(
      'gh', ['pr', 'view', child.prUrl, '--json', 'state,mergedAt'],
      { cwd: repo.path, timeout: GH_TIMEOUT_MS, encoding: 'utf-8' },
    );
    const pr = JSON.parse(stdout.trim()) as PrViewJson;
    return { kind: 'ok', pr, runId: parent.id, child, parent };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { kind: 'error', runId: parent.id, error: msg };
  }
}
