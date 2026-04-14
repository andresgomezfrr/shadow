export const CHRONICLE_HERO = '/ghost/chronicle/hero.webp';
export const CHRONICLE_BG = '/ghost/chronicle/bg-texture.webp';
export const TIER_LOCKED_IMAGE = '/ghost/chronicle/tier-locked.webp';
export const UNLOCK_PLACEHOLDER = '/ghost/chronicle/unlock-placeholder.webp';

export const TIER_PORTRAITS: Record<number, string> = {
  1: '/ghost/chronicle/tier-1-observer.webp',
  2: '/ghost/chronicle/tier-2-echo.webp',
  3: '/ghost/chronicle/tier-3-whisper.webp',
  4: '/ghost/chronicle/tier-4-shade.webp',
  5: '/ghost/chronicle/tier-5-shadow.webp',
  6: '/ghost/chronicle/tier-6-wraith.webp',
  7: '/ghost/chronicle/tier-7-herald.webp',
  8: '/ghost/chronicle/tier-8-kindred.webp',
};

const MILESTONE_CONSTELLATION = '/ghost/chronicle/milestone-constellation.webp';
const MILESTONE_BOOK = '/ghost/chronicle/milestone-book.webp';
const MILESTONE_QUILL = '/ghost/chronicle/milestone-quill.webp';
const MILESTONE_KEY = '/ghost/chronicle/milestone-key.webp';

export function getMilestoneIcon(milestoneKey: string): string {
  if (milestoneKey === 'first_auto_execute') return MILESTONE_KEY;
  if (milestoneKey === 'first_correction') return MILESTONE_QUILL;
  if (milestoneKey.startsWith('memories:')) return MILESTONE_BOOK;
  return MILESTONE_CONSTELLATION;
}
