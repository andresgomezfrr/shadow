import type { ShadowDatabase } from '../storage/database.js';
import type { SuggestionRecord } from '../storage/models.js';

export type SuggestionAction = 'accept' | 'dismiss' | 'snooze' | 'expire';

const STALE_DAYS = 30;
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
  category?: string,
): { ok: boolean; runCreated?: string } {
  const suggestion = db.getSuggestion(suggestionId);
  if (!suggestion || suggestion.status !== 'pending') {
    return { ok: false };
  }

  const now = new Date().toISOString();
  const acceptCategory = category ?? 'execute';

  // Mark suggestion as accepted — store category in feedbackNote for filtering
  db.updateSuggestion(suggestionId, {
    status: acceptCategory === 'planned' ? 'backlog' : 'accepted',
    feedbackNote: acceptCategory,
    resolvedAt: now,
  });
  db.createFeedback({ targetKind: 'suggestion', targetId: suggestionId, action: 'accept', category: acceptCategory });

  // Apply positive trust delta
  applyTrustDelta(db, TRUST_ACCEPT);

  // Only create a Run for 'execute' category (default behavior)
  let runId: string | undefined;
  if (acceptCategory === 'execute') {
    const primaryRepoId = suggestion.repoIds.length > 0
      ? suggestion.repoIds[0]
      : suggestion.repoId ?? 'unknown';

    const run = db.createRun({
      repoId: primaryRepoId,
      repoIds: suggestion.repoIds.length > 0 ? suggestion.repoIds : (suggestion.repoId ? [suggestion.repoId] : []),
      suggestionId: suggestion.id,
      kind: suggestion.kind,
      prompt: suggestion.summaryMd,
    });
    runId = run.id;
  }

  // Audit trail
  db.createAuditEvent({
    interface: 'suggestion-engine',
    action: 'accept-suggestion',
    targetKind: 'suggestion',
    targetId: suggestionId,
    detail: { category: acceptCategory, runId: runId ?? null },
  });

  return { ok: true, runCreated: runId };
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
  category?: string,
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
  db.createFeedback({ targetKind: 'suggestion', targetId: suggestionId, action: 'dismiss', note, category });

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

  db.createFeedback({ targetKind: 'suggestion', targetId: suggestionId, action: 'snooze' });

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
// Reactivate snoozed
// ---------------------------------------------------------------------------

/**
 * Reactivate snoozed suggestions whose snooze period has expired.
 * Moves them back to 'pending' status.
 */
export function reactivateSnoozed(db: ShadowDatabase): number {
  const snoozed = db.listSuggestions({ status: 'snoozed' });
  const now = new Date().toISOString();
  let count = 0;

  for (const s of snoozed) {
    if (s.expiresAt && s.expiresAt <= now) {
      db.updateSuggestion(s.id, { status: 'pending', expiresAt: null });
      count++;
    }
  }

  if (count > 0) {
    db.createAuditEvent({
      interface: 'suggestion-engine',
      action: 'reactivate-snoozed',
      detail: { count },
    });
  }

  return count;
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
// Notify expiring soon (3 days before STALE_DAYS)
// ---------------------------------------------------------------------------

/**
 * Create notification events for suggestions that will expire in 3 days.
 * Only notifies once per suggestion (checks if event already exists).
 */
export function notifyExpiringSoon(db: ShadowDatabase): number {
  const warningDays = STALE_DAYS - 3;
  const cutoff = new Date(Date.now() - warningDays * 24 * 60 * 60 * 1000).toISOString();
  const expiryCutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const pending = db.listSuggestions({ status: 'pending' });

  let count = 0;
  for (const s of pending) {
    // Between warning and expiry cutoff, and not snoozed
    if (s.createdAt < cutoff && s.createdAt >= expiryCutoff && !s.expiresAt) {
      db.createEvent({
        kind: 'suggestion_expiring',
        priority: 3,
        payload: { message: `Suggestion expiring in 3 days: ${s.title}`, suggestionId: s.id },
      });
      count++;
    }
  }

  return count;
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
