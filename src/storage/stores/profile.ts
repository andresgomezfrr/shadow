import type { DatabaseSync } from 'node:sqlite';
import type { UserProfileRecord } from '../models.js';
import {
  type SQLValue,
  mapProfile,
  toSnake,
  toSqlValue,
} from '../mappers.js';
import { log } from '../../log.js';

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

// Cached column set for user_profile. Populated on first updateProfile call and
// re-read if it ever misses (rare — only during schema migrations at boot).
// Used by updateProfile to warn on unknown keys instead of silently failing on
// "no such column" or writing to a column the caller didn't mean (audit D-09).
let userProfileColumns: Set<string> | null = null;
function getUserProfileColumns(db: DatabaseSync): Set<string> {
  if (userProfileColumns) return userProfileColumns;
  const rows = db.prepare("PRAGMA table_info(user_profile)").all() as Array<{ name: string }>;
  userProfileColumns = new Set(rows.map((r) => r.name));
  return userProfileColumns;
}

export function updateProfile(db: DatabaseSync, id: string, updates: Record<string, unknown>): void {
  const known = getUserProfileColumns(db);
  const sets: string[] = [];
  const values: SQLValue[] = [];
  const skipped: string[] = [];
  for (const [key, value] of Object.entries(updates)) {
    const col = toSnake(key);
    if (!known.has(col)) {
      // Silent-fail class: caller passed `bondAxes` instead of `bondAxesJson`,
      // or a typo, or a legacy field. Log and skip so downstream UPDATE
      // doesn't blow up with "no such column" and doesn't silently write
      // garbage. Hint about the Json suffix because that's the usual cause.
      skipped.push(`${key}→${col}`);
      continue;
    }
    if (col.endsWith('_json')) {
      sets.push(`${col} = ?`);
      values.push(JSON.stringify(value));
    } else {
      sets.push(`${col} = ?`);
      values.push(toSqlValue(value));
    }
  }
  if (skipped.length > 0) {
    log.error(`[updateProfile] skipped unknown keys: ${skipped.join(', ')}. If writing to a _json column, remember the Json suffix in the TS key (e.g. bondAxesJson, not bondAxes).`);
  }
  if (sets.length === 0) {
    if (Object.keys(updates).length > 0) {
      log.error(`[updateProfile] no valid updates to apply (input had ${Object.keys(updates).length} keys, all unknown)`);
    }
    return;
  }
  sets.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);
  db.prepare(`UPDATE user_profile SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}
