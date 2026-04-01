import type { ShadowDatabase } from '../storage/database.js';
import type { UserProfileRecord } from '../storage/models.js';

// --- Trust level definitions ---

export type TrustLevelInfo = {
  level: number;
  name: string;
  description: string;
};

export const TRUST_LEVELS: TrustLevelInfo[] = [
  { level: 1, name: 'observer', description: 'Read-only. Report observations. Never modify code.' },
  { level: 2, name: 'advisor', description: 'Generate suggestions. Consolidate memory. No code changes.' },
  { level: 3, name: 'assistant', description: 'Execute small tasks. Communicate with contacts. Others need confirmation.' },
  { level: 4, name: 'partner', description: 'Execute medium tasks. Auto-fix lint/types. Request approval for large changes.' },
  { level: 5, name: 'shadow', description: 'Create branches, propose PRs. Only restriction: no push to main without approval.' },
];

// --- Trust level computation ---

/**
 * Map a numeric trust score (0-100) to the corresponding trust level.
 *
 * Thresholds:
 *   0-14  -> level 1 (observer)
 *  15-34  -> level 2 (advisor)
 *  35-59  -> level 3 (assistant)
 *  60-84  -> level 4 (partner)
 *  85-100 -> level 5 (shadow)
 */
export function computeTrustLevel(score: number): TrustLevelInfo {
  if (score >= 85) return TRUST_LEVELS[4]; // level 5
  if (score >= 60) return TRUST_LEVELS[3]; // level 4
  if (score >= 35) return TRUST_LEVELS[2]; // level 3
  if (score >= 15) return TRUST_LEVELS[1]; // level 2
  return TRUST_LEVELS[0]; // level 1
}

// --- Trust deltas ---

export type TrustDelta = {
  event: string;
  delta: number;
  reason: string;
};

export const TRUST_DELTAS: Record<string, TrustDelta> = {
  suggestion_accepted: {
    event: 'suggestion_accepted',
    delta: 2.0,
    reason: 'User accepted a suggestion',
  },
  suggestion_converted: {
    event: 'suggestion_converted',
    delta: 3.0,
    reason: 'Suggestion was converted into a run',
  },
  run_success: {
    event: 'run_success',
    delta: 1.5,
    reason: 'Automated run completed successfully',
  },
  memory_taught: {
    event: 'memory_taught',
    delta: 1.0,
    reason: 'User explicitly taught shadow something',
  },
  positive_sentiment: {
    event: 'positive_sentiment',
    delta: 0.5,
    reason: 'Positive sentiment detected in interaction',
  },
  suggestion_dismissed: {
    event: 'suggestion_dismissed',
    delta: -0.5,
    reason: 'User dismissed a suggestion',
  },
  three_dismissed_in_row: {
    event: 'three_dismissed_in_row',
    delta: -3.0,
    reason: 'Three suggestions dismissed consecutively',
  },
  run_failed: {
    event: 'run_failed',
    delta: -2.0,
    reason: 'Automated run failed',
  },
  user_override: {
    event: 'user_override',
    delta: -5.0,
    reason: 'User manually overrode shadow action',
  },
  inactivity_day: {
    event: 'inactivity_day',
    delta: -1.0,
    reason: 'A full day passed with no interaction',
  },
  heartbeat_completed: {
    event: 'heartbeat_completed',
    delta: 0.5,
    reason: 'Heartbeat completed successfully with LLM analysis',
  },
  interaction_logged: {
    event: 'interaction_logged',
    delta: 0.2,
    reason: 'Batch of interactions logged from Claude CLI session',
  },
  check_in: {
    event: 'check_in',
    delta: 0.3,
    reason: 'User started a new session with Shadow',
  },
};

// --- Applying trust deltas ---

/**
 * Apply a trust delta event to the user profile.
 *
 * Retrieves (or creates) the default profile, applies the delta for the
 * given event name, clamps the score to [0, 100], updates the profile in
 * the database, and returns the new score, level, and applied delta.
 *
 * Throws if the event name is not found in TRUST_DELTAS.
 */
export function applyTrustDelta(
  db: ShadowDatabase,
  event: string,
): { newScore: number; newLevel: TrustLevelInfo; delta: number } {
  const entry = TRUST_DELTAS[event];
  if (!entry) {
    throw new Error(`Unknown trust delta event: ${event}`);
  }

  const profile = db.ensureProfile('default');
  const oldScore = profile.trustScore;
  const newScore = Math.max(0, Math.min(100, oldScore + entry.delta));
  const newLevel = computeTrustLevel(newScore);

  db.updateProfile(profile.id, {
    trustScore: newScore,
    trustLevel: newLevel.level,
  });

  return { newScore, newLevel, delta: entry.delta };
}

// --- Autonomy overrides ---

export type AutonomyOverride = {
  action: string;
  allowed: boolean;
  minTrustLevel?: number;
};

/**
 * Default action-to-minimum-trust-level mapping.
 *
 * Actions not listed here are allowed at any trust level.
 */
const DEFAULT_ACTION_TRUST: Record<string, number> = {
  observe: 1,
  suggest: 2,
  consolidate: 2,
  execute_small: 3,
  communicate: 3,
  execute_medium: 4,
  auto_fix: 4,
  create_branch: 5,
  propose_pr: 5,
  push_main: Infinity, // never allowed without explicit approval
};

/**
 * Check whether a given action is allowed for the user's current trust
 * level and autonomy overrides stored in profile.preferences.
 *
 * The function first checks for explicit overrides in
 * `profile.preferences.autonomyOverrides` (an array of AutonomyOverride),
 * then falls back to the default action-trust mapping.
 */
export function isActionAllowed(
  action: string,
  profile: UserProfileRecord,
): { allowed: boolean; reason: string } {
  const currentLevel = computeTrustLevel(profile.trustScore).level;

  // Check explicit overrides from preferences
  const overrides = (
    (profile.preferences as Record<string, unknown>)?.autonomyOverrides ?? []
  ) as AutonomyOverride[];

  for (const override of overrides) {
    if (override.action === action) {
      if (!override.allowed) {
        return { allowed: false, reason: `Action "${action}" is explicitly disabled by user override.` };
      }
      const minLevel = override.minTrustLevel ?? 1;
      if (currentLevel >= minLevel) {
        return { allowed: true, reason: `Action "${action}" allowed by user override (trust level ${currentLevel} >= ${minLevel}).` };
      }
      return {
        allowed: false,
        reason: `Action "${action}" requires trust level ${minLevel} but current level is ${currentLevel}.`,
      };
    }
  }

  // Fall back to default mapping
  const requiredLevel = DEFAULT_ACTION_TRUST[action];
  if (requiredLevel === undefined) {
    // Unknown action: allow by default
    return { allowed: true, reason: `Action "${action}" has no restrictions.` };
  }

  if (requiredLevel === Infinity) {
    return { allowed: false, reason: `Action "${action}" always requires explicit approval.` };
  }

  if (currentLevel >= requiredLevel) {
    return { allowed: true, reason: `Trust level ${currentLevel} >= required ${requiredLevel} for "${action}".` };
  }

  return {
    allowed: false,
    reason: `Action "${action}" requires trust level ${requiredLevel} but current level is ${currentLevel}.`,
  };
}
