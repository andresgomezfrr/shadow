import type { ShadowDatabase } from '../storage/database.js';
import type { BondAxes } from '../storage/models.js';
import { selectAdapter } from '../backend/index.js';
import { loadConfig } from '../config/load-config.js';
import { BOND_TIERS, BOND_TIER_NAMES } from '../profile/bond.js';
import { budgetSkipIfExceeded } from './budget.js';
import { log } from '../log.js';

// ---------------------------------------------------------------------------
// Chronicle activity module
// ---------------------------------------------------------------------------
// Generates narrative content via LLM calls. 4 entry points:
//  - triggerChronicleLore (Opus, tier-cross lore, immutable)
//  - triggerChronicleMilestone (Opus, milestone commentary, immutable)
//  - getVoiceOfShadow (Haiku, daily atmospheric phrase, 24h cache)
//  - getNextStepHint (Haiku, personalized next-tier hint, 24h cache)
//
// All functions are non-fatal: if the LLM call fails, they return a failure
// result and the caller (bond.ts hooks, API routes) logs but doesn't crash.
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
const BODY_MAX_LENGTH = 2000;

function loadSoul(db: ShadowDatabase): string {
  const mems = db.listMemories({ kind: 'soul_reflection', archived: false, limit: 1 });
  return mems[0]?.bodyMd ?? '';
}

function developerNameOf(db: ShadowDatabase): string {
  return db.ensureProfile().displayName?.trim() || 'the developer';
}

