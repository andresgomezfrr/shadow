import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type {
  EntityLink,
  MemoryRecord,
  MemorySearchResult,
  ObservationRecord,
  SuggestionRecord,
} from '../models.js';
import {
  type SQLValue,
  mapMemory,
  mapObservation,
  mapSuggestion,
  mergeContext,
  jsonParse,
  toSnake,
  toSqlValue,
} from '../mappers.js';
import { sanitizeFtsQuery } from '../../memory/search.js';

// --- Memories ---

export function createMemory(db: DatabaseSync, input: { repoId?: string | null; contactId?: string | null; systemId?: string | null; layer: string; scope: string; kind: string; title: string; bodyMd: string; tags?: string[]; sourceType: string; sourceId?: string | null; confidenceScore?: number; relevanceScore?: number; memoryType?: 'episodic' | 'semantic'; validFrom?: string | null; validUntil?: string | null; sourceMemoryIds?: string[] }): MemoryRecord {
  const id = randomUUID();
  const now = new Date().toISOString();
  db
    .prepare(
      `INSERT INTO memories (id, repo_id, contact_id, system_id, layer, scope, kind, title, body_md, tags_json,
       source_type, source_id, confidence_score, relevance_score, memory_type, valid_from, valid_until, source_memory_ids_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.repoId ?? null,
      input.contactId ?? null,
      input.systemId ?? null,
      input.layer,
      input.scope,
      input.kind,
      input.title,
      input.bodyMd,
      JSON.stringify(input.tags ?? []),
      input.sourceType,
      input.sourceId ?? null,
      input.confidenceScore ?? 70,
      input.relevanceScore ?? 0.5,
      input.memoryType ?? 'unclassified',
      input.validFrom ?? null,
      input.validUntil ?? null,
      JSON.stringify(input.sourceMemoryIds ?? []),
      now,
      now,
    );
  return getMemory(db, id)!;
}

export function getMemory(db: DatabaseSync, id: string): MemoryRecord | null {
  const row = db.prepare('SELECT * FROM memories WHERE id = ?').get(id);
  return row ? mapMemory(row) : null;
}

export function listMemories(db: DatabaseSync, filters?: { layer?: string; layers?: string[]; scope?: string; repoId?: string; memoryType?: string; kind?: string; archived?: boolean; createdSince?: string; entityType?: string; entityId?: string; limit?: number; offset?: number }): MemoryRecord[] {
  const clauses: string[] = [];
  const values: SQLValue[] = [];
  let join = '';

  if (filters?.layer) {
    clauses.push('m.layer = ?');
    values.push(filters.layer);
  }
  if (filters?.layers?.length) {
    const ph = filters.layers.map(() => '?').join(',');
    clauses.push(`m.layer IN (${ph})`);
    values.push(...filters.layers);
  }
  if (filters?.scope) {
    clauses.push('m.scope = ?');
    values.push(filters.scope);
  }
  if (filters?.repoId) {
    clauses.push('m.repo_id = ?');
    values.push(filters.repoId);
  }
  if (filters?.memoryType) {
    clauses.push('m.memory_type = ?');
    values.push(filters.memoryType);
  }
  if (filters?.kind) {
    clauses.push('m.kind = ?');
    values.push(filters.kind);
  }
  if (filters?.archived === false) {
    clauses.push('m.archived_at IS NULL');
  } else if (filters?.archived === true) {
    clauses.push('m.archived_at IS NOT NULL');
  }
  if (filters?.createdSince) {
    clauses.push('m.created_at > ?');
    values.push(filters.createdSince);
  }
  if (filters?.entityType && filters?.entityId) {
    join = "JOIN entity_links el ON el.source_table = 'memories' AND el.source_id = m.id";
    clauses.push('el.entity_type = ? AND el.entity_id = ?');
    values.push(filters.entityType, filters.entityId);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const pagination = `${filters?.limit != null ? ` LIMIT ${Number(filters.limit)}` : ''}${filters?.offset != null ? ` OFFSET ${Number(filters.offset)}` : ''}`;
  return db
    .prepare(`SELECT m.* FROM memories m ${join} ${where} ORDER BY m.created_at DESC, m.id ASC${pagination}`)
    .all(...values)
    .map(mapMemory);
}

export function countMemories(db: DatabaseSync, filters?: { layer?: string; memoryType?: string; kind?: string; archived?: boolean; createdSince?: string; entityType?: string; entityId?: string }): number {
  const clauses: string[] = [];
  const values: SQLValue[] = [];
  let join = '';
  if (filters?.layer) { clauses.push('m.layer = ?'); values.push(filters.layer); }
  if (filters?.memoryType) { clauses.push('m.memory_type = ?'); values.push(filters.memoryType); }
  if (filters?.kind) { clauses.push('m.kind = ?'); values.push(filters.kind); }
  if (filters?.archived === false) { clauses.push('m.archived_at IS NULL'); }
  else if (filters?.archived === true) { clauses.push('m.archived_at IS NOT NULL'); }
  if (filters?.createdSince) { clauses.push('m.created_at > ?'); values.push(filters.createdSince); }
  if (filters?.entityType && filters?.entityId) {
    join = "JOIN entity_links el ON el.source_table = 'memories' AND el.source_id = m.id";
    clauses.push('el.entity_type = ? AND el.entity_id = ?');
    values.push(filters.entityType, filters.entityId);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  return (db.prepare(`SELECT COUNT(*) as total FROM memories m ${join} ${where}`).get(...values) as { total: number }).total;
}

export function searchMemories(db: DatabaseSync, query: string, options?: { layer?: string; scope?: string; repoId?: string; limit?: number }): MemorySearchResult[] {
  const limit = options?.limit ?? 10;

  const sanitized = sanitizeFtsQuery(query);
  if (!sanitized) return [];

  // Step 1: Get rowids from FTS5 with ranking
  let ftsRows: { rowid: number; rank: number }[];
  try {
    ftsRows = db
      .prepare('SELECT rowid, bm25(memories_fts) as rank FROM memories_fts WHERE memories_fts MATCH ? ORDER BY rank LIMIT ?')
      .all(sanitized, limit * 2) as { rowid: number; rank: number }[];
  } catch {
    return [];
  }

  if (ftsRows.length === 0) return [];

  // Step 2: Batch-fetch all matching memory records
  const rowids = ftsRows.map(f => f.rowid);
  const ph = rowids.map(() => '?').join(',');
  const allRows = db
    .prepare(`SELECT *, rowid as _rowid FROM memories WHERE rowid IN (${ph})`)
    .all(...rowids);
  const rowMap = new Map(allRows.map(r => [(r as Record<string, unknown>)._rowid as number, r]));

  // Iterate in FTS rank order, apply filters
  const results: MemorySearchResult[] = [];
  for (const ftsRow of ftsRows) {
    if (results.length >= limit) break;
    const row = rowMap.get(ftsRow.rowid);
    if (!row) continue;

    const memory = mapMemory(row);

    if (memory.archivedAt !== null) continue;
    if (options?.layer && memory.layer !== options.layer) continue;
    if (options?.scope && memory.scope !== options.scope) continue;
    if (options?.repoId && memory.repoId !== options.repoId) continue;

    results.push({
      memory,
      rank: ftsRow.rank,
      snippet: memory.bodyMd.slice(0, 120),
    });
  }

  return results;
}

export function updateMemory(db: DatabaseSync, id: string, updates: Partial<Pick<MemoryRecord, 'layer' | 'scope' | 'kind' | 'title' | 'bodyMd' | 'tags' | 'confidenceScore' | 'relevanceScore' | 'accessCount' | 'lastAccessedAt' | 'promotedFrom' | 'demotedTo' | 'archivedAt'>> & { entities?: Array<{ type: string; id: string }> }): void {
  const sets: string[] = [];
  const values: SQLValue[] = [];
  for (const [key, value] of Object.entries(updates)) {
    if (key === 'entities') {
      sets.push('entities_json = ?');
      values.push(JSON.stringify(value));
    } else if (key === 'tags') {
      sets.push('tags_json = ?');
      values.push(JSON.stringify(value));
    } else if (key === 'bodyMd') {
      sets.push('body_md = ?');
      values.push(toSqlValue(value));
    } else {
      sets.push(`${toSnake(key)} = ?`);
      values.push(toSqlValue(value));
    }
  }
  if (sets.length === 0) return;
  sets.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);
  db.prepare(`UPDATE memories SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  if (updates.entities) {
    syncEntityLinks(db, 'memories', id, updates.entities as EntityLink[]);
  }
}

export function touchMemory(db: DatabaseSync, id: string): void {
  const now = new Date().toISOString();
  db
    .prepare('UPDATE memories SET access_count = access_count + 1, last_accessed_at = ?, updated_at = ? WHERE id = ?')
    .run(now, now, id);
}

/** Merge new content into an existing memory's body + tags. Used by semantic dedup. */
export function mergeMemoryBody(db: DatabaseSync, id: string, newBodyMd: string, newTags?: string[]): void {
  const existing = getMemory(db, id);
  if (!existing) return;

  const mergedBody = `${existing.bodyMd}\n\n---\n\n${newBodyMd}`;
  const mergedTags = newTags
    ? [...new Set([...existing.tags, ...newTags])]
    : existing.tags;
  const now = new Date().toISOString();

  db
    .prepare('UPDATE memories SET body_md = ?, tags_json = ?, updated_at = ? WHERE id = ?')
    .run(mergedBody, JSON.stringify(mergedTags), now, id);
}

// --- Observations ---

export function createObservation(db: DatabaseSync, input: { repoId: string; sourceKind?: string; sourceId?: string | null; kind: string; severity?: string; title: string; detail?: Record<string, unknown>; context?: Record<string, unknown> }): ObservationRecord {
  const now = new Date().toISOString();

  // Dedup: look for existing active/acknowledged observation with same key
  const existing = db
    .prepare(
      `SELECT id, votes, context_json FROM observations
       WHERE repo_id = ? AND kind = ? AND title = ? AND status IN ('open', 'acknowledged')
       LIMIT 1`,
    )
    .get(input.repoId, input.kind, input.title) as
    | { id: string; votes: number; context_json: string }
    | undefined;

  if (existing) {
    const oldContext = jsonParse(existing.context_json, {} as Record<string, unknown>);
    const merged = mergeContext(oldContext, input.context ?? {});
    db
      .prepare('UPDATE observations SET votes = votes + 1, last_seen_at = ?, context_json = ? WHERE id = ?')
      .run(now, JSON.stringify(merged), existing.id);
    return getObservation(db, existing.id)!;
  }

  const id = randomUUID();
  db
    .prepare(
      `INSERT INTO observations
       (id, repo_id, source_kind, source_id, kind, severity, title, detail_json, context_json,
        votes, status, first_seen_at, last_seen_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'open', ?, ?, ?)`,
    )
    .run(
      id,
      input.repoId,
      input.sourceKind ?? 'repo',
      input.sourceId ?? input.repoId,
      input.kind,
      input.severity ?? 'info',
      input.title,
      JSON.stringify(input.detail ?? {}),
      JSON.stringify(input.context ?? {}),
      now,
      now,
      now,
    );
  return getObservation(db, id)!;
}

export function getObservation(db: DatabaseSync, id: string): ObservationRecord | null {
  const row = db.prepare('SELECT * FROM observations WHERE id = ?').get(id);
  return row ? mapObservation(row) : null;
}

export function listObservations(db: DatabaseSync, filters?: { repoId?: string; sourceKind?: string; processed?: boolean; status?: string; severity?: string; kind?: string; projectId?: string; entityType?: string; entityId?: string; limit?: number; offset?: number }): ObservationRecord[] {
  const clauses: string[] = [];
  const values: SQLValue[] = [];
  let join = '';

  if (filters?.repoId) {
    clauses.push('o.repo_id = ?');
    values.push(filters.repoId);
  }
  if (filters?.sourceKind) {
    clauses.push('o.source_kind = ?');
    values.push(filters.sourceKind);
  }
  if (filters?.processed !== undefined) {
    clauses.push('o.processed = ?');
    values.push(filters.processed ? 1 : 0);
  }
  if (filters?.status && filters.status !== 'all') {
    clauses.push('o.status = ?');
    values.push(filters.status);
  }
  if (filters?.severity) {
    clauses.push('o.severity = ?');
    values.push(filters.severity);
  }
  if (filters?.kind) {
    clauses.push('o.kind = ?');
    values.push(filters.kind);
  }
  const eType = filters?.entityType ?? (filters?.projectId ? 'project' : undefined);
  const eId = filters?.entityId ?? filters?.projectId;
  if (eType && eId) {
    join = "JOIN entity_links el ON el.source_table = 'observations' AND el.source_id = o.id";
    clauses.push('el.entity_type = ? AND el.entity_id = ?');
    values.push(eType, eId);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const pagination = `${filters?.limit != null ? ` LIMIT ${Number(filters.limit)}` : ''}${filters?.offset != null ? ` OFFSET ${Number(filters.offset)}` : ''}`;
  return db
    .prepare(`SELECT o.* FROM observations o ${join} ${where} ORDER BY o.votes DESC, o.last_seen_at DESC, o.id ASC${pagination}`)
    .all(...values)
    .map(mapObservation);
}

export function countObservations(db: DatabaseSync, filters?: { repoId?: string; status?: string; severity?: string; kind?: string; projectId?: string; entityType?: string; entityId?: string; createdSince?: string }): number {
  const clauses: string[] = [];
  const values: SQLValue[] = [];
  let join = '';
  if (filters?.repoId) { clauses.push('o.repo_id = ?'); values.push(filters.repoId); }
  if (filters?.status && filters.status !== 'all') { clauses.push('o.status = ?'); values.push(filters.status); }
  if (filters?.severity) { clauses.push('o.severity = ?'); values.push(filters.severity); }
  if (filters?.kind) { clauses.push('o.kind = ?'); values.push(filters.kind); }
  if (filters?.createdSince) { clauses.push('o.created_at > ?'); values.push(filters.createdSince); }
  const eType = filters?.entityType ?? (filters?.projectId ? 'project' : undefined);
  const eId = filters?.entityId ?? filters?.projectId;
  if (eType && eId) {
    join = "JOIN entity_links el ON el.source_table = 'observations' AND el.source_id = o.id";
    clauses.push('el.entity_type = ? AND el.entity_id = ?');
    values.push(eType, eId);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  return (db.prepare(`SELECT COUNT(*) as total FROM observations o ${join} ${where}`).get(...values) as { total: number }).total;
}

export function countObservationsSince(db: DatabaseSync, since: string): number {
  const row = db
    .prepare('SELECT COUNT(*) as count FROM observations WHERE created_at > ?')
    .get(since) as { count: number };
  return row.count;
}

export function markObservationProcessed(db: DatabaseSync, id: string, suggestionId?: string): void {
  db
    .prepare('UPDATE observations SET processed = 1, suggestion_id = ? WHERE id = ?')
    .run(suggestionId ?? null, id);
}

export function updateObservationStatus(db: DatabaseSync, id: string, status: string): void {
  db
    .prepare('UPDATE observations SET status = ? WHERE id = ?')
    .run(status, id);
}

export function bumpObservationVotes(db: DatabaseSync, id: string, context?: Record<string, unknown>): void {
  const now = new Date().toISOString();
  if (context) {
    const row = db.prepare('SELECT context_json FROM observations WHERE id = ?').get(id) as { context_json: string } | undefined;
    if (row) {
      const merged = mergeContext(jsonParse(row.context_json, {} as Record<string, unknown>), context);
      db.prepare('UPDATE observations SET votes = votes + 1, last_seen_at = ?, context_json = ? WHERE id = ?').run(now, JSON.stringify(merged), id);
      return;
    }
  }
  db.prepare('UPDATE observations SET votes = votes + 1, last_seen_at = ? WHERE id = ?').run(now, id);
}

export function reopenObservation(db: DatabaseSync, id: string, context?: Record<string, unknown>): void {
  const now = new Date().toISOString();
  if (context) {
    const row = db.prepare('SELECT context_json FROM observations WHERE id = ?').get(id) as { context_json: string } | undefined;
    if (row) {
      const merged = mergeContext(jsonParse(row.context_json, {} as Record<string, unknown>), context);
      db.prepare("UPDATE observations SET status = 'open', votes = votes + 1, last_seen_at = ?, context_json = ? WHERE id = ?").run(now, JSON.stringify(merged), id);
      return;
    }
  }
  db.prepare("UPDATE observations SET status = 'open', votes = votes + 1, last_seen_at = ? WHERE id = ?").run(now, id);
}

/**
 * Single canonical expiration method. Severity-aware TTLs:
 *   active:       info=7d, warning=14d, high=never
 *   acknowledged: info=14d, warning=28d, high=never
 */
export function expireObservationsBySeverity(db: DatabaseSync): number {
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  let expired = 0;

  const runs: { status: string; severity: string; days: number }[] = [
    { status: 'open', severity: 'info', days: 7 },
    { status: 'open', severity: 'warning', days: 14 },
    { status: 'acknowledged', severity: 'info', days: 14 },
    { status: 'acknowledged', severity: 'warning', days: 28 },
  ];

  for (const { status, severity, days } of runs) {
    const cutoff = new Date(now - days * DAY).toISOString();
    // Collect IDs before UPDATE so we can clean up embeddings
    const toExpire = db
      .prepare(`SELECT id FROM observations WHERE status = ? AND severity = ? AND last_seen_at < ?`)
      .all(status, severity, cutoff) as { id: string }[];
    if (toExpire.length === 0) continue;
    const r = db
      .prepare(`UPDATE observations SET status = 'expired' WHERE status = ? AND severity = ? AND last_seen_at < ?`)
      .run(status, severity, cutoff);
    expired += (r as unknown as { changes: number }).changes;
    for (const { id } of toExpire) deleteEmbedding(db, 'observation_vectors', id);
  }

  return expired;
}

/** Enforce max active observations per repo. Protects high-severity from cap. */
export function capObservationsPerRepo(db: DatabaseSync, maxPerRepo = 10): number {
  const repos = db
    .prepare(`SELECT repo_id, COUNT(*) as cnt FROM observations WHERE status = 'open' GROUP BY repo_id HAVING cnt > ?`)
    .all(maxPerRepo) as { repo_id: string; cnt: number }[];

  let resolved = 0;
  for (const { repo_id, cnt } of repos) {
    const excess = cnt - maxPerRepo;
    const toResolve = db
      .prepare(
        `SELECT id FROM observations WHERE status = 'open' AND repo_id = ? AND severity != 'high'
         ORDER BY CASE severity WHEN 'info' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END ASC,
                  votes ASC, last_seen_at ASC
         LIMIT ?`,
      )
      .all(repo_id, excess) as { id: string }[];
    if (toResolve.length > 0) {
      const ids = toResolve.map(r => r.id);
      const ph = ids.map(() => '?').join(',');
      db.prepare(`UPDATE observations SET status = 'done' WHERE id IN (${ph})`).run(...ids);
      for (const id of ids) deleteEmbedding(db, 'observation_vectors', id);
      resolved += ids.length;
    }
  }
  return resolved;
}

export function touchObservationLastSeen(db: DatabaseSync, id: string): void {
  db
    .prepare('UPDATE observations SET last_seen_at = ? WHERE id = ?')
    .run(new Date().toISOString(), id);
}

export function touchObservationsLastSeen(db: DatabaseSync, ids: string[]): void {
  if (ids.length === 0) return;
  const now = new Date().toISOString();
  const ph = ids.map(() => '?').join(',');
  db
    .prepare(`UPDATE observations SET last_seen_at = ? WHERE id IN (${ph})`)
    .run(now, ...ids);
}

// --- Suggestions ---

export function createSuggestion(db: DatabaseSync, input: { repoId?: string | null; repoIds?: string[]; sourceObservationId?: string | null; kind: string; title: string; summaryMd: string; reasoningMd?: string | null; impactScore?: number; confidenceScore?: number; riskScore?: number; requiredTrustLevel?: number; effort?: string }): SuggestionRecord {
  const id = randomUUID();
  const now = new Date().toISOString();
  db
    .prepare(
      `INSERT INTO suggestions (id, repo_id, repo_ids_json, source_observation_id, kind, title, summary_md,
       reasoning_md, impact_score, confidence_score, risk_score, required_trust_level, effort, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.repoId ?? null,
      JSON.stringify(input.repoIds ?? []),
      input.sourceObservationId ?? null,
      input.kind,
      input.title,
      input.summaryMd,
      input.reasoningMd ?? null,
      input.impactScore ?? 3,
      input.confidenceScore ?? 70,
      input.riskScore ?? 2,
      input.requiredTrustLevel ?? 5,
      input.effort ?? 'medium',
      'open',
      now,
    );
  return getSuggestion(db, id)!;
}

export function getSuggestion(db: DatabaseSync, id: string): SuggestionRecord | null {
  const row = db.prepare('SELECT * FROM suggestions WHERE id = ?').get(id);
  return row ? mapSuggestion(row) : null;
}

const SORT_COLUMNS: Record<string, string> = {
  date: 'created_at DESC',
  impact: 'impact_score DESC, created_at DESC',
  confidence: 'confidence_score DESC, created_at DESC',
  risk: 'risk_score DESC, created_at DESC',
};

export function listSuggestions(db: DatabaseSync, filters?: { status?: string; kind?: string; repoId?: string; projectId?: string; entityType?: string; entityId?: string; sortBy?: string; limit?: number; offset?: number }): SuggestionRecord[] {
  const clauses: string[] = [];
  const values: SQLValue[] = [];
  let join = '';

  if (filters?.status) {
    clauses.push('s.status = ?');
    values.push(filters.status);
  }
  if (filters?.kind) {
    clauses.push('s.kind = ?');
    values.push(filters.kind);
  }
  if (filters?.repoId) {
    clauses.push('s.repo_id = ?');
    values.push(filters.repoId);
  }
  const eType = filters?.entityType ?? (filters?.projectId ? 'project' : undefined);
  const eId = filters?.entityId ?? filters?.projectId;
  if (eType && eId) {
    join = "JOIN entity_links el ON el.source_table = 'suggestions' AND el.source_id = s.id";
    clauses.push('el.entity_type = ? AND el.entity_id = ?');
    values.push(eType, eId);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const orderBy = SORT_COLUMNS[filters?.sortBy ?? ''] ?? 'created_at DESC, id ASC';
  const pagination = `${filters?.limit != null ? ` LIMIT ${Number(filters.limit)}` : ''}${filters?.offset != null ? ` OFFSET ${Number(filters.offset)}` : ''}`;
  return db
    .prepare(`SELECT s.* FROM suggestions s ${join} ${where} ORDER BY ${orderBy}${pagination}`)
    .all(...values)
    .map(mapSuggestion);
}

export function countSuggestions(db: DatabaseSync, filters?: { status?: string; kind?: string; repoId?: string; projectId?: string; entityType?: string; entityId?: string; createdSince?: string }): number {
  const clauses: string[] = [];
  const values: SQLValue[] = [];
  let join = '';
  if (filters?.status) { clauses.push('s.status = ?'); values.push(filters.status); }
  if (filters?.kind) { clauses.push('s.kind = ?'); values.push(filters.kind); }
  if (filters?.repoId) { clauses.push('s.repo_id = ?'); values.push(filters.repoId); }
  if (filters?.createdSince) { clauses.push('s.created_at > ?'); values.push(filters.createdSince); }
  const eType = filters?.entityType ?? (filters?.projectId ? 'project' : undefined);
  const eId = filters?.entityId ?? filters?.projectId;
  if (eType && eId) {
    join = "JOIN entity_links el ON el.source_table = 'suggestions' AND el.source_id = s.id";
    clauses.push('el.entity_type = ? AND el.entity_id = ?');
    values.push(eType, eId);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  return (db.prepare(`SELECT COUNT(*) as total FROM suggestions s ${join} ${where}`).get(...values) as { total: number }).total;
}

export function updateSuggestion(db: DatabaseSync, id: string, updates: Partial<Pick<SuggestionRecord, 'status' | 'feedbackNote' | 'shownAt' | 'resolvedAt' | 'expiresAt' | 'title' | 'summaryMd' | 'reasoningMd' | 'impactScore' | 'confidenceScore' | 'riskScore' | 'revalidationCount' | 'lastRevalidatedAt' | 'revalidationVerdict' | 'revalidationNote'>>): void {
  const sets: string[] = [];
  const values: SQLValue[] = [];
  for (const [key, value] of Object.entries(updates)) {
    sets.push(`${toSnake(key)} = ?`);
    values.push(toSqlValue(value));
  }
  if (sets.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE suggestions SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

export function countPendingSuggestions(db: DatabaseSync): number {
  const row = db
    .prepare("SELECT COUNT(*) as count FROM suggestions WHERE status = 'open'")
    .get() as { count: number };
  return row.count;
}

// --- Vector embeddings ---

export function storeEmbedding(db: DatabaseSync, table: 'memory_vectors' | 'observation_vectors' | 'suggestion_vectors' | 'enrichment_vectors', id: string, embedding: Float32Array): void {
  try {
    db.prepare(`INSERT OR REPLACE INTO ${table}(id, embedding) VALUES (?, ?)`).run(id, embedding);
  } catch (e) {
    console.error(`[shadow:db] Failed to store embedding in ${table}:`, e instanceof Error ? e.message : e);
  }
}

export function deleteEmbedding(db: DatabaseSync, table: 'memory_vectors' | 'observation_vectors' | 'suggestion_vectors' | 'enrichment_vectors', id: string): void {
  try {
    db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
  } catch (e) {
    console.error(`[shadow:db] Failed to delete embedding from ${table}:`, e instanceof Error ? e.message : e);
  }
}

/** Remove entity references from entity_links junction + entities_json in memories, observations, suggestions, tasks.
 *  NOTE: Caller must wrap in a transaction — this function does NOT manage its own transaction
 *  because it's called from deleteRepo/deleteProject/etc. which already hold one. */
export function removeEntityReferences(db: DatabaseSync, entityType: string, entityId: string): void {
  // Find affected rows via indexed junction table lookup
  const affected = db
    .prepare('SELECT source_table, source_id FROM entity_links WHERE entity_type = ? AND entity_id = ?')
    .all(entityType, entityId) as { source_table: string; source_id: string }[];

  // Remove from junction table
  db.prepare('DELETE FROM entity_links WHERE entity_type = ? AND entity_id = ?').run(entityType, entityId);

  // Sync entities_json for consistency
  for (const row of affected) {
    const current = db.prepare(`SELECT entities_json FROM ${row.source_table} WHERE id = ?`).get(row.source_id) as { entities_json: string } | undefined;
    if (current) {
      const entities: EntityLink[] = jsonParse(current.entities_json, []);
      const filtered = entities.filter(e => !(e.type === entityType && e.id === entityId));
      db.prepare(`UPDATE ${row.source_table} SET entities_json = ? WHERE id = ?`)
        .run(JSON.stringify(filtered), row.source_id);
    }
  }
}

/** Sync entity_links junction table for a given source row. Caller controls transaction if needed. */
export function syncEntityLinks(db: DatabaseSync, sourceTable: string, sourceId: string, entities: EntityLink[]): void {
  db.prepare('DELETE FROM entity_links WHERE source_table = ? AND source_id = ?').run(sourceTable, sourceId);
  if (entities.length === 0) return;
  const ins = db.prepare('INSERT OR IGNORE INTO entity_links (source_table, source_id, entity_type, entity_id) VALUES (?, ?, ?, ?)');
  for (const e of entities) ins.run(sourceTable, sourceId, e.type, e.id);
}

/** Atomically update entities_json + entity_links junction table. */
export function updateEntityLinks(db: DatabaseSync, sourceTable: string, sourceId: string, entities: EntityLink[]): void {
  db.exec('BEGIN');
  try {
    db.prepare(`UPDATE ${sourceTable} SET entities_json = ? WHERE id = ?`).run(JSON.stringify(entities), sourceId);
    syncEntityLinks(db, sourceTable, sourceId, entities);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
