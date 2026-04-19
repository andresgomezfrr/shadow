import type { JobContext, JobHandlerResult } from '../job-handlers.js';

const RETENTION_DAYS = 90;

/**
 * Daily cleanup — purges rows older than RETENTION_DAYS from high-churn tables.
 *
 * Protected (never purged):
 *   - feedback: load-bearing for checkSuggestionDuplicate dismissed dedup + correction lifecycle
 *   - audit_events: append-only trail
 *   - event_queue WHERE delivered=0: pending events never purged (stale pending = bug signal)
 *
 * llm_usage is rolled up into llm_usage_daily before being purged so historical
 * token views (year, etc.) stay queryable via the aggregated table.
 */
export async function handleCleanup(ctx: JobContext): Promise<JobHandlerResult> {
  ctx.setPhase('cleanup');

  // 1. Rollup raw llm_usage rows > RETENTION_DAYS into llm_usage_daily (idempotent via ON CONFLICT)
  const rolledUp = ctx.db.rollupLlmUsageDaily(RETENTION_DAYS);

  // 2. Delete aged rows from each high-churn table. Order doesn't matter semantically
  //    — they're independent — but we run rollup first to guarantee no raw data loss.
  const deleted = {
    llm_usage: ctx.db.deleteOldLlmUsage(RETENTION_DAYS),
    interactions: ctx.db.deleteOldInteractions(RETENTION_DAYS),
    event_queue: ctx.db.deleteOldDeliveredEvents(RETENTION_DAYS),
    jobs: ctx.db.deleteOldJobs(RETENTION_DAYS),
  };

  const totalDeleted = deleted.llm_usage + deleted.interactions + deleted.event_queue + deleted.jobs;
  console.error(
    `[cleanup] retention=${RETENTION_DAYS}d  rolled up ${rolledUp} llm_usage_daily rows, `
    + `deleted ${totalDeleted} total (llm_usage=${deleted.llm_usage}, `
    + `interactions=${deleted.interactions}, event_queue=${deleted.event_queue}, jobs=${deleted.jobs})`,
  );

  return {
    llmCalls: 0,
    tokensUsed: 0,
    phases: ['cleanup'],
    result: {
      retentionDays: RETENTION_DAYS,
      rolledUp,
      deleted,
      totalDeleted,
    },
  };
}
