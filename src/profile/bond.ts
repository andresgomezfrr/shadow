import { DatabaseSync } from 'node:sqlite';
import type { ShadowDatabase } from '../storage/database.js';
import type { BondAxes } from '../storage/models.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MS_PER_DAY = 86_400_000;
const MS_PER_YEAR = 365 * MS_PER_DAY;
const MOMENTUM_WINDOW_MS = 28 * MS_PER_DAY;  // 21d active + 7d grace

export const ZERO_AXES: BondAxes = {
  time: 0,
  depth: 0,
  momentum: 0,
  alignment: 0,
  autonomy: 0,
};

// ---------------------------------------------------------------------------
// Axis computation — all pure, no side effects
// ---------------------------------------------------------------------------

/** Time axis: sqrt curve over 1 year. 0d=0, 91d≈50, 365d=100 */
export function computeTimeAxis(now: Date, resetAt: string): number {
  const elapsed = now.getTime() - new Date(resetAt).getTime();
  if (elapsed <= 0) return 0;
  return Math.min(100, Math.sqrt(elapsed / MS_PER_YEAR) * 100);
}

/**
 * Whitelist of memory kinds that count toward the depth axis.
 *
 * Original set (4 kinds) was too narrow — every heartbeat/consolidate memory
 * used a kind like 'convention', 'workflow', 'tech_stack' that was legitimate
 * durable knowledge but invisible to the axis. A user with 300+ memories
 * could stay at depth ≈ 2 forever. See audit A-03.
 *
 * Kinds are grouped:
 *   - taught / correction / knowledge_summary / soul_reflection: explicit
 *     teaching or reflection signals (unchanged).
 *   - convention / preference / infrastructure / workflow / tech_stack /
 *     design_decision / architecture: durable knowledge about the user's
 *     environment, stack, and decision trail.
 *   - pattern / insight / meta_pattern: emergent observations synthesized by
 *     analysis jobs.
 *
 * Explicitly NOT included: ephemeral/transient kinds like 'thought',
 * 'activity', or anything generated as passing session context.
 */
export const DEPTH_ELIGIBLE_KINDS = [
  'taught', 'correction', 'knowledge_summary', 'soul_reflection',
  'convention', 'preference', 'infrastructure', 'workflow',
  'tech_stack', 'design_decision', 'architecture',
  'pattern', 'insight', 'meta_pattern',
] as const;

/**
 * Depth axis: saturating count of meaningful memories since reset.
 * Saturates: 60→63, 120→86, 240→98, asymptote 100.
 */
export function computeDepthAxis(rawDb: DatabaseSync, resetAt: string): number {
  const placeholders = DEPTH_ELIGIBLE_KINDS.map(() => '?').join(',');
  const row = rawDb
    .prepare(
      `SELECT COUNT(*) AS n FROM memories
       WHERE archived_at IS NULL AND created_at > ?
         AND kind IN (${placeholders})`,
    )
    .get(resetAt, ...DEPTH_ELIGIBLE_KINDS) as { n: number };
  return Math.round(Math.min(100, 100 * (1 - Math.exp(-row.n / 60))));
}

/**
 * Momentum axis: recent meaningful activity in last 28 days (21 active + 7 grace).
 * Counts accept/dismiss feedback + completed runs + done/acknowledged observations.
 * Saturates: 18→63, 36→86.
 */
export function computeMomentumAxis(rawDb: DatabaseSync, resetAt: string, now: Date): number {
  const cutoffMs = Math.max(
    new Date(resetAt).getTime(),
    now.getTime() - MOMENTUM_WINDOW_MS,
  );
  const cutoff = new Date(cutoffMs).toISOString();
  const fb = (rawDb
    .prepare(
      `SELECT COUNT(*) AS n FROM feedback
       WHERE created_at > ? AND target_kind='suggestion' AND action IN ('accept','dismiss')`,
    )
    .get(cutoff) as { n: number }).n;
  const runs = (rawDb
    .prepare(`SELECT COUNT(*) AS n FROM runs WHERE created_at > ? AND status='done'`)
    .get(cutoff) as { n: number }).n;
  const obs = (rawDb
    .prepare(
      `SELECT COUNT(*) AS n FROM observations WHERE created_at > ? AND status IN ('done','acknowledged')`,
    )
    .get(cutoff) as { n: number }).n;
  const total = fb + runs + obs;
  return Math.round(Math.min(100, 100 * (1 - Math.exp(-total / 18))));
}

