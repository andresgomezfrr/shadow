import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { ShadowConfig } from '../config/load-config.js';
import type { ShadowDatabase } from '../storage/database.js';
import type { UserProfileRecord } from '../storage/models.js';
import type { DaemonState } from './runtime.js';
import { selectAdapter } from '../backend/index.js';
import { log } from '../log.js';

// --- Types ---

type ThoughtContext = {
  config: ShadowConfig;
  db: ShadowDatabase;
  getState: () => DaemonState;
  writeState: (state: DaemonState) => void;
};

type ThoughtSettings = {
  enabled: boolean;
  intervalMinMs: number;
  intervalMaxMs: number;
  durationMs: number;
  model: string;
};

// --- Timer state ---

let thoughtTimer: ReturnType<typeof setTimeout> | null = null;
let cleanupTimer: ReturnType<typeof setTimeout> | null = null;

// --- Public API ---

export function startThoughtLoop(ctx: ThoughtContext): void {
  scheduleNext(ctx);
}

export function stopThoughtLoop(): void {
  if (thoughtTimer) {
    clearTimeout(thoughtTimer);
    thoughtTimer = null;
  }
  if (cleanupTimer) {
    clearTimeout(cleanupTimer);
    cleanupTimer = null;
  }
}

// --- Settings resolution (preferences > config) ---

function resolveSettings(profile: UserProfileRecord, config: ShadowConfig): ThoughtSettings {
  const prefs = profile.preferences as Record<string, unknown> | undefined;
  const models = prefs?.models as Record<string, string> | undefined;

  return {
    enabled: typeof prefs?.thoughtsEnabled === 'boolean' ? prefs.thoughtsEnabled : config.thoughtsEnabled,
    intervalMinMs: typeof prefs?.thoughtIntervalMinMs === 'number' ? prefs.thoughtIntervalMinMs : config.thoughtIntervalMinMs,
    intervalMaxMs: typeof prefs?.thoughtIntervalMaxMs === 'number' ? prefs.thoughtIntervalMaxMs : config.thoughtIntervalMaxMs,
    durationMs: typeof prefs?.thoughtDurationMs === 'number' ? prefs.thoughtDurationMs : config.thoughtDurationMs,
    model: models?.thought ?? config.models.thought,
  };
}

// --- Internal ---

function scheduleNext(ctx: ThoughtContext): void {
  let settings: ThoughtSettings;
  try {
    // Re-read settings each cycle so dashboard changes take effect immediately
    const profile = ctx.db.ensureProfile();
    settings = resolveSettings(profile, ctx.config);
  } catch {
    // DB error (transient lock or shutdown) — retry in 5 min instead of dying
    thoughtTimer = setTimeout(() => {
      thoughtTimer = null;
      scheduleNext(ctx);
    }, 5 * 60_000);
    return;
  }

  if (!settings.enabled) {
    // Re-check in 1 minute in case the user re-enables
    thoughtTimer = setTimeout(() => {
      thoughtTimer = null;
      scheduleNext(ctx);
    }, 60_000);
    return;
  }

  const delay = settings.intervalMinMs + Math.random() * (settings.intervalMaxMs - settings.intervalMinMs);

  thoughtTimer = setTimeout(async () => {
    thoughtTimer = null;
    await emitThought(ctx);
    scheduleNext(ctx);
  }, delay);
}

async function emitThought(ctx: ThoughtContext): Promise<void> {
  const profile = ctx.db.ensureProfile();
  const settings = resolveSettings(profile, ctx.config);

  // Skip if disabled or in focus mode
  if (!settings.enabled) return;
  if (profile.focusMode === 'focus') return;

  try {
    const thought = await generateThought(ctx, profile.locale, settings.model);
    if (!thought) return;

    // Write thought to daemon state
    const state = ctx.getState();
    state.thought = thought;
    state.thoughtExpiresAt = new Date(Date.now() + settings.durationMs).toISOString();
    ctx.writeState(state);

    // Schedule cleanup
    if (cleanupTimer) clearTimeout(cleanupTimer);
    cleanupTimer = setTimeout(() => {
      cleanupTimer = null;
      const s = ctx.getState();
      s.thought = null;
      s.thoughtExpiresAt = null;
      ctx.writeState(s);
    }, settings.durationMs);
  } catch {
    // Decorative feature — never crash the daemon
  }
}

async function generateThought(ctx: ThoughtContext, locale: string, model: string): Promise<string | null> {
  const adapter = selectAdapter(ctx.config);
  const briefContext = gatherBriefContext(ctx);

  const prompt = [
    `You are Shadow, a digital engineering companion.`,
    `Generate ONE brief thought (max 12 words). Be creative, warm, sometimes funny.`,
    ``,
    `Context: ${briefContext}`,
    `Language: ${locale} (you MUST respond in this language)`,
    ``,
    `Only the phrase, no quotes, no formatting, no emoji.`,
  ].join('\n');

  const result = await adapter.execute({
    repos: [],
    title: 'Shadow Thought',
    goal: 'Generate a brief thought for the status line',
    prompt,
    relevantMemories: [],
    model,
    effort: 'low',
    systemPrompt: null,
  });

  ctx.db.recordLlmUsage({
    source: 'thought',
    sourceId: null,
    model,
    inputTokens: result.inputTokens ?? 0,
    outputTokens: result.outputTokens ?? 0,
  });

  if (result.status !== 'success' || !result.output) return null;

  let thought = result.output.trim().replace(/^["']|["']$/g, '');
  if (thought.length > 120) thought = thought.slice(0, 117) + '...';

  return thought || null;
}

function gatherBriefContext(ctx: ThoughtContext): string {
  const parts: string[] = [];

  const state = ctx.getState();
  if (state.lastHeartbeatPhase) {
    parts.push(`heartbeat phase: ${state.lastHeartbeatPhase}`);
  }

  const pendingSuggestions = ctx.db.countPendingSuggestions();
  if (pendingSuggestions > 0) {
    parts.push(`${pendingSuggestions} pending suggestions`);
  }

  const interactionsPath = resolve(ctx.config.resolvedDataDir, 'interactions.jsonl');
  try {
    const lines = readFileSync(interactionsPath, 'utf8').trim().split('\n').filter(Boolean);
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    const recent = lines.filter(line => {
      try {
        const entry = JSON.parse(line) as { ts: string };
        return new Date(entry.ts).getTime() > fiveMinAgo;
      } catch { return false; }
    });
    if (recent.length > 0) {
      parts.push(`${recent.length} tool interactions in last 5min`);
    } else {
      parts.push('user is idle');
    }
  } catch {
    parts.push('user is idle');
  }

  try {
    const obs = ctx.db.listObservations({ status: 'open', limit: 2 });
    if (obs.length > 0) {
      parts.push(`recent observations: ${obs.map(o => o.title).join(', ')}`);
    }
  } catch (e) {
    log.error('[thought] listObservations failed:', e instanceof Error ? e.message : e);
  }

  return parts.join('; ') || 'idle, no recent activity';
}
