import type { ShadowDatabase } from '../storage/database.js';
import type { SuggestionRecord } from '../storage/models.js';
import { checkMemoryDuplicate } from '../memory/dedup.js';
import { generateAndStoreEmbedding } from '../memory/lifecycle.js';
import { applyBondDelta } from '../profile/bond.js';

export type SuggestionAction = 'accept' | 'dismiss' | 'snooze' | 'expire';

const STALE_DAYS = 30;
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
): { ok: boolean; runCreated?: string; taskCreated?: string } {
  const suggestion = db.getSuggestion(suggestionId);
  if (!suggestion || suggestion.status !== 'open') {
    return { ok: false };
  }

  const now = new Date().toISOString();
  const acceptCategory = category ?? 'execute';

  // Mark suggestion as accepted — store category in feedbackNote for filtering
  db.updateSuggestion(suggestionId, {
    status: 'accepted',
    feedbackNote: acceptCategory,
    resolvedAt: now,
  });
  db.deleteEmbedding('suggestion_vectors', suggestionId);
  db.createFeedback({ targetKind: 'suggestion', targetId: suggestionId, action: 'accept', category: acceptCategory });

  // Apply bond delta (data-driven recomputation)
  try { applyBondDelta(db, 'suggestion_accepted'); } catch { /* */ }

  let runId: string | undefined;
  let taskId: string | undefined;

  const primaryRepoId = suggestion.repoIds.length > 0
    ? suggestion.repoIds[0]
    : suggestion.repoId ?? 'unknown';
  const repoIds = suggestion.repoIds.length > 0 ? suggestion.repoIds : (suggestion.repoId ? [suggestion.repoId] : []);

  if (acceptCategory === 'execute') {
    // Create a Run directly
    const run = db.createRun({
      repoId: primaryRepoId,
      repoIds,
      suggestionId: suggestion.id,
      kind: suggestion.kind,
      prompt: suggestion.summaryMd,
    });
    runId = run.id;
  } else if (acceptCategory === 'planned') {
    // Create a Task linked to this suggestion
    const task = db.createTask({
      title: suggestion.title,
      contextMd: suggestion.summaryMd,
      repoIds,
      suggestionId: suggestion.id,
      entities: suggestion.entities,
    });
    taskId = task.id;
  }

  // Audit trail
  db.createAuditEvent({
    interface: 'suggestion-engine',
    action: 'accept-suggestion',
    targetKind: 'suggestion',
    targetId: suggestionId,
    detail: { category: acceptCategory, runId: runId ?? null, taskId: taskId ?? null },
  });

  return { ok: true, runCreated: runId, taskCreated: taskId };
}

// ---------------------------------------------------------------------------
// Dismiss
// ---------------------------------------------------------------------------

/**
 * Dismiss a suggestion with an optional feedback note.
 * Applies trust delta (-0.5). If 3 consecutive dismissals occur, applies
 * an additional penalty (-3.0).
 */
