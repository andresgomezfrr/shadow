/**
 * Centralized polling intervals for useApi / setInterval call sites
 * (audit UI-07). Five named tiers map to the five distinct values that
 * already lived scattered across the dashboard, so this is a rename pass
 * with no behavioral change. Pick by what the user expects:
 *
 *   POLL_REALTIME — visible counters that should feel snappy (notifications).
 *   POLL_FAST     — live status of running work (activity, jobs).
 *   POLL_NORMAL   — default for most lists; balances freshness and load.
 *   POLL_SLOW     — entity lookups that rarely change (repos, projects, systems).
 *   POLL_VERY_SLOW — settings/admin pages where staleness is acceptable.
 */

export const POLL_REALTIME = 10_000;   // 10s
export const POLL_FAST = 15_000;       // 15s
export const POLL_NORMAL = 30_000;     // 30s
export const POLL_SLOW = 60_000;       // 1min
export const POLL_VERY_SLOW = 120_000; // 2min
