/**
 * Logger convention (audit O-05).
 *
 * The project historically used `console.error` for everything — errors,
 * warnings, and info — which made grepping for real failures hard. This
 * module defines the convention and provides thin wrappers.
 *
 * ## Usage
 *
 * Varargs-compatible with `console.error` so migration is pure token
 * replacement:
 *
 *   log.error('[component] failed:', errToString(e))
 *   log.warn('[component] fallback triggered: using cached value')
 *   log.info('[component] Captured plan from session:', filePath)
 *
 * ## Convention (which one to pick)
 *
 *   - `log.error` — real failure (retryable or terminal). The thing you
 *     want to grep for when something is broken.
 *   - `log.warn` — degradation (fallback triggered, non-fatal anomaly,
 *     stale data). Actionable if it repeats.
 *   - `log.info` — lifecycle/progress/milestone ("session started",
 *     "N memories promoted", "tier rose to 4"). Normal operational
 *     noise, not a problem.
 *
 * All three go to stderr — launchd captures it into `~/.shadow/daemon.log`
 * via the plist (single stream). stdout stays reserved for JSON output
 * from CLI flows. The level distinction is a discrimination signal for
 * the reader (and future tooling), not a routing signal.
 *
 * ## Migration note
 *
 * Existing `console.error(...)` calls are being swept to `log.error/warn/
 * info` with per-call judgment. Obvious progress messages (e.g. "Captured",
 * "Completed", "Evolved") become `log.info`; fallback/degradation markers
 * become `log.warn`; catch-block error-context calls stay `log.error`.
 */

export const log = {
  error: (...args: unknown[]): void => {
    console.error(...args);
  },
  warn: (...args: unknown[]): void => {
    console.error(...args);
  },
  info: (...args: unknown[]): void => {
    // stderr via process.stderr.write to keep stdout clean for CLI JSON
    const out = args
      .map((a) => (typeof a === 'string' ? a : typeof a === 'object' ? JSON.stringify(a) : String(a)))
      .join(' ');
    process.stderr.write(out + '\n');
  },
};

/**
 * Narrow helper for the recurring "catch swallowed an error" pattern. Use at
 * the end of best-effort try blocks where you want to record the failure
 * without interrupting the caller. Normalizes `unknown → string`.
 */
export function errToString(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
