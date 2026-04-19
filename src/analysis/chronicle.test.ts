import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { ConfigSchema } from '../config/schema.js';
import type { ShadowConfig } from '../config/schema.js';
import { ShadowDatabase } from '../storage/database.js';
import { triggerChronicleMilestone, getVoiceOfShadow, getNextStepHint } from './chronicle.js';

function createTestDb(): { db: ShadowDatabase; cleanup: () => void } {
  const dbPath = join(tmpdir(), `shadow-chronicle-test-${randomUUID()}.db`);
  const parsed = ConfigSchema.parse({});
  const config: ShadowConfig = {
    ...parsed,
    resolvedDataDir: tmpdir(),
    resolvedDatabasePath: dbPath,
    resolvedArtifactsDir: join(tmpdir(), 'artifacts'),
  };
  const db = new ShadowDatabase(config);
  return {
    db,
    cleanup: () => {
      db.close();
      try { unlinkSync(dbPath); } catch {}
      try { unlinkSync(dbPath + '-wal'); } catch {}
      try { unlinkSync(dbPath + '-shm'); } catch {}
    },
  };
}

// ---------------------------------------------------------------------------
// triggerChronicleMilestone idempotency (audit T-04)
//
// The function short-circuits when a milestone with the same key already
// exists — never invokes the LLM. Tests cover the deterministic path; the
// LLM-call path requires a mock adapter and is out of scope.
// ---------------------------------------------------------------------------

describe('triggerChronicleMilestone idempotency', () => {
  let db: ShadowDatabase;
  let cleanup: () => void;
  before(() => { ({ db, cleanup } = createTestDb()); });
  after(() => cleanup());

  it('returns existing entry id when milestone already recorded (no LLM call)', async () => {
    const existing = db.createChronicleEntry({
      kind: 'milestone',
      tier: null,
      milestoneKey: 'first_correction',
      title: 'First correction',
      bodyMd: 'pre-existing body',
      model: 'opus',
    });

    const result = await triggerChronicleMilestone(db, 'first_correction', {
      title: 'ignored — short-circuited',
      data: {},
    });

    assert.equal(result.ok, true);
    assert.equal(result.entryId, existing.id);
  });

  it('UNIQUE(milestone_key) for kind=milestone: second insert with same key throws', () => {
    db.createChronicleEntry({
      kind: 'milestone',
      tier: null,
      milestoneKey: 'unique_key_test',
      title: 'first',
      bodyMd: 'a',
      model: 'opus',
    });

    assert.throws(
      () => db.createChronicleEntry({
        kind: 'milestone',
        tier: null,
        milestoneKey: 'unique_key_test',
        title: 'second',
        bodyMd: 'b',
        model: 'opus',
      }),
      /UNIQUE/,
    );
  });

  it('getChronicleEntryByMilestone returns null when key does not exist', () => {
    const found = db.getChronicleEntryByMilestone('definitely_does_not_exist');
    assert.equal(found, null);
  });
});

// ---------------------------------------------------------------------------
// bond_daily_cache TTL behavior (audit T-04)
//
// Both getVoiceOfShadow and getNextStepHint short-circuit on a fresh cache
// hit, so we can exercise the cache path without invoking the LLM by
// pre-seeding bond_daily_cache directly.
// ---------------------------------------------------------------------------

describe('bond_daily_cache TTL', () => {
  let db: ShadowDatabase;
  let cleanup: () => void;
  before(() => { ({ db, cleanup } = createTestDb()); });
  after(() => cleanup());

  it('fresh cache returns body within TTL', () => {
    db.setBondDailyCache('voice_of_shadow', 'cached voice', 'haiku', 60_000);
    const cached = db.getBondDailyCache('voice_of_shadow');
    assert.ok(cached);
    assert.equal(cached.bodyMd, 'cached voice');
    assert.equal(cached.model, 'haiku');
  });

  it('expired cache returns null (TTL elapsed)', () => {
    db.setBondDailyCache('expired_key', 'old body', 'haiku', 60_000);
    // Force-expire by overwriting expires_at to a past timestamp
    const past = new Date(Date.now() - 1_000_000).toISOString();
    db.rawDb.prepare('UPDATE bond_daily_cache SET expires_at = ? WHERE cache_key = ?')
      .run(past, 'expired_key');
    const cached = db.getBondDailyCache('expired_key');
    assert.equal(cached, null);
  });

  it('setBondDailyCache upsert: same key overwrites body and TTL', () => {
    db.setBondDailyCache('upsert_key', 'first body', 'haiku', 60_000);
    db.setBondDailyCache('upsert_key', 'second body', 'sonnet', 120_000);
    const cached = db.getBondDailyCache('upsert_key');
    assert.ok(cached);
    assert.equal(cached.bodyMd, 'second body');
    assert.equal(cached.model, 'sonnet');
  });

  it('getVoiceOfShadow uses cached body when fresh (no LLM call)', async () => {
    db.setBondDailyCache('voice_of_shadow', 'pre-seeded daily voice', 'haiku', 60_000);
    const result = await getVoiceOfShadow(db);
    assert.equal(result.body, 'pre-seeded daily voice');
  });

  it('getNextStepHint returns empty body at tier 8 (no LLM call, no cache check)', async () => {
    db.ensureProfile('default');
    db.updateProfile('default', { bondTier: 8 });
    const result = await getNextStepHint(db);
    assert.equal(result.body, '');
  });
});