/**
 * Alignment axis: 60% accept/dismiss rate + 30% corrections + 10% soul reflections.
 * Rate is neutral (50) until at least 5 feedback data points.
 */
export function computeAlignmentAxis(db: ShadowDatabase, resetAt: string): number {
  const rate = db.getAcceptDismissRate(30);
  const ratePart = rate.total >= 5 ? rate.rate * 100 : 50;
  const corr = (db.rawDb
    .prepare(
      `SELECT COUNT(*) AS n FROM memories
       WHERE kind='correction' AND archived_at IS NULL AND created_at > ?`,
    )
    .get(resetAt) as { n: number }).n;
  const corrPart = Math.min(100, 100 * (1 - Math.exp(-corr / 8)));
  const reflect = (db.rawDb
    .prepare(
      `SELECT COUNT(*) AS n FROM memories
       WHERE kind='soul_reflection' AND archived_at IS NULL AND created_at > ?`,
    )
    .get(resetAt) as { n: number }).n;
  const reflectPart = Math.min(100, reflect * 25);
  return Math.round(0.6 * ratePart + 0.3 * corrPart + 0.1 * reflectPart);
}

/**
 * Autonomy axis: successful auto-spawned child runs (parent_run_id NOT NULL,
 * status='done', outcome∈{executed,executed_manual}) since reset.
 * Saturates: 10→63, 20→86.
 */
export function computeAutonomyAxis(rawDb: DatabaseSync, resetAt: string): number {
  const row = rawDb
    .prepare(
      `SELECT COUNT(*) AS n FROM runs
       WHERE parent_run_id IS NOT NULL AND status='done'
         AND outcome IN ('executed','executed_manual') AND created_at > ?`,
    )
    .get(resetAt) as { n: number };
  return Math.round(Math.min(100, 100 * (1 - Math.exp(-row.n / 10))));
}

export function computeBondAxes(
  db: ShadowDatabase,
  resetAt: string,
  now: Date = new Date(),
): BondAxes {
  return {
    time: Math.round(computeTimeAxis(now, resetAt)),
    depth: computeDepthAxis(db.rawDb, resetAt),
    momentum: computeMomentumAxis(db.rawDb, resetAt, now),
    alignment: computeAlignmentAxis(db, resetAt),
    autonomy: computeAutonomyAxis(db.rawDb, resetAt),
  };
}

// ---------------------------------------------------------------------------
// Tier engine
// ---------------------------------------------------------------------------

export type BondTierInfo = {
  tier: number;
  name: string;
  minDays: number;
  qualityFloor: number;
};

export const BOND_TIERS: BondTierInfo[] = [
  { tier: 1, name: 'observer', minDays: 0,   qualityFloor: 0  },
  { tier: 2, name: 'echo',     minDays: 3,   qualityFloor: 15 },
  { tier: 3, name: 'whisper',  minDays: 7,   qualityFloor: 28 },
  { tier: 4, name: 'shade',    minDays: 14,  qualityFloor: 40 },
  { tier: 5, name: 'shadow',   minDays: 30,  qualityFloor: 52 },
  { tier: 6, name: 'wraith',   minDays: 60,  qualityFloor: 64 },
  { tier: 7, name: 'herald',   minDays: 120, qualityFloor: 76 },
  { tier: 8, name: 'kindred',  minDays: 240, qualityFloor: 86 },
];

export const BOND_TIER_NAMES: Record<number, string> = Object.fromEntries(
  BOND_TIERS.map((t) => [t.tier, t.name]),
);

/**
 * Compute bond tier from axes + elapsed time.
 * Dual gate: elapsedDays >= minDays AND quality >= qualityFloor.
 * Quality = average of 4 dynamic axes (time is gate-only).
 * Monotonic: never returns lower than currentTier.
 */
export function computeBondTier(
  axes: BondAxes,
  now: Date,
  resetAt: string,
  currentTier: number,
): { tier: number; rose: boolean } {
  const elapsedDays = (now.getTime() - new Date(resetAt).getTime()) / MS_PER_DAY;
  const quality = (axes.depth + axes.momentum + axes.alignment + axes.autonomy) / 4;
  let achieved = 1;
  for (const t of BOND_TIERS) {
    if (elapsedDays >= t.minDays && quality >= t.qualityFloor) achieved = t.tier;
    else break;
  }
  const finalTier = Math.max(currentTier, achieved);
  return { tier: finalTier, rose: finalTier > currentTier };
}

