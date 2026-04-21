import type { ShadowDatabase } from '../storage/database.js';
import { DAILY_TOKEN_BUDGET_PREF_KEY, DAILY_TOKEN_BUDGET_DEFAULT } from '../config/schema.js';
import { log } from '../log.js';

/**
 * Daily token budget gate (audit A-10). Non-critical jobs call this before
 * making LLM calls to avoid runaway cost when a bug or prompt regression
 * starts a retry loop. Critical jobs (heartbeat, runner, user-initiated MCP)
 * do not consult this — user intent always runs.
 *
 * Budget lives in profile.preferences[dailyTokenBudget]. Default: 1M
 * tokens/day. Set to 0 to disable the cap.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export type BudgetStatus = {
  budget: number;       // Configured cap (0 = disabled)
  used: number;         // Input + output tokens in the last 24h window
  remaining: number;    // max(0, budget - used); Infinity if disabled
  exceeded: boolean;    // used >= budget (only meaningful when budget > 0)
};

export function getDailyTokenBudget(db: ShadowDatabase): number {
  const profile = db.ensureProfile();
  const prefs = (profile.preferences ?? {}) as Record<string, unknown>;
  const raw = prefs[DAILY_TOKEN_BUDGET_PREF_KEY];
  const coerced = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  if (Number.isFinite(coerced) && coerced >= 0) return coerced;
  return DAILY_TOKEN_BUDGET_DEFAULT;
}

export function getBudgetStatus(db: ShadowDatabase, now: Date = new Date()): BudgetStatus {
  const budget = getDailyTokenBudget(db);
  if (budget === 0) {
    return { budget: 0, used: 0, remaining: Infinity, exceeded: false };
  }
  const since = new Date(now.getTime() - DAY_MS).toISOString();
  const row = db.rawDb
    .prepare(
      `SELECT COALESCE(SUM(input_tokens + output_tokens), 0) AS total
       FROM llm_usage WHERE created_at > ?`,
    )
    .get(since) as { total: number };
  const used = Number(row.total ?? 0);
  const remaining = Math.max(0, budget - used);
  return { budget, used, remaining, exceeded: used >= budget };
}

/**
 * Call at the top of a deferrable handler. Returns a skip-result payload
 * when the budget is exceeded so the caller can early-return with clear
 * reason; returns null otherwise and the handler proceeds.
 */
export function budgetSkipIfExceeded(
  db: ShadowDatabase,
  jobName: string,
): { skipped: true; reason: string; status: BudgetStatus } | null {
  const status = getBudgetStatus(db);
  if (!status.exceeded) return null;
  const pct = status.budget > 0 ? Math.round((status.used / status.budget) * 100) : 0;
  log.error(
    `[budget] skipping ${jobName} — daily token budget exceeded (`
    + `used=${status.used}/${status.budget}, ${pct}%)`,
  );
  return {
    skipped: true,
    reason: `daily_token_budget_exceeded (${status.used}/${status.budget})`,
    status,
  };
}
