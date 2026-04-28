import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeRankScore, rankSuggestions, type RankContext } from './ranking.js';
import type { SuggestionRecord, UserProfileRecord, EntityLink } from '../storage/models.js';

const DAY_MS = 86_400_000;
const NOW = Date.now();

function daysAgo(n: number): string {
  return new Date(NOW - n * DAY_MS).toISOString();
}

function makeSuggestion(overrides: Partial<SuggestionRecord> = {}): SuggestionRecord {
  return {
    id: 'sugg-1',
    repoId: null,
    repoIds: [],
    entities: [],
    sourceObservationId: null,
    kind: 'improvement',
    title: 'Test',
    summaryMd: '',
    reasoningMd: null,
    impactScore: 3,
    confidenceScore: 70,
    riskScore: 1,
    status: 'open',
    feedbackNote: null,
    shownAt: null,
    resolvedAt: null,
    revalidationCount: 0,
    lastRevalidatedAt: null,
    revalidationVerdict: null,
    revalidationNote: null,
    effort: 'small',
    createdAt: daysAgo(0),
    expiresAt: null,
    ...overrides,
  };
}

const profile: UserProfileRecord = {
  id: 'p1',
  displayName: 'test',
  timezone: null,
  locale: 'en',
  workHours: {},
  commitPatterns: {},
  verbosity: 'normal',
  proactiveLevel: 'medium',
  proactivityLevel: 5,
  focusMode: null,
  focusUntil: null,
  energyLevel: null,
  moodHint: null,
  moodPhrase: null,
  bondAxes: { time: 0, depth: 0, momentum: 0, alignment: 0, autonomy: 0 },
  bondTier: 1,
  bondResetAt: daysAgo(0),
  bondTierLastRiseAt: null,
  totalInteractions: 0,
  preferences: {},
  dislikes: [],
  createdAt: daysAgo(0),
  updatedAt: daysAgo(0),
};

const projectEntity: EntityLink = { type: 'project', id: 'proj-quiet' };

describe('computeRankScore — base formula', () => {
  it('returns base = impact*20 + confidence*0.3 minus risk*10 for a fresh suggestion', () => {
    const s = makeSuggestion({ impactScore: 3, confidenceScore: 70, riskScore: 1, createdAt: daysAgo(0) });
    const score = computeRankScore(s, profile);
    // base = 60 + 21 = 81; penalty = 10; decay ≈ 0; momentum = 0 → score ≈ 71
    assert.ok(Math.abs(score - 71) < 0.5, `expected ~71, got ${score}`);
  });

  it('clamps score at 0 (never negative)', () => {
    const s = makeSuggestion({ impactScore: 1, confidenceScore: 0, riskScore: 5, createdAt: daysAgo(365) });
    const score = computeRankScore(s, profile);
    assert.equal(score, 0);
  });
});

