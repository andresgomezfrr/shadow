import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type { EntityRelationRecord } from '../models.js';
import { type SQLValue, mapRelation } from '../mappers.js';

export function createRelation(db: DatabaseSync, input: {
  sourceType: string; sourceId: string; relation: string;
  targetType: string; targetId: string;
  confidence?: number; sourceOrigin?: string; metadata?: Record<string, unknown>;
}): EntityRelationRecord {
  const now = new Date().toISOString();
  const confidence = input.confidence ?? 0.8;
  const sourceOrigin = input.sourceOrigin ?? 'auto';

  // Upsert: if same pair exists, bump confidence and update timestamp
  const existing = db.prepare(
    'SELECT id, confidence FROM entity_relations WHERE source_type = ? AND source_id = ? AND relation = ? AND target_type = ? AND target_id = ?',
  ).get(input.sourceType, input.sourceId, input.relation, input.targetType, input.targetId) as { id: string; confidence: number } | undefined;

  if (existing) {
    const newConfidence = Math.min(1.0, existing.confidence + 0.05);
    db.prepare('UPDATE entity_relations SET confidence = ?, updated_at = ? WHERE id = ?').run(newConfidence, now, existing.id);
    return getRelation(db, existing.id)!;
  }

  const id = randomUUID();
  db.prepare(
    'INSERT INTO entity_relations (id, source_type, source_id, relation, target_type, target_id, confidence, source_origin, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(id, input.sourceType, input.sourceId, input.relation, input.targetType, input.targetId, confidence, sourceOrigin, JSON.stringify(input.metadata ?? {}), now, now);
  return getRelation(db, id)!;
}

export function getRelation(db: DatabaseSync, id: string): EntityRelationRecord | null {
  const row = db.prepare('SELECT * FROM entity_relations WHERE id = ?').get(id);
  return row ? mapRelation(row) : null;
}

export function listRelations(db: DatabaseSync, filters?: { sourceType?: string; sourceId?: string; targetType?: string; targetId?: string; relation?: string }): EntityRelationRecord[] {
  const conditions: string[] = [];
  const values: SQLValue[] = [];
  if (filters?.sourceType) { conditions.push('source_type = ?'); values.push(filters.sourceType); }
  if (filters?.sourceId) { conditions.push('source_id = ?'); values.push(filters.sourceId); }
  if (filters?.targetType) { conditions.push('target_type = ?'); values.push(filters.targetType); }
  if (filters?.targetId) { conditions.push('target_id = ?'); values.push(filters.targetId); }
  if (filters?.relation) { conditions.push('relation = ?'); values.push(filters.relation); }

  const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT * FROM entity_relations${where} ORDER BY created_at DESC, id ASC`).all(...values);
  return rows.map(mapRelation);
}

export function getRelatedEntities(db: DatabaseSync, type: string, id: string, opts?: { direction?: 'outgoing' | 'incoming' | 'both'; maxDepth?: number }): Array<{ entityType: string; entityId: string; depth: number }> {
  const direction = opts?.direction ?? 'both';
  const maxDepth = opts?.maxDepth ?? 2;

  const results = new Map<string, { entityType: string; entityId: string; depth: number }>();

  if (direction === 'outgoing' || direction === 'both') {
    const rows = db.prepare(`
      WITH RECURSIVE graph(entity_type, entity_id, depth) AS (
        SELECT target_type, target_id, 1 FROM entity_relations WHERE source_type = ? AND source_id = ?
        UNION ALL
        SELECT er.target_type, er.target_id, g.depth + 1
        FROM entity_relations er JOIN graph g ON er.source_type = g.entity_type AND er.source_id = g.entity_id
        WHERE g.depth < ?
      )
      SELECT DISTINCT entity_type, entity_id, MIN(depth) as depth FROM graph GROUP BY entity_type, entity_id
    `).all(type, id, maxDepth) as Array<{ entity_type: string; entity_id: string; depth: number }>;
    for (const row of rows) {
      const key = `${row.entity_type}:${row.entity_id}`;
      if (!results.has(key)) results.set(key, { entityType: row.entity_type, entityId: row.entity_id, depth: row.depth });
    }
  }

  if (direction === 'incoming' || direction === 'both') {
    const rows = db.prepare(`
      WITH RECURSIVE graph(entity_type, entity_id, depth) AS (
        SELECT source_type, source_id, 1 FROM entity_relations WHERE target_type = ? AND target_id = ?
        UNION ALL
        SELECT er.source_type, er.source_id, g.depth + 1
        FROM entity_relations er JOIN graph g ON er.target_type = g.entity_type AND er.target_id = g.entity_id
        WHERE g.depth < ?
      )
      SELECT DISTINCT entity_type, entity_id, MIN(depth) as depth FROM graph GROUP BY entity_type, entity_id
    `).all(type, id, maxDepth) as Array<{ entity_type: string; entity_id: string; depth: number }>;
    for (const row of rows) {
      const key = `${row.entity_type}:${row.entity_id}`;
      if (!results.has(key)) results.set(key, { entityType: row.entity_type, entityId: row.entity_id, depth: row.depth });
    }
  }

  return [...results.values()];
}

export function deleteRelation(db: DatabaseSync, id: string): void {
  db.prepare('DELETE FROM entity_relations WHERE id = ?').run(id);
}

export function deleteRelationsFor(db: DatabaseSync, type: string, id: string): void {
  db.prepare('DELETE FROM entity_relations WHERE (source_type = ? AND source_id = ?) OR (target_type = ? AND target_id = ?)').run(type, id, type, id);
}
