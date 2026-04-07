import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type { DigestRecord, EnrichmentCacheRecord } from '../models.js';
import {
  type SQLValue,
  mapDigest,
  mapEnrichment,
  toSqlValue,
} from '../mappers.js';

// --- Enrichment Cache ---

export function upsertEnrichment(db: DatabaseSync, input: { source: string; entityType?: string; entityId?: string; entityName?: string; summary: string; detail?: Record<string, unknown>; contentHash: string; expiresAt?: string }): EnrichmentCacheRecord {
  const existing = db.prepare('SELECT id FROM enrichment_cache WHERE content_hash = ?').get(input.contentHash) as { id: string } | undefined;
  if (existing) {
    db.prepare('UPDATE enrichment_cache SET summary = ?, detail_json = ?, stale = 0, updated_at = ? WHERE id = ?').run(
      input.summary, JSON.stringify(input.detail ?? {}), new Date().toISOString(), existing.id,
    );
    return getEnrichment(db, existing.id)!;
  }
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO enrichment_cache (id, source, entity_type, entity_id, entity_name, summary, detail_json, content_hash, reported, stale, created_at, updated_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)`,
  ).run(id, input.source, input.entityType ?? null, input.entityId ?? null, input.entityName ?? null, input.summary, JSON.stringify(input.detail ?? {}), input.contentHash, now, now, input.expiresAt ?? null);
  return getEnrichment(db, id)!;
}

export function getEnrichment(db: DatabaseSync, id: string): EnrichmentCacheRecord | null {
  const row = db.prepare('SELECT * FROM enrichment_cache WHERE id = ?').get(id);
  return row ? mapEnrichment(row) : null;
}

export function listNewEnrichment(db: DatabaseSync, limit = 20): EnrichmentCacheRecord[] {
  return db.prepare('SELECT * FROM enrichment_cache WHERE reported = 0 AND stale = 0 ORDER BY created_at DESC LIMIT ?').all(limit).map(mapEnrichment);
}

export function listEnrichment(db: DatabaseSync, filters?: { source?: string; reported?: boolean; limit?: number; offset?: number }): EnrichmentCacheRecord[] {
  const clauses: string[] = ['stale = 0'];
  const values: SQLValue[] = [];
  if (filters?.source) { clauses.push('source = ?'); values.push(filters.source); }
  if (filters?.reported !== undefined) { clauses.push('reported = ?'); values.push(filters.reported ? 1 : 0); }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = filters?.limit ?? 50;
  const offset = filters?.offset ?? 0;
  values.push(limit, offset);
  return db.prepare(`SELECT * FROM enrichment_cache ${where} ORDER BY created_at DESC, id ASC LIMIT ? OFFSET ?`).all(...values).map(mapEnrichment);
}

export function countEnrichment(db: DatabaseSync, filters?: { source?: string; reported?: boolean }): number {
  const clauses: string[] = ['stale = 0'];
  const values: SQLValue[] = [];
  if (filters?.source) { clauses.push('source = ?'); values.push(filters.source); }
  if (filters?.reported !== undefined) { clauses.push('reported = ?'); values.push(filters.reported ? 1 : 0); }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const row = db.prepare(`SELECT COUNT(*) as cnt FROM enrichment_cache ${where}`).get(...values) as { cnt: number };
  return Number(row.cnt);
}

export function markEnrichmentReported(db: DatabaseSync, id: string): void {
  db.prepare('UPDATE enrichment_cache SET reported = 1, updated_at = ? WHERE id = ?').run(new Date().toISOString(), id);
}

export function expireStaleEnrichment(db: DatabaseSync): number {
  const now = new Date().toISOString();
  const result = db.prepare('UPDATE enrichment_cache SET stale = 1, updated_at = ? WHERE stale = 0 AND expires_at IS NOT NULL AND expires_at < ?').run(now, now);
  return Number(result.changes);
}

// --- Digests ---

export function createDigest(db: DatabaseSync, input: { kind: string; periodStart: string; periodEnd: string; contentMd: string; model: string; tokensUsed?: number }): DigestRecord {
  const id = randomUUID();
  const now = new Date().toISOString();
  db
    .prepare(
      `INSERT INTO digests (id, kind, period_start, period_end, content_md, model, tokens_used, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, input.kind, input.periodStart, input.periodEnd, input.contentMd, input.model, input.tokensUsed ?? 0, now, now);
  return getDigest(db, id)!;
}

export function getDigest(db: DatabaseSync, id: string): DigestRecord | null {
  const row = db.prepare('SELECT * FROM digests WHERE id = ?').get(id);
  return row ? mapDigest(row) : null;
}

export function listDigests(db: DatabaseSync, filters?: { kind?: string; limit?: number; before?: string; after?: string }): DigestRecord[] {
  const clauses: string[] = [];
  const values: SQLValue[] = [];
  if (filters?.kind) { clauses.push('kind = ?'); values.push(filters.kind); }
  if (filters?.before) { clauses.push('period_start < ?'); values.push(filters.before); }
  if (filters?.after) { clauses.push('period_start > ?'); values.push(filters.after); }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = filters?.limit ?? 20;
  const order = filters?.after ? 'ASC' : 'DESC';
  return db
    .prepare(`SELECT * FROM digests ${where} ORDER BY period_start ${order} LIMIT ?`)
    .all(...values, limit)
    .map(mapDigest);
}

export function getLatestDigest(db: DatabaseSync, kind: string): DigestRecord | null {
  const row = db.prepare('SELECT * FROM digests WHERE kind = ? ORDER BY period_start DESC LIMIT 1').get(kind);
  return row ? mapDigest(row) : null;
}

export function updateDigest(db: DatabaseSync, id: string, updates: { contentMd?: string; tokensUsed?: number }): void {
  const sets: string[] = ['updated_at = ?'];
  const values: SQLValue[] = [new Date().toISOString()];
  if (updates.contentMd !== undefined) { sets.push('content_md = ?'); values.push(updates.contentMd); }
  if (updates.tokensUsed !== undefined) { sets.push('tokens_used = ?'); values.push(updates.tokensUsed); }
  values.push(id);
  db.prepare(`UPDATE digests SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}
