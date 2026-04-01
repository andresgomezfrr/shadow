import type { ShadowDatabase } from '../storage/database.js';
import type { SuggestionRecord } from '../storage/models.js';

export type SuggestionAction = 'accept' | 'dismiss' | 'snooze' | 'expire';

const STALE_DAYS = 7;
const TRUST_ACCEPT = 2.0;
const TRUST_DISMISS = -0.5;
const TRUST_STREAK_PENALTY = -3.0;
const STREAK_THRESHOLD = 3;

// ---------------------------------------------------------------------------
// Accept
// ---------------------------------------------------------------------------

/**
 * Accept a pending suggestion.
 * Sets status to 'accepted', creates a run from the suggestion, and applies
 * a positive trust delta (+2.0).
 */
export function acceptSuggestion(
  db: ShadowDatabase,
  suggestionId: string,
): { ok: boolean; runCreated?: string } {
  const suggestion = db.getSuggestion(suggestionId);
  if (!suggestion || suggestion.status !== 'pending') {
    return { ok: false };
  }

  const now = new Date().toISOString();

  // Mark suggestion as accepted
  db.updateSuggestion(suggestionId, {
    status: 'accepted',
    resolvedAt: now,
  });

  // Determine repo context for the run
  const primaryRepoId = suggestion.repoIds.length > 0
    ? suggestion.repoIds[0]
    : suggestion.repoId ?? 'unknown';

  // Create a run from the suggestion
  const run = db.createRun({
    repoId: primaryRepoId,
    repoIds: suggestion.repoIds.length > 0 ? suggestion.repoIds : (suggestion.repoId ? [suggestion.repoId] : []),
    suggestionId: suggestion.id,
    kind: suggestion.kind,
    prompt: suggestion.summaryMd,
  });

  // Apply positive trust delta
  applyTrustDelta(db, TRUST_ACCEPT);

  // Audit trail
  db.createAuditEvent({
    interface: 'suggestion-engine',
    action: 'accept-suggestion',
    targetKind: 'suggestion',
    targetId: suggestionId,
    detail: { runId: run.id },
  });

  return { ok: true, runCreated: run.id };
}

// ---------------------------------------------------------------------------
// Dismiss
// ---------------------------------------------------------------------------

/**
 * Dismiss a suggestion with an optional feedback note.
 * Applies trust delta (-0.5). If 3 consecutive dismissals occur, applies
 * an additional penalty (-3.0).
 */
export function dismissSuggestion(
  db: ShadowDatabase,
  suggestionId: string,
  note?: string,
): { ok: boolean } {
  const suggestion = db.getSuggestion(suggestionId);
  if (!suggestion || suggestion.status !== 'pending') {
    return { ok: false };
  }

  const now = new Date().toISOString();

  db.updateSuggestion(suggestionId, {
    status: 'dismissed',
    feedbackNote: note ?? null,
    resolvedAt: now,
  });

  // Apply base dismiss trust delta
  let totalDelta = TRUST_DISMISS;

  // Check for consecutive dismissal streak (including this one)
  const streak = getDismissalStreak(db);
  if (streak >= STREAK_THRESHOLD && streak % STREAK_THRESHOLD === 0) {
    totalDelta += TRUST_STREAK_PENALTY;
  }

  applyTrustDelta(db, totalDelta);

  db.createAuditEvent({
    interface: 'suggestion-engine',
    action: 'dismiss-suggestion',
    targetKind: 'suggestion',
    targetId: suggestionId,
    detail: { note: note ?? null, streak, trustDelta: totalDelta },
  });

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Snooze
// ---------------------------------------------------------------------------

/**
 * Snooze a suggestion until a given ISO date string.
 * Sets status to 'snoozed' and expires_at to the provided date.
 */
export function snoozeSuggestion(
  db: ShadowDatabase,
  suggestionId: string,
  until: string,
): { ok: boolean } {
  const suggestion = db.getSuggestion(suggestionId);
  if (!suggestion || suggestion.status !== 'pending') {
    return { ok: false };
  }

  db.updateSuggestion(suggestionId, {
    status: 'snoozed',
    expiresAt: until,
  });

  db.createAuditEvent({
    interface: 'suggestion-engine',
    action: 'snooze-suggestion',
    targetKind: 'suggestion',
    targetId: suggestionId,
    detail: { until },
  });

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Expire stale
// ---------------------------------------------------------------------------

/**
 * Expire all pending suggestions older than 7 days.
 * Returns the count of expired suggestions.
 */
export function expireStale(db: ShadowDatabase): number {
  const cutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const pending = db.listSuggestions({ status: 'pending' });
  const now = new Date().toISOString();

  let expiredCount = 0;

  for (const suggestion of pending) {
    if (suggestion.createdAt < cutoff) {
      db.updateSuggestion(suggestion.id, {
        status: 'expired',
        resolvedAt: now,
      });
      expiredCount++;
    }
  }

  if (expiredCount > 0) {
    db.createAuditEvent({
      interface: 'suggestion-engine',
      action: 'expire-stale-suggestions',
      detail: { expiredCount },
    });
  }

  return expiredCount;
}

// ---------------------------------------------------------------------------
// Dismissal streak
// ---------------------------------------------------------------------------

/**
 * Count consecutive dismissed suggestions, most recent first.
 * Stops at the first non-dismissed resolved suggestion.
 */
export function getDismissalStreak(db: ShadowDatabase): number {
  // Get all resolved suggestions ordered by most recent first
  const all = db.listSuggestions();
  let streak = 0;

  for (const s of all) {
    // Skip suggestions that haven't been resolved yet
    if (s.status === 'pending' || s.status === 'snoozed') {
      continue;
    }
    if (s.status === 'dismissed') {
      streak++;
    } else {
      // First non-dismissed resolved suggestion breaks the streak
      break;
    }
  }

  return streak;
}

// ---------------------------------------------------------------------------
// Trust helper
// ---------------------------------------------------------------------------

function applyTrustDelta(db: ShadowDatabase, delta: number): void {
  const profile = db.ensureProfile();
  const newScore = Math.max(0, Math.min(100, profile.trustScore + delta));
  db.updateProfile(profile.id, { trustScore: newScore });

  db.createInteraction({
    interface: 'suggestion-engine',
    kind: 'trust-update',
    outputSummary: `Trust delta: ${delta >= 0 ? '+' : ''}${delta} (${profile.trustScore} -> ${newScore})`,
    trustDelta: delta,
  });
}
