import type { SuggestionRecord, UserProfileRecord } from '../storage/models.js';

export type RankContext = {
  projectMomentum?: Map<string, number>; // projectId → 0-100
};

/**
 * Compute a numeric rank score for a suggestion given the user profile.
 *
 * Formula:
 *   base  = impactScore * 20 + confidenceScore * 0.3
 *   penalty = riskScore * 10
 *   timeDecay = 1 point per day since creation
 *   momentumBoost = max project momentum * 0.08 (max +8)
 *   score = max(0, base - penalty - timeDecay + momentumBoost)
 */
export function computeRankScore(
  suggestion: SuggestionRecord,
  _profile: UserProfileRecord,
  ctx?: RankContext,
): number {
  const base = suggestion.impactScore * 20 + suggestion.confidenceScore * 0.3;
  const penalty = suggestion.riskScore * 10;

  // Time decay: 1 point per day since creation
  const daysOld = Math.max(0, (Date.now() - new Date(suggestion.createdAt).getTime()) / 86400000);

  // Momentum boost: suggestions linked to active projects rank higher
  let momentumBoost = 0;
  if (ctx?.projectMomentum) {
    for (const entity of suggestion.entities ?? []) {
      if (entity.type === 'project') {
        const m = ctx.projectMomentum.get(entity.id) ?? 0;
        momentumBoost = Math.max(momentumBoost, m * 0.08);
      }
    }
  }

  return Math.max(0, base - penalty - daysOld + momentumBoost);
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
