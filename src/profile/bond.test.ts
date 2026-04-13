import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeTimeAxis,
  computeBondTier,
  BOND_TIERS,
  BOND_TIER_NAMES,
  ZERO_AXES,
} from './bond.js';
import type { BondAxes } from '../storage/models.js';

// ---------------------------------------------------------------------------
// computeTimeAxis
// ---------------------------------------------------------------------------

describe('computeTimeAxis', () => {
  const resetAt = '2026-01-01T00:00:00.000Z';

  it('returns 0 at resetAt', () => {
    const result = computeTimeAxis(new Date(resetAt), resetAt);
    assert.equal(result, 0);
  });

  it('returns 0 for future resetAt (clamp)', () => {
    const result = computeTimeAxis(new Date('2025-12-01'), resetAt);
    assert.equal(result, 0);
  });

  it('returns ~50 at ~91 days elapsed (sqrt curve)', () => {
    const later = new Date('2026-04-02T00:00:00.000Z');  // 91 days
    const result = computeTimeAxis(later, resetAt);
    assert.ok(result > 48 && result < 52, `expected ~50, got ${result}`);
  });

  it('caps at 100 at 365 days', () => {
    const later = new Date('2027-01-01T00:00:00.000Z');
    const result = computeTimeAxis(later, resetAt);
    assert.equal(Math.round(result), 100);
  });

  it('caps at 100 far beyond 365 days', () => {
    const later = new Date('2030-01-01T00:00:00.000Z');
    const result = computeTimeAxis(later, resetAt);
    assert.equal(result, 100);
  });
});

// ---------------------------------------------------------------------------
// computeBondTier
// ---------------------------------------------------------------------------

describe('computeBondTier', () => {
  const resetAt = '2026-01-01T00:00:00.000Z';
  const zero = { ...ZERO_AXES };

  it('stays at tier 1 with no quality and no time', () => {
    const { tier, rose } = computeBondTier(zero, new Date(resetAt), resetAt, 1);
    assert.equal(tier, 1);
    assert.equal(rose, false);
  });

  it('rises to tier 2 after 3 days + quality >= 15', () => {
    const axes: BondAxes = { time: 0, depth: 60, momentum: 0, alignment: 0, autonomy: 0 };
    const now = new Date('2026-01-05T00:00:00.000Z');  // 4 days
    const { tier, rose } = computeBondTier(axes, now, resetAt, 1);
    assert.equal(tier, 2);
    assert.equal(rose, true);
  });

  it('blocks on time-only gate (high quality, 0 days)', () => {
    const axes: BondAxes = { time: 0, depth: 100, momentum: 100, alignment: 100, autonomy: 100 };
    const { tier } = computeBondTier(axes, new Date(resetAt), resetAt, 1);
    assert.equal(tier, 1);
  });

  it('blocks on quality-only gate (100 days, quality 0)', () => {
    const now = new Date('2026-04-11T00:00:00.000Z');  // ~100 days
    const { tier } = computeBondTier(zero, now, resetAt, 1);
    assert.equal(tier, 1);
  });

  it('is monotonic: currentTier=5, computed=3 stays at 5', () => {
    const now = new Date('2026-02-01T00:00:00.000Z');  // 31 days, but low quality
    const axes: BondAxes = { time: 0, depth: 40, momentum: 40, alignment: 40, autonomy: 40 };
    // quality avg = 40, meets tier 4 qualityFloor but not 5. currentTier=5 holds.
    const { tier, rose } = computeBondTier(axes, now, resetAt, 5);
    assert.equal(tier, 5);
    assert.equal(rose, false);
  });

  it('reaches tier 8 with 240+ days and quality >= 86', () => {
    const now = new Date('2026-09-01T00:00:00.000Z');  // ~243 days
    const axes: BondAxes = { time: 90, depth: 90, momentum: 90, alignment: 90, autonomy: 90 };
    const { tier, rose } = computeBondTier(axes, now, resetAt, 7);
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