// ---------------------------------------------------------------------------
// applyBondDelta — recompute axes from data, persist, evaluate tier.
// ---------------------------------------------------------------------------

export type BondEventKind =
  | 'check_in'
  | 'memory_taught'
  | 'heartbeat_completed'
  | 'interaction_logged'
  | 'suggestion_accepted'
  | 'suggestion_dismissed'
  | 'suggestion_converted'
  | 'three_dismissed_in_row'
  | 'run_success'
  | 'run_failed'
  | 'positive_sentiment'
  | 'user_override'
  | 'inactivity_day';

/**
 * SYNC. Recomputes axes from data (idempotent), persists, evaluates tier.
 * On tier rise: fires chronicle lore hook + event queue entry + unlock eval
 * as fire-and-forget async tasks. Never throws.
 *
 * The event kind is informational only — axes are data-driven, so the
 * specific event doesn't affect the computed value.
 */
export function applyBondDelta(
  db: ShadowDatabase,
  eventKind: BondEventKind,
): { axes: BondAxes; tier: number; rose: boolean; oldTier: number } {
  const profile = db.ensureProfile();
  const oldTier = profile.bondTier;
  const resetAt = profile.bondResetAt;

  const axes = computeBondAxes(db, resetAt);
  const { tier, rose } = computeBondTier(axes, new Date(), resetAt, oldTier);

  // CRITICAL: pass bondAxesJson (not bondAxes) — updateProfile's generic
  // toSnake(key) → 'bond_axes_json' triggers JSON.stringify via _json suffix.
  // Precedent: src/web/routes/knowledge.ts:143 writes preferencesJson.
  db.updateProfile(profile.id, {
    bondAxesJson: axes,
    bondTier: tier,
    ...(rose ? { bondTierLastRiseAt: new Date().toISOString() } : {}),
  } as Record<string, unknown>);

  if (rose) {
    // Fire-and-forget async: chronicle lore (Opus call, may take seconds)
    import('../analysis/chronicle.js')
      .then(({ triggerChronicleLore }) => triggerChronicleLore(db, tier, oldTier))
      .catch((e) => console.error('[bond] lore hook failed:', e));

    // Sync: event queue (cheap DB write)
    try {
      db.createEvent({
        kind: 'bond_tier_rise',
        priority: 7,
        payload: { from: oldTier, to: tier, name: BOND_TIER_NAMES[tier] },
      });
    } catch (e) {
      console.error('[bond] event emit failed:', e);
    }

    // Fire-and-forget async: unlocks (cheap, but may emit N events)
    import('./unlockables.js')
      .then(({ evaluateUnlocks }) => evaluateUnlocks(db, tier))
      .catch((e) => console.error('[bond] unlocks hook failed:', e));
  }

  // eventKind kept in signature for audit/telemetry but unused in computation
  void eventKind;

  return { axes, tier, rose, oldTier };
}

// ---------------------------------------------------------------------------
// resetBondState — wipe bond state, preserve everything else
// ---------------------------------------------------------------------------

/**
 * Reset bond state to tier 1 (observer) with zero axes. Clears chronicle
 * entries + daily cache + relocks all unlockables. Memories, suggestions,
 * observations, runs, interactions, audit events, and soul are preserved.
 *
 * Transactional — either all changes apply or none.
 */
export function resetBondState(db: ShadowDatabase): void {
  const now = new Date().toISOString();
  db.rawDb.exec('BEGIN IMMEDIATE');
  try {
    db.updateProfile('default', {
      bondAxesJson: ZERO_AXES,
      bondTier: 1,
      bondResetAt: now,
      bondTierLastRiseAt: null,
    } as Record<string, unknown>);
    db.rawDb.prepare('DELETE FROM chronicle_entries').run();
    db.rawDb.prepare('DELETE FROM bond_daily_cache').run();
    db.rawDb.prepare('UPDATE unlockables SET unlocked = 0, unlocked_at = NULL').run();
    db.createAuditEvent({
      interface: 'system',
      action: 'bond_reset',
      targetKind: 'user_profile',
      targetId: 'default',
      detail: {
        resetAt: now,
        preserved: [
          'memories',
          'observations',
          'suggestions',
          'runs',
          'interactions',
          'audit_events',
          'soul',
        ],
      },
    });
    db.rawDb.exec('COMMIT');
  } catch (e) {
    db.rawDb.exec('ROLLBACK');
    throw e;
  }
}