describe('computeRankScore — high-impact protection (audit e0321be4)', () => {
  // The exact bug fix: high-impact + quiet project + 60 days old must remain visible.
  it('high-impact (impact=4) at 60 days on a quiet project stays well above zero', () => {
    const s = makeSuggestion({
      impactScore: 4,
      confidenceScore: 80,
      riskScore: 0,
      createdAt: daysAgo(60),
      entities: [projectEntity],
    });
    const ctx: RankContext = { projectMomentum: new Map([['proj-quiet', 0]]) };
    const score = computeRankScore(s, profile, ctx);
    // base = 80 + 24 = 104; penalty = 0; decay = 60 * 0.3 = 18; momentum floor 50 * 0.08 = 4 → ~90
    assert.ok(score > 50, `high-impact should stay visible at 60 days, got ${score}`);
  });

  it('low-impact (impact=3) at 60 days on a quiet project decays to ~0 — by design', () => {
    const s = makeSuggestion({
      impactScore: 3,
      confidenceScore: 70,
      riskScore: 1,
      createdAt: daysAgo(60),
      entities: [projectEntity],
    });
    const ctx: RankContext = { projectMomentum: new Map([['proj-quiet', 0]]) };
    const score = computeRankScore(s, profile, ctx);
    // base = 60 + 21 = 81; penalty = 10; decay = 60 * 1 = 60; momentum = 0 → ~11
    assert.ok(score < 20, `low-impact at 60d should decay heavily, got ${score}`);
  });

  it('high-impact uses momentum floor of 50 even when project momentum is 0', () => {
    const s = makeSuggestion({
      impactScore: 4,
      confidenceScore: 80,
      riskScore: 0,
      createdAt: daysAgo(0),
      entities: [projectEntity],
    });
    const ctxQuiet: RankContext = { projectMomentum: new Map([['proj-quiet', 0]]) };
    const ctxHot: RankContext = { projectMomentum: new Map([['proj-quiet', 100]]) };
    const scoreQuiet = computeRankScore(s, profile, ctxQuiet);
    const scoreHot = computeRankScore(s, profile, ctxHot);
    // Hot momentum (100) gives boost = 8; quiet momentum (0 → floor 50) gives boost = 4
    assert.ok(scoreHot > scoreQuiet, 'hot project should still outrank quiet');
    assert.ok(scoreQuiet >= 100, `high-impact fresh should benefit from momentum floor, got ${scoreQuiet}`);
  });

  it('low-impact does NOT get the momentum floor — quiet project = no boost', () => {
    const s = makeSuggestion({
      impactScore: 3,
      confidenceScore: 70,
      riskScore: 0,
      createdAt: daysAgo(0),
      entities: [projectEntity],
    });
    const ctxQuiet: RankContext = { projectMomentum: new Map([['proj-quiet', 0]]) };
    const scoreNoCtx = computeRankScore(s, profile);
    const scoreQuietCtx = computeRankScore(s, profile, ctxQuiet);
    // Without momentum floor, quiet project (m=0) should match no-context case
    assert.equal(scoreNoCtx, scoreQuietCtx);
  });

  it('high-impact decays at 0.3/day vs low-impact at 1/day', () => {
    const high = makeSuggestion({ impactScore: 4, confidenceScore: 80, riskScore: 0, createdAt: daysAgo(30) });
    const low = makeSuggestion({ impactScore: 3, confidenceScore: 80, riskScore: 0, createdAt: daysAgo(30) });
    const highScore = computeRankScore(high, profile);
    const lowScore = computeRankScore(low, profile);
    // high: base 104, decay 9 → 95
    // low:  base 84,  decay 30 → 54
    // The gap should widen with time (compared to fresh: 104 vs 84 → diff 20; at 30d: ~95 vs ~54 → diff 40)
    assert.ok(highScore - lowScore > 30, `decay rate differential should preserve high-impact priority over time`);
  });
});

describe('computeRankScore — momentum boost', () => {
  it('takes the max boost across multiple project entities', () => {
    const s = makeSuggestion({
      impactScore: 3,
      confidenceScore: 70,
      riskScore: 0,
      createdAt: daysAgo(0),
      entities: [
        { type: 'project', id: 'p1' },
        { type: 'project', id: 'p2' },
      ],
    });
    const ctx: RankContext = {
      projectMomentum: new Map([['p1', 30], ['p2', 100]]),
    };
    const score = computeRankScore(s, profile, ctx);
    // base = 60 + 21 = 81; boost = 100 * 0.08 = 8 → ~89
    assert.ok(score >= 88 && score <= 90, `expected ~89, got ${score}`);
  });

  it('ignores non-project entities for momentum', () => {
    const s = makeSuggestion({
      impactScore: 3,
      confidenceScore: 70,
      riskScore: 0,
      createdAt: daysAgo(0),
      entities: [
        { type: 'repo', id: 'r1' },
        { type: 'system', id: 's1' },
      ],
    });
    const ctx: RankContext = { projectMomentum: new Map([['r1', 100]]) };
    const score = computeRankScore(s, profile, ctx);
    const scoreNoCtx = computeRankScore(s, profile);
    assert.equal(score, scoreNoCtx);
  });
});

