import type { ShadowConfig } from '../config/load-config.js';
import type { ShadowDatabase } from '../storage/database.js';
import type { JobRecord, UserProfileRecord } from '../storage/models.js';

import {
  activityObserve,
  activityAnalyze,
  activityNotify,
} from './activities.js';

// --- Types ---

export type HeartbeatPhase = 'wake' | 'observe' | 'analyze' | 'notify' | 'idle';

export type HeartbeatContext = {
  config: ShadowConfig;
  db: ShadowDatabase;
  profile: UserProfileRecord;
  lastHeartbeat: JobRecord | null;
  pendingEventCount: number;
};

export type HeartbeatResult = {
  phases: HeartbeatPhase[];
  observationsCreated: number;
  eventsQueued: number;
  durationMs: number;
  llmCalls: number;
  tokensUsed: number;
};

// --- Helpers ---

function isFocusModeActive(profile: UserProfileRecord): boolean {
  if (profile.focusMode !== 'focus') return false;
  if (profile.focusUntil) return new Date(profile.focusUntil) > new Date();
  return true;
}

// --- State machine ---

export async function runHeartbeat(ctx: HeartbeatContext): Promise<HeartbeatResult> {
  const startTime = Date.now();

  const result: HeartbeatResult = {
    phases: [],
    observationsCreated: 0,
    eventsQueued: 0,
    durationMs: 0,
    llmCalls: 0,
    tokensUsed: 0,
  };

  // Check focus mode expiry
  if (ctx.profile.focusMode === 'focus' && ctx.profile.focusUntil) {
    if (new Date(ctx.profile.focusUntil) <= new Date()) {
      ctx.db.updateProfile(ctx.profile.id, { focusMode: null, focusUntil: null });
      ctx.profile = { ...ctx.profile, focusMode: null, focusUntil: null };
    }
  }

  const focusActive = isFocusModeActive(ctx.profile);

  // --- WAKE phase ---
  result.phases.push('wake');

  const unprocessedCount = ctx.db.listObservations({ processed: false }).length;
  let hasNewObservationsSinceLastBeat = unprocessedCount > 0;
  if (!hasNewObservationsSinceLastBeat && ctx.lastHeartbeat?.startedAt) {
    hasNewObservationsSinceLastBeat = ctx.db.countObservationsSince(ctx.lastHeartbeat.startedAt) > 0;
  }

  let hasRecentInteractions = false;
  try {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const interactionsPath = resolve(ctx.config.resolvedDataDir, 'interactions.jsonl');
    const content = readFileSync(interactionsPath, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    const since = ctx.lastHeartbeat?.startedAt
      ? new Date(ctx.lastHeartbeat.startedAt).getTime()
      : Date.now() - 60 * 60 * 1000;
    hasRecentInteractions = lines.some(line => {
      try { return new Date((JSON.parse(line) as { ts: string }).ts).getTime() > since; }
      catch { return false; }
    });
  } catch { /* no file */ }

  let hasRecentConversations = false;
  try {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const convPath = resolve(ctx.config.resolvedDataDir, 'conversations.jsonl');
    const content = readFileSync(convPath, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    const since = ctx.lastHeartbeat?.startedAt
      ? new Date(ctx.lastHeartbeat.startedAt).getTime()
      : Date.now() - 60 * 60 * 1000;
    hasRecentConversations = lines.some(line => {
      try { return new Date((JSON.parse(line) as { ts: string }).ts).getTime() > since; }
      catch { return false; }
    });
  } catch { /* no file */ }

  // --- OBSERVE phase ---
  result.phases.push('observe');
  const observeResult = await activityObserve(ctx);
  result.observationsCreated = observeResult.observationsCreated;

  const hasObservations = observeResult.observationsCreated > 0;
  const skipLlmPhases = !hasNewObservationsSinceLastBeat && !hasObservations && !hasRecentInteractions && !hasRecentConversations;

  if (skipLlmPhases) {
    result.phases.push('notify');
    const notifyResult = await activityNotify(ctx);
    result.eventsQueued = notifyResult.eventsQueued;
    result.phases.push('idle');
    result.durationMs = Date.now() - startTime;
    return result;
  }

  // --- ANALYZE phase ---
  if ((hasObservations || unprocessedCount > 0 || hasRecentInteractions || hasRecentConversations) && !focusActive) {
    result.phases.push('analyze');
    const unprocessed = ctx.db.listObservations({ processed: false });
    const analyzeResult = await activityAnalyze(ctx, unprocessed);
    result.llmCalls += analyzeResult.llmCalls;
    result.tokensUsed += analyzeResult.tokensUsed;
    result.observationsCreated += analyzeResult.observationsCreated ?? 0;
  }

  // --- NOTIFY phase ---
  result.phases.push('notify');
  const notifyResult = await activityNotify(ctx);
  result.eventsQueued = notifyResult.eventsQueued;

  // --- IDLE ---
  result.phases.push('idle');
  result.durationMs = Date.now() - startTime;

  return result;
}
