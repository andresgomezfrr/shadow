import { execFile as _execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { JobContext, JobHandlerResult, DaemonSharedState } from '../job-handlers.js';
import { log } from '../../log.js';

const execFile = promisify(_execFile);

// `revalidate-stale-batch` — periodic detector that enqueues
// `revalidate-suggestion` jobs for suggestions that have aged past a threshold
// AND have likely been touched (the repo had commits since the suggestion was
// created). Born from real-use feedback: Andrés works multi-day blocks; the
// reactive suggest-after-heartbeat trigger creates suggestions during the work
// that get auto-addressed by the same work but stay in the feed as obsolete.
//
// The real revalidation work (LLM reads code with Read/Grep/Glob, returns a
// verdict) is done by the existing `revalidate-suggestion` handler. This
// handler is the cheap I/O batch detector — git log only, no LLM here.
export async function handleRevalidateStaleBatch(
  ctx: JobContext,
  _shared: DaemonSharedState,
): Promise<JobHandlerResult> {
  ctx.setPhase('scan');

  const now = Date.now();
  const ageThresholdMs = ctx.config.revalidateStaleAgeThresholdMs;
  const cooldownMs = ctx.config.revalidateStaleCooldownMs;
  const maxPerBatch = ctx.config.revalidateStaleMaxPerBatch;
  const gitTimeoutMs = ctx.config.revalidateStaleGitTimeoutMs;

  const ageCutoffIso = new Date(now - ageThresholdMs).toISOString();
  const cooldownCutoffIso = new Date(now - cooldownMs).toISOString();

  // Pull a generous slice — the filtering is cheap; we don't want to miss
  // candidates buried in pagination if the open set grows. listSuggestions
  // already filters archived/dismissed naturally by status='open'.
  const openSuggestions = ctx.db.listSuggestions({ status: 'open', limit: 500 });

  const candidates = openSuggestions
    .filter((s) => s.createdAt <= ageCutoffIso)
    .filter((s) => !s.lastRevalidatedAt || s.lastRevalidatedAt <= cooldownCutoffIso)
    // Oldest first — those have had the most time to become obsolete and the
    // most commit history to evaluate against.
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const stats = {
    candidatesConsidered: candidates.length,
    scheduled: 0,
    scheduledIds: [] as string[],
    skippedNoRepo: 0,
    skippedNoCommitsSinceCreation: 0,
    skippedAlreadyQueued: 0,
    skippedGitError: 0,
  };

  ctx.setPhase('enqueue');

  for (const sug of candidates) {
    if (stats.scheduled >= maxPerBatch) break;
    if (ctx.signal.aborted) break;

    if (!sug.repoId) {
      stats.skippedNoRepo++;
      continue;
    }
    const repo = ctx.db.getRepo(sug.repoId);
    if (!repo) {
      stats.skippedNoRepo++;
      continue;
    }

    // Cheap pre-filter: if the repo had ZERO commits since this suggestion
    // was created, there's literally nothing to re-evaluate against and the
    // expensive `revalidate-suggestion` LLM call would just confirm the
    // same verdict. Skip and let the cooldown decide next pass.
    let hasNewCommits = false;
    try {
      const { stdout } = await execFile(
        'git',
        ['log', `--since=${sug.createdAt}`, '--oneline', '-1'],
        { cwd: repo.path, timeout: gitTimeoutMs, encoding: 'utf-8' },
      );
      hasNewCommits = stdout.trim().length > 0;
    } catch (e) {
      // Path missing, not a git repo, timeout, etc. — log once at info and
      // skip; don't block the batch over one unhappy repo.
      log.info(`[revalidate-stale] git log failed for ${repo.name} (${repo.path}): ${e instanceof Error ? e.message : String(e)}`);
      stats.skippedGitError++;
      continue;
    }

    if (!hasNewCommits) {
      stats.skippedNoCommitsSinceCreation++;
      continue;
    }

    // Idempotency: a manual revalidate-suggestion may already be in flight
    // from the UI Accept-with-doubts flow. Don't duplicate.
    if (ctx.db.hasQueuedOrRunningWithParams('revalidate-suggestion', 'suggestionId', sug.id)) {
      stats.skippedAlreadyQueued++;
      continue;
    }

    ctx.db.enqueueJob('revalidate-suggestion', {
      priority: 3,
      triggerSource: 'revalidate-stale-batch',
      params: { suggestionId: sug.id },
    });
    stats.scheduled++;
    stats.scheduledIds.push(sug.id);
  }

  if (stats.scheduled > 0) {
    log.info(`[revalidate-stale] scheduled ${stats.scheduled} revalidation(s) from ${stats.candidatesConsidered} candidate(s)`);
  }

  return {
    llmCalls: 0,
    tokensUsed: 0,
    phases: ['scan', 'enqueue'],
    result: stats,
  };
}
