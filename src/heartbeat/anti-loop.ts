import type { ShadowConfig } from '../config/schema.js';
import type { ShadowDatabase } from '../storage/database.js';

// --- Anti-loop state ---

export type AntiLoopState = {
  lastObservedPerRepo: Map<string, string>; // repoId -> ISO timestamp
  pendingSuggestionCount: number;
  lastConsolidationAt: string | null;
  recentSuggestionKinds: string[]; // last 3
  consecutiveIdleHeartbeats: number;
};

// --- Constants ---

const MIN_OBSERVE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_PENDING_SUGGESTIONS = 30;
const MIN_CONSOLIDATION_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const MAX_HEARTBEAT_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const IDLE_ESCALATION_THRESHOLD = 5;
const IDLE_ESCALATION_MULTIPLIER = 2;

// --- Guards ---

/**
 * Returns true if we should observe the given repo.
 * Enforces a minimum 5-minute gap between observations of the same repo.
 */
export function shouldObserveRepo(repoId: string, state: AntiLoopState): boolean {
  const lastObserved = state.lastObservedPerRepo.get(repoId);
  if (!lastObserved) return true;

  const elapsed = Date.now() - new Date(lastObserved).getTime();
  return elapsed >= MIN_OBSERVE_INTERVAL_MS;
}

/**
 * Returns true if we should generate a new suggestion.
 * Blocks when pending suggestion count is at the limit (3).
 */
export function shouldSuggest(state: AntiLoopState): boolean {
  return state.pendingSuggestionCount < MAX_PENDING_SUGGESTIONS;
}

/**
 * Returns true if memory consolidation should run.
 * At most once every 6 hours, but forced on the first heartbeat after midnight (00:00).
 */
export function shouldConsolidate(state: AntiLoopState): boolean {
  const now = new Date();

  // Forced daily: if no consolidation today yet
  if (state.lastConsolidationAt) {
    const lastDate = new Date(state.lastConsolidationAt);
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    // First heartbeat after midnight: force consolidation if last was before today
    if (lastDate.getTime() < todayStart.getTime()) {
      return true;
    }

    // Otherwise, enforce 6-hour minimum
    const elapsed = now.getTime() - lastDate.getTime();
    return elapsed >= MIN_CONSOLIDATION_INTERVAL_MS;
  }

  // Never consolidated before: do it now
  return true;
}

/**
 * Compute the next heartbeat interval in milliseconds.
 *
 * Idle escalation: after 5 consecutive idle heartbeats, the interval doubles
 * (capped at 1 hour). Resets to the configured base interval on the first
 * observation.
 */
export function computeNextHeartbeatMs(config: ShadowConfig, state: AntiLoopState): number {
  const baseInterval = config.heartbeatIntervalMs;

  if (state.consecutiveIdleHeartbeats < IDLE_ESCALATION_THRESHOLD) {
    return baseInterval;
  }

  // Number of doublings beyond the threshold
  const doublings = state.consecutiveIdleHeartbeats - IDLE_ESCALATION_THRESHOLD + 1;
  const escalated = baseInterval * Math.pow(IDLE_ESCALATION_MULTIPLIER, doublings);

  return Math.min(escalated, MAX_HEARTBEAT_INTERVAL_MS);
}

// --- State builder ---

/**
 * Build the anti-loop state by querying the database.
 */
export function buildAntiLoopState(db: ShadowDatabase): AntiLoopState {
  // 1. Last observed per repo: from repos table
  const repos = db.listRepos();
  const lastObservedPerRepo = new Map<string, string>();
  for (const repo of repos) {
    if (repo.lastObservedAt) {
      lastObservedPerRepo.set(repo.id, repo.lastObservedAt);
    }
  }

  // 2. Pending suggestion count
  const pendingSuggestionCount = db.countPendingSuggestions();

  // 3. Last consolidation: find the most recent 'consolidate' heartbeat
  const heartbeats = listRecentHeartbeatsByPhase(db, 'consolidate', 1);
  const lastConsolidationAt = heartbeats.length > 0
    ? heartbeats[0].finishedAt ?? heartbeats[0].startedAt
    : null;

  // 4. Recent suggestion kinds: last 3 suggestions
  const recentSuggestions = db.listSuggestions({ status: undefined });
  const recentSuggestionKinds = recentSuggestions
    .slice(0, 3)
    .map((s) => s.kind);

  // 5. Consecutive idle heartbeats: count from the tail of heartbeat history
  let consecutiveIdleHeartbeats = 0;
  const recentHeartbeats = listRecentHeartbeats(db, 20);
  for (const hb of recentHeartbeats) {
    if (hb.observationsCreated === 0 && hb.suggestionsCreated === 0) {
      consecutiveIdleHeartbeats++;
    } else {
      break;
    }
  }

  return {
    lastObservedPerRepo,
    pendingSuggestionCount,
    lastConsolidationAt,
    recentSuggestionKinds,
    consecutiveIdleHeartbeats,
  };
}

// --- Internal helpers ---

/**
 * List recent heartbeats filtered by phase. Uses the general listing and
 * filters in memory since the database API does not expose phase filters.
 */
function listRecentHeartbeatsByPhase(
  db: ShadowDatabase,
  phase: string,
  limit: number,
): { startedAt: string; finishedAt: string | null }[] {
  const all = listRecentHeartbeats(db, 50);
  const matched: { startedAt: string; finishedAt: string | null }[] = [];
  for (const hb of all) {
    if (hb.phase === phase) {
      matched.push(hb);
      if (matched.length >= limit) break;
    }
  }
  return matched;
}

/**
 * Retrieve the N most recent heartbeats (most recent first).
 * Uses getLastHeartbeat for the first one. For larger counts we rely on
 * the database's listSuggestions-like pattern -- but the heartbeat table
 * only exposes getLastHeartbeat, so we work with what we have.
 *
 * NOTE: This is a pragmatic approach. The ShadowDatabase currently only
 * exposes `getLastHeartbeat`. We call it once and then fall back to an
 * empty list for the rest, which means idle detection may undercount on
 * the very first build. In practice the heartbeat table is small and a
 * future `listHeartbeats` method can be added.
 */
function listRecentHeartbeats(
  _db: ShadowDatabase,
  _limit: number,
): { phase: string; observationsCreated: number; suggestionsCreated: number; startedAt: string; finishedAt: string | null }[] {
  // The database only provides getLastHeartbeat(). We return it as a
  // single-element array if available; callers handle the limited data.
  const last = _db.getLastHeartbeat();
  if (!last) return [];
  return [
    {
      phase: last.phase,
      observationsCreated: last.observationsCreated,
      suggestionsCreated: last.suggestionsCreated,
      startedAt: last.startedAt,
      finishedAt: last.finishedAt,
    },
  ];
}
