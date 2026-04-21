import type { ShadowDatabase } from '../storage/database.js';
import { log } from '../log.js';

/**
 * Evaluate which unlockables become available at a newly-reached tier
 * and mark them as unlocked. Emits one `unlock` event per newly unlocked
 * item. Called from applyBondDelta when tier rises.
 *
 * Safe to call multiple times at the same tier — only locked items with
 * tier_required <= newTier are affected.
 */
export function evaluateUnlocks(db: ShadowDatabase, newTier: number): void {
  const candidates = db.getLockedUnlockablesUpToTier(newTier);
  for (const u of candidates) {
    try {
      db.markUnlockableUnlocked(u.id);
    } catch (e) {
      log.error(`[unlocks] failed to mark ${u.id}:`, e);
      continue;
    }
    try {
      db.createEvent({
        kind: 'unlock',
        priority: 7,
        payload: {
          unlockId: u.id,
          title: u.title,
          tier: u.tierRequired,
          kind: u.kind,
        },
      });
    } catch (e) {
      log.error(`[unlocks] event emit failed for ${u.id}:`, e);
    }
  }
}
