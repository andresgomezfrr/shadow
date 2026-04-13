import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type {
  BondDailyCacheRecord,
  ChronicleEntryRecord,
  UnlockableRecord,
} from '../models.js';
import {
  mapBondDailyCache,
  mapChronicleEntry,
  mapUnlockable,
} from '../mappers.js';

// --- Chronicle entries ---

export function createChronicleEntry(
  db: DatabaseSync,
  input: {
    kind: 'tier_lore' | 'milestone';
    tier: number | null;
    milestoneKey: string | null;
    title: string;
    bodyMd: string;
    model: string;
  },
): ChronicleEntryRecord {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO chronicle_entries (id, kind, tier, milestone_key, title, body_md, model, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.kind, input.tier, input.milestoneKey, input.title, input.bodyMd, input.model, now);
  return getChronicleEntry(db, id)!;
}

export function getChronicleEntry(db: DatabaseSync, id: string): ChronicleEntryRecord | null {
  const row = db.prepare('SELECT * FROM chronicle_entries WHERE id = ?').get(id);
  return row ? mapChronicleEntry(row) : null;
}

export function getChronicleEntryByTier(db: DatabaseSync, tier: number): ChronicleEntryRecord | null {
  const row = db
    .prepare(`SELECT * FROM chronicle_entries WHERE kind = 'tier_lore' AND tier = ? LIMIT 1`)
    .get(tier);
  return row ? mapChronicleEntry(row) : null;
}

export function getChronicleEntryByMilestone(
  db: DatabaseSync,
  key: string,
): ChronicleEntryRecord | null {
  const row = db
    .prepare(`SELECT * FROM chronicle_entries WHERE kind = 'milestone' AND milestone_key = ? LIMIT 1`)
    .get(key);
  return row ? mapChronicleEntry(row) : null;
}

export function listChronicleEntries(
  db: DatabaseSync,
  opts?: { maxTier?: number },
): ChronicleEntryRecord[] {
  if (opts?.maxTier !== undefined) {
    // Include all milestones + tier_lore where tier <= maxTier
    return db
      .prepare(
        `SELECT * FROM chronicle_entries
         WHERE (kind = 'milestone') OR (kind = 'tier_lore' AND tier <= ?)
         ORDER BY created_at DESC`,
      )
      .all(opts.maxTier)
      .map(mapChronicleEntry);
  }
  return db
    .prepare('SELECT * FROM chronicle_entries ORDER BY created_at DESC')
    .all()
    .map(mapChronicleEntry);
}

// --- Unlockables ---

export function listUnlockables(db: DatabaseSync): UnlockableRecord[] {
  return db
    .prepare('SELECT * FROM unlockables ORDER BY tier_required ASC')
    .all()
    .map(mapUnlockable);
}

export function listUnlockedUnlockables(db: DatabaseSync): UnlockableRecord[] {
  return db
    .prepare('SELECT * FROM unlockables WHERE unlocked = 1 ORDER BY unlocked_at DESC')
    .all()
    .map(mapUnlockable);
}

export function getLockedUnlockablesUpToTier(
  db: DatabaseSync,
  tier: number,
): UnlockableRecord[] {
  return db
    .prepare('SELECT * FROM unlockables WHERE unlocked = 0 AND tier_required <= ? ORDER BY tier_required ASC')
    .all(tier)
    .map(mapUnlockable);
}

export function markUnlockableUnlocked(db: DatabaseSync, id: string): void {
  const now = new Date().toISOString();
  db.prepare('UPDATE unlockables SET unlocked = 1, unlocked_at = ? WHERE id = ?').run(now, id);
}

// --- Bond daily cache ---

export function getBondDailyCache(
  db: DatabaseSync,
  key: string,
): BondDailyCacheRecord | null {
  const row = db
    .prepare('SELECT * FROM bond_daily_cache WHERE cache_key = ? AND expires_at > ?')
    .get(key, new Date().toISOString());
  return row ? mapBondDailyCache(row) : null;
}

export function setBondDailyCache(
  db: DatabaseSync,
  key: string,
  bodyMd: string,
  model: string,
  ttlMs: number,
): void {
  const now = Date.now();
  const generatedAt = new Date(now).toISOString();
  const expiresAt = new Date(now + ttlMs).toISOString();
  db.prepare(
    `INSERT INTO bond_daily_cache (cache_key, body_md, model, generated_at, expires_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(cache_key) DO UPDATE SET
       body_md = excluded.body_md,
       model = excluded.model,
       generated_at = excluded.generated_at,
       expires_at = excluded.expires_at`,
  ).run(key, bodyMd, model, generatedAt, expiresAt);
}

export function invalidateBondDailyCache(db: DatabaseSync, key: string): void {
  db.prepare('DELETE FROM bond_daily_cache WHERE cache_key = ?').run(key);
}
