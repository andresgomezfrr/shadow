import type { SuggestionRecord, UserProfileRecord } from '../storage/models.js';

export type RankContext = {
  projectMomentum?: Map<string, number>; // projectId → 0-100
};

/**
 * Threshold above which a suggestion is considered "high impact" for
 * ranking purposes. Mirrors the same bar used by the impact-tiered expiry
 * logic in engine.ts (getStaleDays): impactScore >= 4 → 60-day TTL.
 * Keeping the threshold aligned so a suggestion that's *protected* from
 * expiry is also *protected* from rank-decay invisibility.
 */
const HIGH_IMPACT_THRESHOLD = 4;

/**
 * Compute a numeric rank score for a suggestion given the user profile.
 *
 * Formula:
 *   base  = impactScore * 20 + confidenceScore * 0.3
 *   penalty = riskScore * 10
 *   timeDecay = daysOld * decayRate
 *     decayRate = 0.3 for high-impact (matches 60-day TTL), 1 otherwise
 *   momentumBoost = effectiveMomentum * 0.08 (max ~+8)
 *     effectiveMomentum = high-impact ? max(m, 50) : m
 *     (momentum floor for high-impact so a quiet project can't bury them —
 *      audit e0321be4: high-impact + quiet project previously combined to
 *      create permanently-invisible suggestions)
 *   score = max(0, base - penalty - timeDecay + momentumBoost + revalidationBoost)
 */
export function computeRankScore(
  suggestion: SuggestionRecord,
  _profile: UserProfileRecord,
  ctx?: RankContext,
): number {
  const isHighImpact = suggestion.impactScore >= HIGH_IMPACT_THRESHOLD;
  const base = suggestion.impactScore * 20 + suggestion.confidenceScore * 0.3;
  const penalty = suggestion.riskScore * 10;

  // Time decay: scaled by impact. High-impact decays slower so the extended
  // 60-day TTL actually translates into visibility, not just survival.
  const daysOld = Math.max(0, (Date.now() - new Date(suggestion.createdAt).getTime()) / 86400000);
  const decayRate = isHighImpact ? 0.3 : 1;
  const timeDecay = daysOld * decayRate;

  // Momentum boost with a floor for high-impact suggestions.
  let momentumBoost = 0;
  if (ctx?.projectMomentum) {
    for (const entity of suggestion.entities ?? []) {
      if (entity.type === 'project') {
        const m = ctx.projectMomentum.get(entity.id) ?? 0;
        const effectiveMomentum = isHighImpact ? Math.max(m, 50) : m;
        momentumBoost = Math.max(momentumBoost, effectiveMomentum * 0.08);
      }
    }
  }

  // Revalidation boost: +5 per revalidation (capped at +15), extra +3 if validated recently (< 3 days)
  let revalidationBoost = 0;
  if (suggestion.revalidationCount > 0) {
    revalidationBoost = Math.min(suggestion.revalidationCount * 5, 15);
    if (suggestion.lastRevalidatedAt) {
      const daysSinceRevalidation = (Date.now() - new Date(suggestion.lastRevalidatedAt).getTime()) / 86400000;
      if (daysSinceRevalidation < 3) revalidationBoost += 3;
    }
    // Outdated verdict penalizes instead
    if (suggestion.revalidationVerdict === 'outdated') revalidationBoost = -20;
  }

  return Math.max(0, base - penalty - timeDecay + momentumBoost + revalidationBoost);
}

/**
 * Sort suggestions by rank score (descending).
 * Returns a new array; the original is not mutated.
 */
export function rankSuggestions(
  suggestions: SuggestionRecord[],
  profile: UserProfileRecord,
  ctx?: RankContext,
): SuggestionRecord[] {
  return [...suggestions].sort((a, b) => {
    return computeRankScore(b, profile, ctx) - computeRankScore(a, profile, ctx);
  });
}
