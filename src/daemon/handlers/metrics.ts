import type { JobContext, JobHandlerResult } from '../job-handlers.js';
import type { DaemonSharedState } from '../job-handlers.js';
import { randomUUID } from 'node:crypto';
import { computeBondAxes } from '../../profile/bond.js';
import { log } from '../../log.js';

/**
 * metrics-snapshot job (audit O-04): captures daily snapshots of
 * interesting counters into `observability_metrics` for time-series
 * analysis later (bond evolution, memory layer distribution, dedup
 * hit rates, hook success rates, etc.).
 *
 * Minimal first version — bond axes + memory layer counts. Designed to
 * be extended incrementally as specific metrics become interesting.
 * UNIQUE(snapshot_date, metric_key) means calling twice on the same day
 * is a no-op via INSERT OR IGNORE.
 */
export async function handleMetricsSnapshot(ctx: JobContext, _shared: DaemonSharedState): Promise<JobHandlerResult> {
  ctx.setPhase('snapshot');

  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();
  const profile = ctx.db.ensureProfile();
  const axes = computeBondAxes(ctx.db, profile.bondResetAt);

  const metrics: Array<{ key: string; value: number; context?: Record<string, unknown> }> = [
    { key: 'bond.time', value: axes.time },
    { key: 'bond.depth', value: axes.depth },
    { key: 'bond.momentum', value: axes.momentum },
    { key: 'bond.alignment', value: axes.alignment },
    { key: 'bond.autonomy', value: axes.autonomy },
    { key: 'bond.tier', value: profile.bondTier },
    { key: 'memories.total', value: ctx.db.countMemories({ archived: false }) },
  ];

  // Per-layer counts
  for (const layer of ['core', 'hot', 'warm', 'cool', 'cold']) {
    metrics.push({
      key: `memories.layer.${layer}`,
      value: ctx.db.countMemories({ layer, archived: false }),
    });
  }

  // Observations + suggestions open counts
  metrics.push({
    key: 'observations.open',
    value: ctx.db.countObservations({ status: 'open' }),
  });
  metrics.push({
    key: 'suggestions.open',
    value: ctx.db.countSuggestions({ status: 'open' }),
  });

  const insert = ctx.db.rawDb.prepare(
    'INSERT OR IGNORE INTO observability_metrics (id, snapshot_date, metric_key, metric_value, context_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  );

  let inserted = 0;
  for (const m of metrics) {
    const result = insert.run(
      randomUUID(),
      today,
      m.key,
      m.value,
      JSON.stringify(m.context ?? {}),
      now,
    );
    if (Number(result.changes) > 0) inserted++;
  }

  log.info(`[metrics] snapshot ${today}: ${inserted}/${metrics.length} new metrics`);

  return {
    llmCalls: 0,
    tokensUsed: 0,
    phases: ['snapshot'],
    result: { snapshotDate: today, inserted, total: metrics.length },
  };
}