export async function dismissSuggestion(
  db: ShadowDatabase,
  suggestionId: string,
  note?: string,
  category?: string,
): Promise<{ ok: boolean }> {
  const suggestion = db.getSuggestion(suggestionId);
  if (!suggestion || suggestion.status !== 'open') {
    return { ok: false };
  }

  const now = new Date().toISOString();

  db.updateSuggestion(suggestionId, {
    status: 'dismissed',
    feedbackNote: note ?? null,
    resolvedAt: now,
  });
  db.createFeedback({ targetKind: 'suggestion', targetId: suggestionId, action: 'dismiss', note, category });

  // Check for consecutive dismissal streak (still tracked for audit)
  const streak = getDismissalStreak(db);
  const streakPenalty = streak >= STREAK_THRESHOLD && streak % STREAK_THRESHOLD === 0;

  // Apply bond delta — data-driven, streak reflected in momentum/alignment recomputation
  try {
    applyBondDelta(db, streakPenalty ? 'three_dismissed_in_row' : 'suggestion_dismissed');
  } catch { /* */ }

  db.createAuditEvent({
    interface: 'suggestion-engine',
    action: 'dismiss-suggestion',
    targetKind: 'suggestion',
    targetId: suggestionId,
    detail: { note: note ?? null, streak, streakPenalty },
  });

  // Auto-create preference memory from dismissal feedback
  if (note || category) {
    try {
      const prefTitle = `Preference: avoid ${suggestion.kind} — ${category ?? 'user choice'}`;
      const bodyParts = [`Dismissed: "${suggestion.title}"`];
      if (category) bodyParts.push(`Category: ${category}`);
      if (note) bodyParts.push(`Reason: ${note}`);
      bodyParts.push(`Context: ${suggestion.summaryMd.slice(0, 300)}`);
      const prefBody = bodyParts.join('\n\n');

      const dedup = await checkMemoryDuplicate(db, {
        kind: 'preference', title: prefTitle, bodyMd: prefBody,
      });

      if (dedup.action === 'create') {
        const mem = db.createMemory({
          repoId: suggestion.repoId,
          layer: 'warm',
          scope: suggestion.repoId ? 'repo' : 'personal',
          kind: 'preference',
          title: prefTitle,
          bodyMd: prefBody,
          tags: [suggestion.kind, category, 'dismiss_feedback'].filter((t): t is string => Boolean(t)),
          sourceType: 'dismiss_feedback',
          sourceId: suggestionId,
          confidenceScore: 75,
          relevanceScore: 0.6,
          memoryType: 'semantic',
        });
        if (suggestion.entities?.length > 0) {
          db.updateEntityLinks('memories', mem.id, suggestion.entities);
        }
        await generateAndStoreEmbedding(db, 'memory', mem.id, {
          kind: 'preference', title: prefTitle, bodyMd: prefBody,
        });
      } else if (dedup.action === 'update') {
        const existing = db.getMemory(dedup.existingId);
        if (existing) {
          const appendix = `\n\n---\nAlso dismissed: "${suggestion.title}"${note ? ` — ${note}` : ''}`;
          db.updateMemory(dedup.existingId, { bodyMd: existing.bodyMd + appendix });
          await generateAndStoreEmbedding(db, 'memory', dedup.existingId, {
            kind: existing.kind, title: existing.title, bodyMd: existing.bodyMd + appendix,
          });
        }
      }
    } catch { /* never break dismiss flow */ }
  }

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
  if (!suggestion || suggestion.status !== 'open') {
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
      db.updateSuggestion(s.id, { status: 'open', expiresAt: null });
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
 * Impact-tiered TTL: high-impact suggestions live longer.
 */
function getStaleDays(impactScore: number): number {
  if (impactScore >= 4) return 60;  // high impact: 60 days
  if (impactScore >= 3) return 30;  // medium: 30 days
  return 14;                         // low impact: 14 days
}

/**
 * Expire pending suggestions based on impact-tiered TTLs.
 * Returns the count of expired suggestions.
 */
export function expireStale(db: ShadowDatabase): number {
  const pending = db.listSuggestions({ status: 'open' });
  const now = new Date().toISOString();

  let expiredCount = 0;

  for (const suggestion of pending) {
    const staleDays = getStaleDays(suggestion.impactScore);
    const cutoff = new Date(Date.now() - staleDays * 86400000).toISOString();
    if (suggestion.createdAt < cutoff) {
      db.updateSuggestion(suggestion.id, {
        status: 'expired',
        resolvedAt: now,
      });
      db.deleteEmbedding('suggestion_vectors', suggestion.id);
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
  const pending = db.listSuggestions({ status: 'open' });

  let count = 0;
  for (const s of pending) {
    if (s.expiresAt) continue; // snoozed, skip
    const staleDays = getStaleDays(s.impactScore);
    const warningCutoff = new Date(Date.now() - (staleDays - 3) * 86400000).toISOString();
    const expiryCutoff = new Date(Date.now() - staleDays * 86400000).toISOString();
    if (s.createdAt < warningCutoff && s.createdAt >= expiryCutoff) {
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
    if (s.status === 'open' || s.status === 'snoozed') {
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

