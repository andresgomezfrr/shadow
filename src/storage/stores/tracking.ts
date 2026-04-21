import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type {
  AuditEventRecord,
  EventRecord,
  FeedbackRecord,
  InteractionRecord,
  LlmUsageRecord,
} from '../models.js';
import {
  type SQLValue,
  mapInteraction,
  mapEvent,
  mapFeedback,
  mapAuditEvent,
  mapLlmUsage,
} from '../mappers.js';
import { log } from '../../log.js';

// --- Interactions ---

export function createInteraction(db: DatabaseSync, input: { interface: string; kind: string; inputSummary?: string | null; outputSummary?: string | null; sentiment?: string | null; topics?: string[] }): InteractionRecord {
  const id = randomUUID();
  const now = new Date().toISOString();
  db
    .prepare(
      `INSERT INTO interactions (id, interface, kind, input_summary, output_summary, sentiment, topics_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.interface,
      input.kind,
      input.inputSummary ?? null,
      input.outputSummary ?? null,
      input.sentiment ?? null,
      JSON.stringify(input.topics ?? []),
      now,
    );
  // Increment totalInteractions on profile
  try {
    db.prepare('UPDATE user_profile SET total_interactions = total_interactions + 1').run();
  } catch (e) {
    log.error('[tracking] profile counter update failed:', e instanceof Error ? e.message : e);
  }
  return getInteraction(db, id)!;
}

export function getInteraction(db: DatabaseSync, id: string): InteractionRecord | null {
  const row = db.prepare('SELECT * FROM interactions WHERE id = ?').get(id);
  return row ? mapInteraction(row) : null;
}

export function listRecentInteractions(db: DatabaseSync, limit = 20): InteractionRecord[] {
  return db
    .prepare('SELECT * FROM interactions ORDER BY created_at DESC LIMIT ?')
    .all(limit)
    .map(mapInteraction);
}

// --- Event Queue ---

export const EVENT_DEDUP_WINDOW_MS = 15 * 60 * 1000; // 15min — skip duplicate events within this window

/**
 * @param opts.now — wall-clock override for tests (audit T-06). Production
 * callers omit it and the function uses Date.now(). Tests inject deterministic
 * values to exercise the boundary at exactly 15min cutoff without being
 * subject to scheduling jitter.
 */
export function createEvent(db: DatabaseSync, input: { kind: string; priority?: number; payload?: Record<string, unknown> }, opts?: { now?: number }): EventRecord | null {
  const nowMs = opts?.now ?? Date.now();
  // Dedup: check for recent event with same kind + target within window.
  // targetId is canonical — derived from runId/suggestionId/observationId and
  // persisted in payload.$.targetId so dedup can use a json_extract index
  // instead of a LIKE scan (audit D-04).
  const targetId = (input.payload?.targetId ?? input.payload?.runId ?? input.payload?.suggestionId ?? input.payload?.observationId ?? null) as string | null;
  if (targetId) {
    const cutoff = new Date(nowMs - EVENT_DEDUP_WINDOW_MS).toISOString();
    const existing = db
      .prepare(`SELECT id FROM event_queue WHERE kind = ? AND json_extract(payload_json, '$.targetId') = ? AND created_at > ? LIMIT 1`)
      .get(input.kind, targetId, cutoff) as { id: string } | undefined;
    if (existing) return null;
  }

  const payload = targetId
    ? { ...(input.payload ?? {}), targetId }
    : (input.payload ?? {});
  const id = randomUUID();
  const now = new Date(nowMs).toISOString();
  db
    .prepare(
      'INSERT INTO event_queue (id, kind, priority, payload_json, created_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(id, input.kind, input.priority ?? 5, JSON.stringify(payload), now);
  return getEvent(db, id)!;
}

export function getEvent(db: DatabaseSync, id: string): EventRecord | null {
  const row = db.prepare('SELECT * FROM event_queue WHERE id = ?').get(id);
  return row ? mapEvent(row) : null;
}

export function listPendingEvents(db: DatabaseSync, minPriority?: number): EventRecord[] {
  if (minPriority !== undefined) {
    return db
      .prepare('SELECT * FROM event_queue WHERE delivered = 0 AND priority >= ? ORDER BY priority DESC, created_at')
      .all(minPriority)
      .map(mapEvent);
  }
  return db
    .prepare('SELECT * FROM event_queue WHERE delivered = 0 ORDER BY priority DESC, created_at')
    .all()
    .map(mapEvent);
}

export function deliverEvent(db: DatabaseSync, id: string): void {
  db
    .prepare('UPDATE event_queue SET delivered = 1, delivered_at = ? WHERE id = ?')
    .run(new Date().toISOString(), id);
}

export function deliverAllEvents(db: DatabaseSync): number {
  const now = new Date().toISOString();
  const result = db
    .prepare('UPDATE event_queue SET delivered = 1, delivered_at = ? WHERE delivered = 0')
    .run(now);
  return Number(result.changes);
}

export function listUnreadEvents(db: DatabaseSync, since?: string): EventRecord[] {
  const sinceIso = since ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  return db
    .prepare('SELECT * FROM event_queue WHERE read_at IS NULL AND created_at >= ? ORDER BY priority DESC, created_at DESC')
    .all(sinceIso)
    .map(mapEvent);
}

export function markEventRead(db: DatabaseSync, id: string): void {
  db.prepare('UPDATE event_queue SET read_at = ? WHERE id = ?').run(new Date().toISOString(), id);
}

export function markAllEventsRead(db: DatabaseSync): number {
  const now = new Date().toISOString();
  const result = db.prepare('UPDATE event_queue SET read_at = ? WHERE read_at IS NULL').run(now);
  return Number(result.changes);
}

// --- Feedback ---

export function createFeedback(db: DatabaseSync, input: { targetKind: string; targetId: string; action: string; note?: string | null; category?: string | null }): void {
  const id = randomUUID();
  db
    .prepare('INSERT INTO feedback (id, target_kind, target_id, action, note, category, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, input.targetKind, input.targetId, input.action, input.note ?? null, input.category ?? null, new Date().toISOString());
}

export function listFeedback(db: DatabaseSync, targetKind?: string, limit = 15): FeedbackRecord[] {
  if (targetKind) {
    return db
      .prepare('SELECT * FROM feedback WHERE target_kind = ? ORDER BY created_at DESC LIMIT ?')
      .all(targetKind, limit)
      .map(mapFeedback);
  }
  return db
    .prepare('SELECT * FROM feedback ORDER BY created_at DESC LIMIT ?')
    .all(limit)
    .map(mapFeedback);
}

export function getThumbsState(db: DatabaseSync, targetKind?: string): Record<string, string> {
  const rows = targetKind
    ? db.prepare(`SELECT target_id, action FROM feedback WHERE target_kind = ? AND action IN ('thumbs_up', 'thumbs_down') ORDER BY created_at DESC`).all(targetKind)
    : db.prepare(`SELECT target_id, action FROM feedback WHERE action IN ('thumbs_up', 'thumbs_down') ORDER BY created_at DESC`).all();
  const state: Record<string, string> = {};
  for (const r of rows) {
    const row = r as { target_id: string; action: string };
    if (!state[row.target_id]) state[row.target_id] = row.action;
  }
  return state;
}

export function hasResolveFeedback(db: DatabaseSync, observationId: string): boolean {
  const row = db
    .prepare(`SELECT 1 FROM feedback WHERE target_kind = 'observation' AND target_id = ? AND action = 'resolve' LIMIT 1`)
    .get(observationId);
  return !!row;
}

export function getDismissPatterns(db: DatabaseSync, repoId?: string): Array<{ category: string; count: number; recentNotes: string[] }> {
  const sql = repoId
    ? `SELECT f.category, COUNT(*) as cnt, GROUP_CONCAT(f.note, '|||') as notes
       FROM feedback f JOIN suggestions s ON f.target_id = s.id
       WHERE f.target_kind = 'suggestion' AND f.action = 'dismiss'
         AND f.category IS NOT NULL AND f.created_at > datetime('now', '-30 days')
         AND s.repo_id = ?
       GROUP BY f.category ORDER BY cnt DESC`
    : `SELECT f.category, COUNT(*) as cnt, GROUP_CONCAT(f.note, '|||') as notes
       FROM feedback f
       WHERE f.target_kind = 'suggestion' AND f.action = 'dismiss'
         AND f.category IS NOT NULL AND f.created_at > datetime('now', '-30 days')
       GROUP BY f.category ORDER BY cnt DESC`;
  const rows = repoId
    ? db.prepare(sql).all(repoId)
    : db.prepare(sql).all();
  return rows.map((row: unknown) => {
    const d = row as { category: string; cnt: number; notes: string | null };
    const allNotes = d.notes ? d.notes.split('|||').filter(Boolean) : [];
    return { category: d.category, count: d.cnt, recentNotes: allNotes.slice(0, 3) };
  });
}

export function getAcceptDismissRate(db: DatabaseSync, days = 30): { accepted: number; dismissed: number; total: number; rate: number } {
  const rows = db
    .prepare(`SELECT action, COUNT(*) as cnt FROM feedback
              WHERE target_kind = 'suggestion' AND action IN ('accept', 'dismiss')
                AND created_at > datetime('now', '-' || ? || ' days')
              GROUP BY action`)
    .all(days) as Array<{ action: string; cnt: number }>;
  let accepted = 0;
  let dismissed = 0;
  for (const row of rows) {
    if (row.action === 'accept') accepted = row.cnt;
    else if (row.action === 'dismiss') dismissed = row.cnt;
  }
  const total = accepted + dismissed;
  return { accepted, dismissed, total, rate: total > 0 ? accepted / total : 0 };
}

// --- Audit Events ---

export function createAuditEvent(db: DatabaseSync, input: { actor?: string; interface: string; action: string; targetKind?: string | null; targetId?: string | null; detail?: Record<string, unknown> }): AuditEventRecord {
  const id = randomUUID();
  const now = new Date().toISOString();
  db
    .prepare(
      `INSERT INTO audit_events (id, actor, interface, action, target_kind, target_id, detail_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.actor ?? 'shadow',
      input.interface,
      input.action,
      input.targetKind ?? null,
      input.targetId ?? null,
      JSON.stringify(input.detail ?? {}),
      now,
    );
  return getAuditEvent(db, id)!;
}

export function getAuditEvent(db: DatabaseSync, id: string): AuditEventRecord | null {
  const row = db.prepare('SELECT * FROM audit_events WHERE id = ?').get(id);
  return row ? mapAuditEvent(row) : null;
}

export function listAuditEvents(db: DatabaseSync, limit = 50): AuditEventRecord[] {
  return db
    .prepare('SELECT * FROM audit_events ORDER BY created_at DESC LIMIT ?')
    .all(limit)
    .map(mapAuditEvent);
}

// --- LLM Usage ---

export function recordLlmUsage(db: DatabaseSync, input: { source: string; sourceId?: string | null; model: string; inputTokens: number; outputTokens: number }): LlmUsageRecord {
  const id = randomUUID();
  const now = new Date().toISOString();
  db
    .prepare(
      'INSERT INTO llm_usage (id, source, source_id, model, input_tokens, output_tokens, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(id, input.source, input.sourceId ?? null, input.model, input.inputTokens, input.outputTokens, now);
  return getLlmUsage(db, id)!;
}

export function getLlmUsage(db: DatabaseSync, id: string): LlmUsageRecord | null {
  const row = db.prepare('SELECT * FROM llm_usage WHERE id = ?').get(id);
  return row ? mapLlmUsage(row) : null;
}

/**
 * Rollup raw llm_usage rows older than N days into llm_usage_daily (date/source/model
 * primary key). Idempotent via ON CONFLICT DO UPDATE — running twice won't double-count
 * because this is gated by the subsequent deleteOldLlmUsage in the cleanup handler.
 * Returns number of rollup rows inserted/updated.
 */
export function rollupLlmUsageDaily(db: DatabaseSync, olderThanDays: number): number {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
  const result = db
    .prepare(
      `INSERT INTO llm_usage_daily (date, source, model, input_tokens_sum, output_tokens_sum, calls)
       SELECT substr(created_at, 1, 10) as date, source, model,
              SUM(input_tokens), SUM(output_tokens), COUNT(*)
       FROM llm_usage
       WHERE created_at < ?
       GROUP BY date, source, model
       ON CONFLICT(date, source, model) DO UPDATE SET
         input_tokens_sum = llm_usage_daily.input_tokens_sum + excluded.input_tokens_sum,
         output_tokens_sum = llm_usage_daily.output_tokens_sum + excluded.output_tokens_sum,
         calls = llm_usage_daily.calls + excluded.calls`,
    )
    .run(cutoff);
  return Number(result.changes);
}

export function deleteOldLlmUsage(db: DatabaseSync, olderThanDays: number): number {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
  const result = db.prepare('DELETE FROM llm_usage WHERE created_at < ?').run(cutoff);
  return Number(result.changes);
}

export function deleteOldInteractions(db: DatabaseSync, olderThanDays: number): number {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
  const result = db.prepare('DELETE FROM interactions WHERE created_at < ?').run(cutoff);
  return Number(result.changes);
}

/** Only purge delivered events. Pending (delivered=0) never purged — they signal bugs if stuck. */
export function deleteOldDeliveredEvents(db: DatabaseSync, olderThanDays: number): number {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
  const result = db.prepare('DELETE FROM event_queue WHERE delivered = 1 AND created_at < ?').run(cutoff);
  return Number(result.changes);
}

export function deleteOldJobs(db: DatabaseSync, olderThanDays: number): number {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
  const result = db.prepare('DELETE FROM jobs WHERE created_at < ?').run(cutoff);
  return Number(result.changes);
}

export function getUsageSummary(db: DatabaseSync, period: 'day' | 'week' | 'month' = 'day'): { totalInputTokens: number; totalOutputTokens: number; totalCalls: number; byModel: Record<string, { input: number; output: number; calls: number }> } {
  const daysBack = period === 'day' ? 1 : period === 'week' ? 7 : 30;
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();

  const rows = db
    .prepare(
      'SELECT model, SUM(input_tokens) as input_sum, SUM(output_tokens) as output_sum, COUNT(*) as call_count FROM llm_usage WHERE created_at > ? GROUP BY model',
    )
    .all(since) as { model: string; input_sum: number; output_sum: number; call_count: number }[];

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCalls = 0;
  const byModel: Record<string, { input: number; output: number; calls: number }> = {};

  for (const row of rows) {
    const input = Number(row.input_sum);
    const output = Number(row.output_sum);
    const calls = Number(row.call_count);
    totalInputTokens += input;
    totalOutputTokens += output;
    totalCalls += calls;
    byModel[row.model] = { input, output, calls };
  }

  return { totalInputTokens, totalOutputTokens, totalCalls, byModel };
}