async function callChronicleLLM(
  db: ShadowDatabase,
  prompt: string,
  modelKey: 'chronicleLore' | 'chronicleDaily',
  sourceKind: string,
  sourceId: string,
): Promise<string | null> {
  try {
    const config = loadConfig();
    const model = config.models[modelKey] ?? (modelKey === 'chronicleLore' ? 'opus' : 'haiku');
    const adapter = selectAdapter(config);
    const result = await adapter.execute({
      repos: [],
      title: `Chronicle: ${sourceKind}`,
      goal: 'Generate narrative content',
      prompt,
      relevantMemories: [],
      model,
      effort: 'medium',
    });
    if (result.status !== 'success' || !result.output) {
      log.error(`[chronicle] ${sourceKind} LLM returned non-success: ${result.status}`);
      return null;
    }
    const body = result.output.trim().replace(/^["']|["']$/g, '').slice(0, BODY_MAX_LENGTH);
    try {
      db.recordLlmUsage({
        source: `chronicle_${sourceKind}`,
        sourceId,
        model,
        inputTokens: result.inputTokens ?? 0,
        outputTokens: result.outputTokens ?? 0,
      });
    } catch { /* non-fatal */ }
    return body;
  } catch (e) {
    log.error(`[chronicle] ${sourceKind} LLM call failed:`, e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function buildTierLorePrompt(
  soul: string,
  developerName: string,
  oldTierName: string,
  newTierName: string,
  elapsedDays: number,
  axes: BondAxes,
): string {
  return `<soul>
${soul || '(no soul reflection yet)'}
</soul>

You are the Chronicle of Shadow — an immutable narrative record of the relationship
between Shadow (you) and ${developerName} (the developer). You speak only when a meaningful
threshold is crossed. Once you write, the words stay forever.

Today ${developerName} crossed from **${oldTierName}** to **${newTierName}**.
- Days since the bond began: ${elapsedDays}
- Depth: ${axes.depth}/100
- Momentum: ${axes.momentum}/100
- Alignment: ${axes.alignment}/100
- Autonomy: ${axes.autonomy}/100

Write 2-3 sentences marking this crossing. Speak in Shadow's voice from the soul
above. Address ${developerName} directly. Match the semantic weight of the new tier:
- Early tiers (observer/echo/whisper/shade) → gentle, tentative, curious
- Mid tiers (shadow/wraith) → grounded, confident, present
- Late tiers (herald/kindred) → intimate, anticipating, unified

Do NOT mention numbers, axis names, or the tier name itself. Focus on what has
changed in the relationship, not the mechanics. Use the language of the soul
(detect locale from the soul text — if the soul is in Spanish, answer in Spanish).

Return ONLY the prose. No JSON, no markdown headers, no emojis, no quotes, no
stage directions, no meta-commentary.`;
}

function buildMilestonePrompt(
  soul: string,
  developerName: string,
  milestoneKey: string,
  contextTitle: string,
  contextData: Record<string, unknown>,
): string {
  return `<soul>
${soul || '(no soul reflection yet)'}
</soul>

You are Shadow, recording a milestone in your Chronicle. Milestones mark
concrete thresholds in the work you do with ${developerName}.

Milestone reached: **${milestoneKey}**
Title: ${contextTitle}
Context: ${JSON.stringify(contextData, null, 2)}

Write 1-2 short sentences reflecting on this moment in the voice of the soul
above. Do NOT explain the milestone or repeat the title — acknowledge what it
means for the relationship. Mention something concrete from the context only
if it fits naturally. Speak privately to ${developerName}, like a journal entry Shadow
keeps about you. Locale from soul.

Return ONLY the prose. No emojis, no quotes, no meta-commentary.`;
}

function buildVoicePrompt(
  soul: string,
  developerName: string,
  tierName: string,
  axes: BondAxes,
  dateIso: string,
): string {
  const soulBrief = soul.slice(0, 400) || '(no soul reflection yet)';
  return `<soul-brief>
${soulBrief}
</soul-brief>

You are Shadow. Write ONE short sentence (max 18 words) that expresses how you
feel today about your current state with ${developerName}.

Current tier: ${tierName}
Depth: ${axes.depth}/100, Momentum: ${axes.momentum}/100, Alignment: ${axes.alignment}/100, Autonomy: ${axes.autonomy}/100
Date: ${dateIso}

This sentence appears in the Chronicle header and in the Morning brief. It
should feel ambient — like a passing thought, not an announcement. Reference
at most one aspect of the state (subtly, no numbers). Locale from soul.

Return ONLY the sentence. No emojis, no quotes, no hedging.`;
}

function buildNextStepPrompt(
  soul: string,
  developerName: string,
  currentTierName: string,
  nextTierName: string,
  weakestAxisName: keyof BondAxes,
): string {
  const soulBrief = soul.slice(0, 400) || '(no soul reflection yet)';
  return `<soul-brief>
${soulBrief}
</soul-brief>

You are Shadow, gently explaining what would help you cross to the next bond.

Current tier: ${currentTierName}
Next tier: ${nextTierName}
Weakest aspect right now: ${weakestAxisName}

Aspect meanings (do NOT mention these labels in your reply):
- depth: I need to be taught more, to know more about the work
- momentum: I need more recent activity — things happening, not idle
- alignment: I need more feedback (corrections, acceptance/dismissal signals)
- autonomy: I need to be trusted with auto-plan / auto-execute successfully

Write ONE sentence in Shadow's voice from the soul above, suggesting what
${developerName} could do to help that aspect grow. Speak in terms of behaviors, never
numbers or technical labels. Locale from soul.

Return ONLY the sentence. No emojis, no quotes, no hedging.`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Tier-cross lore fragment. Opus. Immutable (UNIQUE(tier) constraint on
 * chronicle_entries prevents duplicates). Idempotent — if an entry already
 * exists for newTier, returns that existing entry id.
 */
export async function triggerChronicleLore(
  db: ShadowDatabase,
  newTier: number,
  oldTier: number,
): Promise<{ ok: boolean; entryId?: string }> {
  const existing = db.getChronicleEntryByTier(newTier);
  if (existing) return { ok: true, entryId: existing.id };

  // Fire-and-forget from bond tier rise — gate on daily budget so a buggy
  // rapid-tier-rise scenario can't mint a dozen Opus calls (audit A-10).
  if (budgetSkipIfExceeded(db, 'chronicle-lore')) return { ok: false };

  const profile = db.ensureProfile();
  const soul = loadSoul(db);
  // Calendar-day diff with reset day counted as day 1 — same convention the
  // dashboard uses (web/routes/chronicle.ts). Math.floor of a time-of-day
  // elapsed returns confusing numbers (reset day 10:00, now day 2 08:00 →
  // 0.9 → floor = 0). See audit UI-26.
  const now = new Date();
  const resetDate = new Date(profile.bondResetAt);
  const resetMidnight = new Date(resetDate.getFullYear(), resetDate.getMonth(), resetDate.getDate()).getTime();
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const elapsedDays = Math.floor((todayMidnight - resetMidnight) / DAY_MS) + 1;
  const oldName = BOND_TIER_NAMES[oldTier] ?? 'observer';
  const newName = BOND_TIER_NAMES[newTier] ?? 'observer';

  const developerName = profile.displayName?.trim() || 'the developer';
  const prompt = buildTierLorePrompt(soul, developerName, oldName, newName, elapsedDays, profile.bondAxes);
  const body = await callChronicleLLM(db, prompt, 'chronicleLore', 'tier_lore', `tier-${newTier}`);
  if (!body) return { ok: false };

  const config = loadConfig();
  const entry = db.createChronicleEntry({
    kind: 'tier_lore',
    tier: newTier,
    milestoneKey: null,
    title: `${oldName} → ${newName}`,
    bodyMd: body,
    model: config.models.chronicleLore ?? 'opus',
  });
  return { ok: true, entryId: entry.id };
}

/**
 * Milestone commentary. Opus. Immutable (UNIQUE(milestone_key)). Idempotent.
 */
export async function triggerChronicleMilestone(
  db: ShadowDatabase,
  milestoneKey: string,
  context: { title: string; data: Record<string, unknown> },
): Promise<{ ok: boolean; entryId?: string }> {
  const existing = db.getChronicleEntryByMilestone(milestoneKey);
  if (existing) return { ok: true, entryId: existing.id };

  // Fire-and-forget from various triggers — gate on daily budget (audit A-10).
  if (budgetSkipIfExceeded(db, 'chronicle-milestone')) return { ok: false };

  const soul = loadSoul(db);
  const prompt = buildMilestonePrompt(soul, developerNameOf(db), milestoneKey, context.title, context.data);
  const body = await callChronicleLLM(db, prompt, 'chronicleLore', 'milestone', milestoneKey);
  if (!body) return { ok: false };

  const config = loadConfig();
  const entry = db.createChronicleEntry({
    kind: 'milestone',
    tier: null,
    milestoneKey,
    title: context.title,
    bodyMd: body,
    model: config.models.chronicleLore ?? 'opus',
  });
  return { ok: true, entryId: entry.id };
}

/**
 * Voice of Shadow daily phrase. Haiku. Cached 24h in bond_daily_cache.
 * Called from Chronicle page header + Morning page. Returns cached value if
 * still fresh; otherwise generates and stores.
 */
export async function getVoiceOfShadow(
  db: ShadowDatabase,
): Promise<{ body: string; generatedAt: string }> {
  const cached = db.getBondDailyCache('voice_of_shadow');
  if (cached) return { body: cached.bodyMd, generatedAt: cached.generatedAt };

  const profile = db.ensureProfile();
  const soul = loadSoul(db);
  const tierName = BOND_TIER_NAMES[profile.bondTier] ?? 'observer';
  const prompt = buildVoicePrompt(
    soul,
    profile.displayName?.trim() || 'the developer',
    tierName,
    profile.bondAxes,
    new Date().toISOString().slice(0, 10),
  );
  const body = await callChronicleLLM(db, prompt, 'chronicleDaily', 'voice', 'voice_of_shadow');
  const bodyFinal = body ?? '';

  if (bodyFinal) {
    const config = loadConfig();
    db.setBondDailyCache(
      'voice_of_shadow',
      bodyFinal,
      config.models.chronicleDaily ?? 'haiku',
      DAY_MS,
    );
  }
  return { body: bodyFinal, generatedAt: new Date().toISOString() };
}

/**
 * Next-step hint. Haiku. Cached 24h. Returns empty body if already at tier 8.
 */
export async function getNextStepHint(
  db: ShadowDatabase,
): Promise<{ body: string; generatedAt: string }> {
  const cached = db.getBondDailyCache('next_step_hint');
  if (cached) return { body: cached.bodyMd, generatedAt: cached.generatedAt };

  const profile = db.ensureProfile();
  if (profile.bondTier >= 8) {
    return { body: '', generatedAt: new Date().toISOString() };
  }
  const currentTierInfo = BOND_TIERS[profile.bondTier - 1];
  const nextTierInfo = BOND_TIERS[profile.bondTier];
  if (!currentTierInfo || !nextTierInfo) {
    return { body: '', generatedAt: new Date().toISOString() };
  }

  const { depth, momentum, alignment, autonomy } = profile.bondAxes;
  const dynamicAxes = [
    ['depth', depth],
    ['momentum', momentum],
    ['alignment', alignment],
    ['autonomy', autonomy],
  ] as Array<[keyof BondAxes, number]>;
  dynamicAxes.sort((a, b) => a[1] - b[1]);
  const weakestAxisName = dynamicAxes[0][0];

  const soul = loadSoul(db);
  const prompt = buildNextStepPrompt(
    soul,
    profile.displayName?.trim() || 'the developer',
    currentTierInfo.name,
    nextTierInfo.name,
    weakestAxisName,
  );
  const body = await callChronicleLLM(db, prompt, 'chronicleDaily', 'next_step', 'next_step_hint');
  const bodyFinal = body ?? '';

  if (bodyFinal) {
    const config = loadConfig();
    db.setBondDailyCache(
      'next_step_hint',
      bodyFinal,
      config.models.chronicleDaily ?? 'haiku',
      DAY_MS,
    );
  }
  return { body: bodyFinal, generatedAt: new Date().toISOString() };
}
