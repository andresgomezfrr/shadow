import type { ShadowDatabase } from '../storage/database.js';

// Cost estimation for programmatic LLM usage.
//
// **Why this exists**: starting 2026-06-15, Anthropic Max 20x subscribers get a
// $200/month credit for Claude Agent SDK + `claude --print` usage (effectively
// every job the Shadow daemon runs — heartbeat, suggest, consolidate, reflect,
// digests, revalidate, auto-plan/execute, etc.). Subscription limits stay
// reserved for interactive Claude usage. The `llm_usage` table records every
// daemon-side call already; this module turns those token counts into a
// dollar estimate so a `programmatic-budget-check` job can raise alerts before
// the credit runs out mid-month.
//
// **Provenance note**: every entry in `llm_usage` today is daemon-side
// (heartbeat phases, analysis jobs, runner, etc.) — interactive `shadow` /
// `claude` flows do not record into this table. No `is_programmatic` column
// needed: the table IS the programmatic record.

// Per-million-token pricing in USD. Update when Anthropic changes prices.
// Override per-deployment via SHADOW_PRICING_<MODEL>_INPUT_PER_M /
// SHADOW_PRICING_<MODEL>_OUTPUT_PER_M env vars if you need to model a
// different mix.
type Price = { inputPerMillion: number; outputPerMillion: number };

export const MODEL_PRICING_USD: Record<string, Price> = {
  // Anthropic public pricing snapshot (Claude 4.x family).
  opus: { inputPerMillion: 15, outputPerMillion: 75 },
  sonnet: { inputPerMillion: 3, outputPerMillion: 15 },
  haiku: { inputPerMillion: 0.8, outputPerMillion: 4 },
};

// Normalize the model name as recorded in llm_usage (which can be the alias
// `sonnet` / `opus` / `haiku` OR a fully-qualified id like
// `claude-sonnet-4-6`) into the alias key used by MODEL_PRICING_USD.
export function normalizeModelKey(model: string): keyof typeof MODEL_PRICING_USD | null {
  const lc = model.toLowerCase();
  if (lc.includes('opus')) return 'opus';
  if (lc.includes('sonnet')) return 'sonnet';
  if (lc.includes('haiku')) return 'haiku';
  return null;
}

export function estimateCallCostUsd(opts: { model: string; inputTokens: number; outputTokens: number }): number {
  const key = normalizeModelKey(opts.model);
  if (!key) return 0; // unknown model — better to under-estimate than panic
  const price = MODEL_PRICING_USD[key];
  return (opts.inputTokens / 1_000_000) * price.inputPerMillion
    + (opts.outputTokens / 1_000_000) * price.outputPerMillion;
}

export type MonthlyCostSummary = {
  month: string; // 'YYYY-MM'
  totalUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCalls: number;
  byModel: Record<string, { usd: number; inputTokens: number; outputTokens: number; calls: number }>;
  bySource: Record<string, { usd: number; calls: number }>;
};

/**
 * Aggregate llm_usage rows for a given month (default: current month, Madrid
 * tz-agnostic — uses UTC since `created_at` is ISO). Returns dollar estimate
 * per model + per source. Lightweight: groups in memory after a single SQL
 * scan filtered by date prefix.
 */
export function monthlyProgrammaticCostUsd(db: ShadowDatabase, monthPrefix?: string): MonthlyCostSummary {
  const monthIso = monthPrefix ?? new Date().toISOString().slice(0, 7); // 'YYYY-MM'

  const rows = db.rawDb
    .prepare(
      `SELECT source, model, input_tokens, output_tokens
       FROM llm_usage
       WHERE substr(created_at, 1, 7) = ?`,
    )
    .all(monthIso) as Array<{ source: string; model: string; input_tokens: number; output_tokens: number }>;

  const summary: MonthlyCostSummary = {
    month: monthIso,
    totalUsd: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCalls: rows.length,
    byModel: {},
    bySource: {},
  };

  for (const r of rows) {
    const callUsd = estimateCallCostUsd({ model: r.model, inputTokens: r.input_tokens, outputTokens: r.output_tokens });
    summary.totalUsd += callUsd;
    summary.totalInputTokens += r.input_tokens;
    summary.totalOutputTokens += r.output_tokens;

    const modelKey = normalizeModelKey(r.model) ?? r.model;
    const m = summary.byModel[modelKey] ?? { usd: 0, inputTokens: 0, outputTokens: 0, calls: 0 };
    m.usd += callUsd;
    m.inputTokens += r.input_tokens;
    m.outputTokens += r.output_tokens;
    m.calls += 1;
    summary.byModel[modelKey] = m;

    const s = summary.bySource[r.source] ?? { usd: 0, calls: 0 };
    s.usd += callUsd;
    s.calls += 1;
    summary.bySource[r.source] = s;
  }

  return summary;
}