describe('computeRankScore — revalidation', () => {
  it('adds +5 per revalidation, capped at +15 (3 revalidations)', () => {
    const base = makeSuggestion({ revalidationCount: 0 });
    const r1 = makeSuggestion({ revalidationCount: 1 });
    const r3 = makeSuggestion({ revalidationCount: 3 });
    const r5 = makeSuggestion({ revalidationCount: 5 });
    const baseScore = computeRankScore(base, profile);
    assert.ok(Math.abs(computeRankScore(r1, profile) - baseScore - 5) < 0.5);
    assert.ok(Math.abs(computeRankScore(r3, profile) - baseScore - 15) < 0.5);
    // Cap holds at 5+ revalidations
    assert.ok(Math.abs(computeRankScore(r5, profile) - baseScore - 15) < 0.5);
  });

  it('adds extra +3 if last revalidation was within 3 days', () => {
    const recent = makeSuggestion({ revalidationCount: 1, lastRevalidatedAt: daysAgo(1) });
    const stale = makeSuggestion({ revalidationCount: 1, lastRevalidatedAt: daysAgo(10) });
    assert.ok(computeRankScore(recent, profile) > computeRankScore(stale, profile));
    assert.ok(Math.abs(computeRankScore(recent, profile) - computeRankScore(stale, profile) - 3) < 0.5);
  });

  it('penalizes -20 when revalidation verdict is "outdated" (overrides count boost)', () => {
    const ok = makeSuggestion({ revalidationCount: 2 });
    const outdated = makeSuggestion({
      revalidationCount: 2,
      revalidationVerdict: 'outdated',
      lastRevalidatedAt: daysAgo(10),
    });
    const okScore = computeRankScore(ok, profile);
    const outdatedScore = computeRankScore(outdated, profile);
    // ok: base + 10, outdated: base - 20 → diff = 30
    assert.ok(Math.abs((okScore - outdatedScore) - 30) < 0.5, `expected ~30 gap, got ${okScore - outdatedScore}`);
  });
});

describe('rankSuggestions — sort order', () => {
  it('sorts descending by computed score', () => {
    const high = makeSuggestion({ id: 'high', impactScore: 5, confidenceScore: 90, riskScore: 0 });
    const mid = makeSuggestion({ id: 'mid', impactScore: 3, confidenceScore: 70, riskScore: 1 });
    const low = makeSuggestion({ id: 'low', impactScore: 1, confidenceScore: 50, riskScore: 3 });
    const sorted = rankSuggestions([low, high, mid], profile);
    assert.deepEqual(sorted.map(s => s.id), ['high', 'mid', 'low']);
  });

  it('does not mutate the input array', () => {
    const a = makeSuggestion({ id: 'a', impactScore: 1 });
    const b = makeSuggestion({ id: 'b', impactScore: 5 });
    const input = [a, b];
    const sorted = rankSuggestions(input, profile);
    assert.deepEqual(input.map(s => s.id), ['a', 'b'], 'input should be untouched');
    assert.deepEqual(sorted.map(s => s.id), ['b', 'a']);
  });

  it('puts a 60-day-old high-impact suggestion ahead of a fresh low-impact one in a quiet project (regression for audit e0321be4)', () => {
    const old = makeSuggestion({
      id: 'old-high',
      impactScore: 5,
      confidenceScore: 80,
      riskScore: 0,
      createdAt: daysAgo(60),
      entities: [projectEntity],
    });
    const fresh = makeSuggestion({
      id: 'fresh-low',
      impactScore: 2,
      confidenceScore: 70,
      riskScore: 1,
      createdAt: daysAgo(0),
      entities: [projectEntity],
    });
    const ctx: RankContext = { projectMomentum: new Map([['proj-quiet', 0]]) };
    const sorted = rankSuggestions([fresh, old], profile, ctx);
    assert.equal(sorted[0].id, 'old-high', 'high-impact must not be buried by decay on quiet projects');
  });
});
