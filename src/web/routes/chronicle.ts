import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ShadowDatabase } from '../../storage/database.js';
import { json } from '../helpers.js';
import { BOND_TIERS } from '../../profile/bond.js';
import { getVoiceOfShadow, getNextStepHint } from '../../analysis/chronicle.js';

const MS_PER_DAY = 86_400_000;

/**
 * Chronicle API routes — expose bond state, tiers, entries, unlockables,
 * plus on-demand endpoints for Voice of Shadow and next-step hint.
 *
 * Anti-spoiler: future tier names are masked server-side as '???' and
 * tier_lore entries for unreached tiers are filtered out.
 */
export async function handleChronicleRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  _params: URLSearchParams,
  db: ShadowDatabase,
): Promise<boolean> {
  if (req.method !== 'GET') return false;

  // ---------- GET /api/chronicle — full state for the page ----------
  if (pathname === '/api/chronicle') {
    const profile = db.ensureProfile();
    const currentTier = profile.bondTier;
    const now = new Date();
    const elapsedDays = (now.getTime() - new Date(profile.bondResetAt).getTime()) / MS_PER_DAY;
    const quality =
      (profile.bondAxes.depth +
        profile.bondAxes.momentum +
        profile.bondAxes.alignment +
        profile.bondAxes.autonomy) /
      4;

    const tiers = BOND_TIERS.map((t) => ({
      tier: t.tier,
      name: t.tier <= currentTier ? t.name : '???',
      minDays: t.minDays,
      qualityFloor: t.qualityFloor,
      isReached: t.tier <= currentTier,
      isCurrent: t.tier === currentTier,
      isNext: t.tier === currentTier + 1,
      loreRevealed: !!db.getChronicleEntryByTier(t.tier),
    }));

    const entries = db.listChronicleEntries({ maxTier: currentTier });
    const unlockables = db.listUnlockables();

    // Build nextStep data (null if at tier 8)
    let nextStep: {
      tier: number;
      name: string;
      requirements: {
        minDays: number;
        daysElapsed: number;
        qualityFloor: number;
        currentQuality: number;
      };
      hint: string;
    } | null = null;
    if (currentTier < 8) {
      const nextTierInfo = BOND_TIERS[currentTier]; // currentTier is 1-based, BOND_TIERS[currentTier] is the next
      if (nextTierInfo) {
        const cached = db.getBondDailyCache('next_step_hint');
        nextStep = {
          tier: nextTierInfo.tier,
          name: nextTierInfo.name,
          requirements: {
            minDays: nextTierInfo.minDays,
            daysElapsed: Math.floor(elapsedDays),
            qualityFloor: nextTierInfo.qualityFloor,
            currentQuality: Math.round(quality),
          },
          hint: cached?.bodyMd ?? '',
        };
      }
    }

    // Voice of Shadow from cache only (don't generate inline to keep response fast)
    const voiceCached = db.getBondDailyCache('voice_of_shadow');

    return (
      json(res, {
        profile: {
          bondTier: profile.bondTier,
          bondAxes: profile.bondAxes,
          bondResetAt: profile.bondResetAt,
          bondTierLastRiseAt: profile.bondTierLastRiseAt,
        },
        tiers,
        entries,
        unlockables,
        nextStep,
        voiceOfShadow: voiceCached
          ? { body: voiceCached.bodyMd, generatedAt: voiceCached.generatedAt }
          : { body: '', generatedAt: new Date().toISOString() },
      }),
      true
    );
  }

  // ---------- GET /api/chronicle/voice — lazy Haiku generation ----------
  if (pathname === '/api/chronicle/voice') {
    const result = await getVoiceOfShadow(db);
    return json(res, result), true;
  }

  // ---------- GET /api/chronicle/next-step — lazy Haiku generation ----------
  if (pathname === '/api/chronicle/next-step') {
    const result = await getNextStepHint(db);
    return json(res, result), true;
  }

  return false;
}
