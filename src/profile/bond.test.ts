import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import {
  computeTimeAxis,
  computeBondTier,
  applyBondDelta,
  BOND_TIERS,
  BOND_TIER_NAMES,
  ZERO_AXES,
} from './bond.js';
import type { BondAxes } from '../storage/models.js';
import { ConfigSchema } from '../config/schema.js';
import type { ShadowConfig } from '../config/schema.js';
import { ShadowDatabase } from '../storage/database.js';

function createTestDb(): { db: ShadowDatabase; cleanup: () => void } {
  const dbPath = join(tmpdir(), `shadow-bond-test-${randomUUID()}.db`);
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

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Relative-date helpers (audit T-11): replace hardcoded '2026-XX-YY' anchors
// with offsets from "now" so tests stay valid in any future calendar year.
// ---------------------------------------------------------------------------

const NOW_MS = Date.now();
const RESET_AT_ISO = new Date(NOW_MS - 0).toISOString();  // anchor = "now"
const daysFromReset = (n: number): Date => new Date(NOW_MS + n * DAY_MS);

// ---------------------------------------------------------------------------
// computeTimeAxis
// ---------------------------------------------------------------------------

describe('computeTimeAxis', () => {
  const resetAt = RESET_AT_ISO;

  it('returns 0 at resetAt', () => {
    const result = computeTimeAxis(new Date(resetAt), resetAt);
    assert.equal(result, 0);
  });

  it('returns 0 for future resetAt (clamp)', () => {
    const result = computeTimeAxis(daysFromReset(-30), resetAt);
    assert.equal(result, 0);
  });

  it('returns ~50 at ~91 days elapsed (sqrt curve)', () => {
    const result = computeTimeAxis(daysFromReset(91), resetAt);
    assert.ok(result > 48 && result < 52, `expected ~50, got ${result}`);
  });

  it('caps at 100 at 365 days', () => {
    const result = computeTimeAxis(daysFromReset(365), resetAt);
    assert.equal(Math.round(result), 100);
  });

  it('caps at 100 far beyond 365 days', () => {
    const result = computeTimeAxis(daysFromReset(365 * 4), resetAt);
    assert.equal(result, 100);
  });
});

// ---------------------------------------------------------------------------
// computeBondTier
// ---------------------------------------------------------------------------

describe('computeBondTier', () => {
  const resetAt = RESET_AT_ISO;
  const zero = { ...ZERO_AXES };

  it('stays at tier 1 with no quality and no time', () => {
    const { tier, rose } = computeBondTier(zero, new Date(resetAt), resetAt, 1);
    assert.equal(tier, 1);
    assert.equal(rose, false);
  });

  it('rises to tier 2 after 3 days + quality >= 15', () => {
    const axes: BondAxes = { time: 0, depth: 60, momentum: 0, alignment: 0, autonomy: 0 };
    const { tier, rose } = computeBondTier(axes, daysFromReset(4), resetAt, 1);
    assert.equal(tier, 2);
    assert.equal(rose, true);
  });

  it('blocks on time-only gate (high quality, 0 days)', () => {
    const axes: BondAxes = { time: 0, depth: 100, momentum: 100, alignment: 100, autonomy: 100 };
    const { tier } = computeBondTier(axes, new Date(resetAt), resetAt, 1);
    assert.equal(tier, 1);
  });

  it('blocks on quality-only gate (100 days, quality 0)', () => {
    const { tier } = computeBondTier(zero, daysFromReset(100), resetAt, 1);
    assert.equal(tier, 1);
  });

  it('is monotonic: currentTier=5, computed=3 stays at 5', () => {
    const axes: BondAxes = { time: 0, depth: 40, momentum: 40, alignment: 40, autonomy: 40 };
    // quality avg = 40, meets tier 4 qualityFloor but not 5. currentTier=5 holds.
    const { tier, rose } = computeBondTier(axes, daysFromReset(31), resetAt, 5);
    assert.equal(tier, 5);
    assert.equal(rose, false);
  });

  it('reaches tier 8 with 240+ days and quality >= 86', () => {
    const axes: BondAxes = { time: 90, depth: 90, momentum: 90, alignment: 90, autonomy: 90 };
    const { tier, rose } = computeBondTier(axes, daysFromReset(243), resetAt, 7);
    assert.equal(tier, 8);
    assert.equal(rose, true);
  });
});

// ---------------------------------------------------------------------------
// BOND_TIERS + BOND_TIER_NAMES sanity
// ---------------------------------------------------------------------------

describe('BOND_TIERS', () => {
  it('has exactly 8 tiers numbered 1-8', () => {
    assert.equal(BOND_TIERS.length, 8);
    BOND_TIERS.forEach((t, i) => assert.equal(t.tier, i + 1));
  });

  it('has monotonically increasing minDays and qualityFloor', () => {
    for (let i = 1; i < BOND_TIERS.length; i++) {
      assert.ok(BOND_TIERS[i].minDays > BOND_TIERS[i - 1].minDays);
      assert.ok(BOND_TIERS[i].qualityFloor >= BOND_TIERS[i - 1].qualityFloor);
    }
  });

  it('has all 8 tier names in BOND_TIER_NAMES', () => {
    for (let i = 1; i <= 8; i++) {
      assert.ok(BOND_TIER_NAMES[i], `missing name for tier ${i}`);
      assert.equal(typeof BOND_TIER_NAMES[i], 'string');
    }
    assert.equal(BOND_TIER_NAMES[1], 'observer');
    assert.equal(BOND_TIER_NAMES[5], 'shadow');
    assert.equal(BOND_TIER_NAMES[8], 'kindred');
  });
});

// ---------------------------------------------------------------------------
// applyBondDelta — recompute axes from data, persist, evaluate tier (T-05)
//
// applyBondDelta is data-driven: eventKind is informational. The function
// recomputes axes from DB state (memories, runs, feedback, etc.), persists,
// and re-evaluates tier with monotonicity. Tests cover the persistence +
// evaluation paths; LLM-driven hooks (chronicle lore, unlocks) fire-and-
// forget and are out of scope.
// ---------------------------------------------------------------------------

describe('applyBondDelta', () => {
  let db: ShadowDatabase;
  let cleanup: () => void;
  before(() => { ({ db, cleanup } = createTestDb()); });
  after(() => cleanup());

  it('empty DB → axes are zero, tier stays at 1, no rise', () => {
    db.ensureProfile('default');
    const result = applyBondDelta(db, 'check_in');
    assert.equal(result.tier, 1);
    assert.equal(result.rose, false);
    assert.equal(result.oldTier, 1);
    assert.equal(result.axes.depth, 0);
    assert.equal(result.axes.momentum, 0);
  });

  it('persists recomputed axes back to user_profile', () => {
    db.ensureProfile('default');
    // Seed durable memory so depth axis is non-zero
    db.createMemory({
      layer: 'core', scope: 'global', kind: 'taught',
      title: 'Persisted axes test', bodyMd: 'A persisted teach.', sourceType: 'mcp',
    });

    applyBondDelta(db, 'memory_taught');

    const profile = db.ensureProfile('default');
    assert.ok(profile.bondAxes.depth > 0, 'depth axis should reflect new memory');
  });

  it('depth axis grows with durable memory kinds', () => {
    db.ensureProfile('default');
    const before = applyBondDelta(db, 'check_in').axes.depth;

    for (let i = 0; i < 5; i++) {
      db.createMemory({
        layer: 'core', scope: 'global', kind: 'workflow',
        title: `wf-${i}`, bodyMd: `body-${i}`, sourceType: 'heartbeat',
      });
    }

    const after = applyBondDelta(db, 'memory_taught').axes.depth;
    assert.ok(after > before, `depth should grow: before=${before} after=${after}`);
  });

  it('eventKind is informational — same DB state → same axes regardless of kind', () => {
    db.ensureProfile('default');
    const r1 = applyBondDelta(db, 'check_in');
    const r2 = applyBondDelta(db, 'run_success');
    const r3 = applyBondDelta(db, 'inactivity_day');
    assert.deepEqual(r1.axes, r2.axes);
    assert.deepEqual(r2.axes, r3.axes);
  });

  it('monotonicity: tier never decreases when DB state weakens', () => {
    // Seed a high-tier profile, then call applyBondDelta with no supporting data
    db.ensureProfile('default');
    db.updateProfile('default', { bondTier: 5 });

    const result = applyBondDelta(db, 'inactivity_day');

    assert.equal(result.tier, 5, 'tier should stay at 5 even with low axes');
    assert.equal(result.rose, false);
    assert.equal(result.oldTier, 5);
  });

  it('tier rise: backdate resetAt + seed all axes → tier rises with rose=true', () => {
    // Fresh DB to isolate from prior tests
    const { db: db2, cleanup: cleanup2 } = createTestDb();
    try {
      db2.ensureProfile('default');
      const repo = db2.createRepo({ name: 'tier-rise-repo', path: '/tmp/tier-rise-repo' });
      // Backdate reset to comfortably satisfy tier 2 minDays=3 (and beyond)
      const tenDaysAgo = new Date(Date.now() - 10 * DAY_MS).toISOString();
      db2.updateProfile('default', { bondResetAt: tenDaysAgo, bondTier: 1 });

      // Seed depth via durable memories
      for (let i = 0; i < 30; i++) {
        db2.createMemory({
          layer: 'core', scope: 'global', kind: 'workflow',
          title: `seed-mem-${i}`, bodyMd: `body-${i}`, sourceType: 'heartbeat',
        });
      }
      // Seed momentum via done observations + feedback
      for (let i = 0; i < 30; i++) {
        const obs = db2.createObservation({
          repoId: repo.id, kind: 'improvement', title: `obs-${i}`,
        });
        db2.updateObservationStatus(obs.id, 'done');
      }
      const sug = db2.createSuggestion({
        repoId: repo.id, kind: 'refactor', title: 'tier-rise sug', summaryMd: 'sm',
      });
      // Seed alignment via accept feedback
      for (let i = 0; i < 10; i++) {
        db2.createFeedback({ targetKind: 'suggestion', targetId: sug.id, action: 'accept' });
      }

      const result = applyBondDelta(db2, 'memory_taught');
      assert.ok(result.tier >= 2, `expected tier >= 2, got ${result.tier} (axes=${JSON.stringify(result.axes)})`);
      assert.equal(result.rose, true);
      assert.equal(result.oldTier, 1);

      // Verify persistence: re-read profile, tier should match
      const profile = db2.ensureProfile('default');
      assert.equal(profile.bondTier, result.tier);
    } finally {
      cleanup2();
    }
  });
});
