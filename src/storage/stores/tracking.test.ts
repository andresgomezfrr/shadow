import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { ConfigSchema } from '../../config/schema.js';
import type { ShadowConfig } from '../../config/schema.js';
import { ShadowDatabase } from '../database.js';
import { EVENT_DEDUP_WINDOW_MS } from './tracking.js';

function createTestDb(): { db: ShadowDatabase; cleanup: () => void } {
  const dbPath = join(tmpdir(), `shadow-tracking-test-${randomUUID()}.db`);
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
// EVENT_DEDUP_WINDOW_MS boundary (audit T-06)
//
// createEvent dedups same kind+targetId within a 15min window. Without the
// clock-injection seam tests would race against wall-clock time at the
// boundary. With opts.now we can pin both ends of the window deterministically.
// ---------------------------------------------------------------------------

describe('createEvent dedup window boundary', () => {
  let db: ShadowDatabase;
  let cleanup: () => void;
  const T0 = Date.parse('2026-04-19T12:00:00Z');
  const targetId = 'aa11bb22-cc33-dd44-ee55-ff6677889900';

  before(() => {
    ({ db, cleanup } = createTestDb());
  });
  after(() => cleanup());

  it('second event 1ms before window end → deduped (returns null)', () => {
    const first = db.createEvent(
      { kind: 'observation_notable', payload: { targetId, message: 'a' } },
      { now: T0 },
    );
    assert.ok(first, 'first event should be created');

    const second = db.createEvent(
      { kind: 'observation_notable', payload: { targetId, message: 'b' } },
      { now: T0 + EVENT_DEDUP_WINDOW_MS - 1 },
    );
    assert.equal(second, null, 'second event 1ms inside window should dedup');
  });

  it('second event exactly at window expiration → created', () => {
    const distinctTarget = 'bb22cc33-dd44-ee55-ff66-778899001122';
    const first = db.createEvent(
      { kind: 'suggestion_ready', payload: { targetId: distinctTarget } },
      { now: T0 },
    );
    assert.ok(first);

    const third = db.createEvent(
      { kind: 'suggestion_ready', payload: { targetId: distinctTarget } },
      { now: T0 + EVENT_DEDUP_WINDOW_MS },
    );
    assert.ok(third, 'event at window cutoff should escape dedup');
    assert.notEqual(third!.id, first!.id);
  });

  it('different kinds with same targetId → both created (no cross-kind dedup)', () => {
    const sharedTarget = 'cc33dd44-ee55-ff66-7788-990011223344';
    const a = db.createEvent(
      { kind: 'run_completed', payload: { targetId: sharedTarget } },
      { now: T0 + 100 },
    );
    const b = db.createEvent(
      { kind: 'run_failed', payload: { targetId: sharedTarget } },
      { now: T0 + 200 },
    );
    assert.ok(a);
    assert.ok(b);
    assert.notEqual(a!.id, b!.id);
  });

  it('events without targetId are never deduped', () => {
    const a = db.createEvent({ kind: 'tick', payload: {} }, { now: T0 });
    const b = db.createEvent({ kind: 'tick', payload: {} }, { now: T0 + 1000 });
    assert.ok(a);
    assert.ok(b);
    assert.notEqual(a!.id, b!.id);
  });
});
