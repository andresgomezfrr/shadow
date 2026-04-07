import type { DatabaseSync } from 'node:sqlite';
import type { UserProfileRecord } from '../models.js';
import {
  type SQLValue,
  mapProfile,
  toSnake,
  toSqlValue,
} from '../mappers.js';

export function getProfile(db: DatabaseSync, id = 'default'): UserProfileRecord | null {
  const row = db.prepare('SELECT * FROM user_profile WHERE id = ?').get(id);
  return row ? mapProfile(row) : null;
}

export function ensureProfile(db: DatabaseSync, id = 'default'): UserProfileRecord {
  const existing = getProfile(db, id);
  if (existing) return existing;
  const now = new Date().toISOString();
  db
    .prepare('INSERT INTO user_profile (id, created_at, updated_at) VALUES (?, ?, ?)')
    .run(id, now, now);
  return getProfile(db, id)!;
}

export function updateProfile(db: DatabaseSync, id: string, updates: Record<string, unknown>): void {
  const sets: string[] = [];
  const values: SQLValue[] = [];
  for (const [key, value] of Object.entries(updates)) {
    const col = toSnake(key);
    if (col.endsWith('_json')) {
      sets.push(`${col} = ?`);
      values.push(JSON.stringify(value));
    } else {
      sets.push(`${col} = ?`);
      values.push(toSqlValue(value));
    }
  }
  if (sets.length === 0) return;
  sets.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);
  db.prepare(`UPDATE user_profile SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}
