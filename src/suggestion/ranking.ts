import type { SuggestionRecord, UserProfileRecord } from '../storage/models.js';

/**
 * Compute a numeric rank score for a suggestion given the user profile.
 *
 * Formula:
 *   base  = impactScore * 20 + confidenceScore * 0.3
 *   penalty = riskScore * 10
 *   timeDecay = 1 point per day since creation
 *   score = max(0, base - penalty - timeDecay)
 */
export function computeRankScore(
  suggestion: SuggestionRecord,
  _profile: UserProfileRecord,
): number {
  const base = suggestion.impactScore * 20 + suggestion.confidenceScore * 0.3;
  const penalty = suggestion.riskScore * 10;

  // Time decay: 1 point per day since creation
  const createdMs = new Date(suggestion.createdAt).getTime();
  const nowMs = Date.now();
  const daysOld = Math.max(0, (nowMs - createdMs) / (24 * 60 * 60 * 1000));
  const timeDecay = daysOld;

  const score = base - penalty - timeDecay;
  return Math.max(0, score);
}

/**
 * Sort suggestions by rank score (descending).
 * Returns a new array; the original is not mutated.
 */
export function rankSuggestions(
  suggestions: SuggestionRecord[],
  profile: UserProfileRecord,
): SuggestionRecord[] {
  return [...suggestions].sort((a, b) => {
    return computeRankScore(b, profile) - computeRankScore(a, profile);
  });
}
