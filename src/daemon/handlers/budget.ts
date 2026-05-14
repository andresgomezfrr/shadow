import type { JobContext, JobHandlerResult, DaemonSharedState } from '../job-handlers.js';
import { monthlyProgrammaticCostUsd } from '../../analysis/cost.js';

// `programmatic-budget-check` — read llm_usage rollup, estimate monthly cost
// in USD, and persist a verdict. Cheap, no LLM, runs every
// SHADOW_PROGRAMMATIC_BUDGET_INTERVAL_MS (default 6h).
//
// The daemon's main loop reads this job's last result and converts it into
// `state.alerts` entries with id `programmatic_budget` so they surface in
// `shadow_alerts`, the dashboard, and the status line. We keep the alert
// logic in the main loop (next to the other alert managers) rather than
// inside the handler so the alert list stays single-sourced.

export type BudgetCheckLevel = 'ok' | 'warning_70' | 'warning_90' | 'over_100';

export type BudgetCheckResult = {
  level: BudgetCheckLevel;
  monthlyUsd: number;
  budgetUsd: number;
  pct: number;
  month: string;
  byModel: Record<string, { usd: number; calls: number }>;
};

export async function handleProgrammaticBudgetCheck(
  ctx: JobContext,
  _shared: DaemonSharedState,
): Promise<JobHandlerResult> {
  ctx.setPhase('aggregate');

  const summary = monthlyProgrammaticCostUsd(ctx.db);
  const budgetUsd = ctx.config.programmaticBudgetUsd;
  const pct = budgetUsd > 0 ? (summary.totalUsd / budgetUsd) * 100 : 0;

  let level: BudgetCheckLevel = 'ok';
  if (pct >= 100) level = 'over_100';
  else if (pct >= 90) level = 'warning_90';
  else if (pct >= 70) level = 'warning_70';

  // Shrink byModel payload to the essentials before persisting in jobs.result.
  const byModel: BudgetCheckResult['byModel'] = {};
  for (const [k, v] of Object.entries(summary.byModel)) {
    byModel[k] = { usd: Number(v.usd.toFixed(4)), calls: v.calls };
  }

  const result: BudgetCheckResult = {
    level,
    monthlyUsd: Number(summary.totalUsd.toFixed(4)),
    budgetUsd,
    pct: Number(pct.toFixed(2)),
    month: summary.month,
    byModel,
  };

  return {
    llmCalls: 0,
    tokensUsed: 0,
    phases: ['aggregate'],
    result: result as unknown as Record<string, unknown>,
  };
}
