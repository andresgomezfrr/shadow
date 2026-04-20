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
  | { kind: 'ok'; pr: PrViewJson; runId: string; prUrl: string; subject: RunRecord; standalone: boolean }
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
    const results = await Promise.all(chunk.map((run) => fetchPr(ctx, run)));

    for (const result of results) {
      if (result.kind === 'skip') continue;
      if (result.kind === 'error') {
        console.error(`[pr-sync] Failed to check PR for run ${result.runId.slice(0, 8)}: ${result.error}`);
        errors++;
        processed.push({ runId: result.runId, action: 'error', error: result.error.slice(0, 200) });
        continue;
      }

      const { pr, subject, prUrl, standalone } = result;
      if (pr.state === 'MERGED') {
        ctx.db.transitionRun(subject.id, 'done');
        ctx.db.updateRun(subject.id, { outcome: 'merged' });
        ctx.db.createEvent({
          kind: 'pr_merged',
          priority: 5,
          payload: { message: `PR merged: ${prUrl}`, runId: subject.id, prUrl },
        });
        merged++;
        processed.push({ runId: subject.id, action: 'merged', prUrl });
      } else if (pr.state === 'CLOSED') {
        // Standalone runs finalize as done/closed_manual to match the
        // outcome-based terminal vocabulary the user sees elsewhere (audit R-07).
        // Parent runs keep the historical `dismissed` status for back-compat.
        if (standalone) {
          ctx.db.transitionRun(subject.id, 'done');
          ctx.db.updateRun(subject.id, { outcome: 'closed_manual', closedNote: 'PR closed without merge' });
        } else {
          ctx.db.transitionRun(subject.id, 'dismissed');
          ctx.db.updateRun(subject.id, { closedNote: 'PR closed without merge' });
        }
        closed++;
        processed.push({ runId: subject.id, action: 'closed', prUrl });
      } else {
        stillOpen++;
        processed.push({ runId: subject.id, action: 'open', prUrl });
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

async function fetchPr(ctx: JobContext, run: RunRecord): Promise<FetchResult> {
  // Two modes:
  //   1. Parent run with execution children — we inspect the child's PR (legacy path).
  //   2. Standalone run (no parent) carrying its own prUrl — inspect it directly
  //      (audit R-07: without this, standalone runs with a manual PR link sit in
  //      awaiting_pr forever since pr-sync was child-only).
  let prUrl: string | null = null;
  let repoId: string | null = null;
  let standalone = false;

  if (!run.parentRunId && run.prUrl) {
    // Standalone self-terminal: the run itself owns the PR
    prUrl = run.prUrl;
    repoId = run.repoId;
    standalone = true;
  } else {
    const children = ctx.db.listRuns({ parentRunId: run.id });
    const child = children.find((c) => c.prUrl && c.status === 'done');
    if (!child?.prUrl) return { kind: 'skip', runId: run.id, reason: 'no child with prUrl and no standalone prUrl' };
    prUrl = child.prUrl;
    repoId = child.repoId;
  }

  const repo = ctx.db.getRepo(repoId);
  if (!repo) return { kind: 'error', runId: run.id, error: 'repo not found' };

  try {
    const { stdout } = await execFile(
      'gh', ['pr', 'view', prUrl, '--json', 'state,mergedAt'],
      { cwd: repo.path, timeout: GH_TIMEOUT_MS, encoding: 'utf-8' },
    );
    const pr = JSON.parse(stdout.trim()) as PrViewJson;
    return { kind: 'ok', pr, runId: run.id, prUrl, subject: run, standalone };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { kind: 'error', runId: run.id, error: msg };
  }
}
