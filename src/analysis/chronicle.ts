import type { ShadowDatabase } from '../storage/database.js';

// ---------------------------------------------------------------------------
// Chronicle activity module — STUB for commit 2 compile compat.
// Full implementation (LLM calls + prompts) arrives in commit 4.
// ---------------------------------------------------------------------------

/**
 * Tier-cross lore fragment (Opus, immutable, one-shot per tier).
 * STUB — no-op until commit 4.
 */
export async function triggerChronicleLore(
  _db: ShadowDatabase,
  _newTier: number,
  _oldTier: number,
): Promise<{ ok: boolean; entryId?: string }> {
  return { ok: false };
}

/**
 * Milestone commentary (Opus, immutable, one-shot per milestone key).
 * STUB — no-op until commit 4.
 */
export async function triggerChronicleMilestone(
  _db: ShadowDatabase,
  _milestoneKey: string,
  _context: { title: string; data: Record<string, unknown> },
): Promise<{ ok: boolean; entryId?: string }> {
  return { ok: false };
}

/**
 * Voice of Shadow (Haiku, 24h cached daily phrase).
 * STUB — returns placeholder until commit 4.
 */
export async function getVoiceOfShadow(
  _db: ShadowDatabase,
): Promise<{ body: string; generatedAt: string }> {
  return { body: '', generatedAt: new Date().toISOString() };
}

/**
 * Next-step hint (Haiku, cached reactively).
 * STUB — returns placeholder until commit 4.
 */
export async function getNextStepHint(
  _db: ShadowDatabase,
): Promise<{ body: string; generatedAt: string }> {
  return { body: '', generatedAt: new Date().toISOString() };
}
