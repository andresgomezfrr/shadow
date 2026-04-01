import { randomUUID } from 'node:crypto';

import type { ShadowConfig } from '../config/load-config.js';
import type { ShadowDatabase } from '../storage/database.js';
import type { HeartbeatRecord, UserProfileRecord } from '../storage/models.js';

import {
  activityObserve,
  activityAnalyze,
  activitySuggest,
  activityConsolidate,
  activityNotify,
} from './activities.js';

// --- Phase types ---

export type HeartbeatPhase = 'wake' | 'observe' | 'analyze' | 'suggest' | 'consolidate' | 'notify' | 'idle';

export type HeartbeatContext = {
  config: ShadowConfig;
  db: ShadowDatabase;
  profile: UserProfileRecord;
  lastHeartbeat: HeartbeatRecord | null;
  pendingEventCount: number;
};

export type HeartbeatResult = {
  id: string;
  phases: HeartbeatPhase[];
  observationsCreated: number;
  suggestionsCreated: number;
  memoriesPromoted: number;
  memoriesDemoted: number;
  eventsQueued: number;
  durationMs: number;
  llmCalls: number;
  tokensUsed: number;
};

// --- Helpers ---

function isFocusModeActive(profile: UserProfileRecord): boolean {
  if (profile.focusMode !== 'focus') return false;
  if (profile.focusUntil) {
    return new Date(profile.focusUntil) > new Date();
  }
  return true;
}

function shouldConsolidate(db: ShadowDatabase): boolean {
  // Consolidate if there are enough warm/cool memories that might need maintenance
  const warm = db.listMemories({ layer: 'warm', archived: false });
  const cool = db.listMemories({ layer: 'cool', archived: false });
  return warm.length + cool.length > 10;
}

// --- State machine ---

export async function runHeartbeat(ctx: HeartbeatContext): Promise<HeartbeatResult> {
  const startTime = Date.now();
  const heartbeatId = randomUUID();

  const result: HeartbeatResult = {
    id: heartbeatId,
    phases: [],
    observationsCreated: 0,
    suggestionsCreated: 0,
    memoriesPromoted: 0,
    memoriesDemoted: 0,
    eventsQueued: 0,
    durationMs: 0,
    llmCalls: 0,
    tokensUsed: 0,
  };

  // Create the heartbeat record in DB
  const heartbeatRecord = ctx.db.createHeartbeat({
    phase: 'wake',
    activity: null,
    startedAt: new Date().toISOString(),
  });

  // Check focus mode expiry: if focus expired, clear it
  if (ctx.profile.focusMode === 'focus' && ctx.profile.focusUntil) {
    if (new Date(ctx.profile.focusUntil) <= new Date()) {
      ctx.db.updateProfile(ctx.profile.id, { focusMode: null, focusUntil: null });
      ctx.profile = { ...ctx.profile, focusMode: null, focusUntil: null };
    }
  }

  const focusActive = isFocusModeActive(ctx.profile);

  // --- WAKE phase ---
  result.phases.push('wake');
  ctx.db.updateHeartbeat(heartbeatRecord.id, { phase: 'wake', activity: 'waking' });

  // Smart heartbeat: check if there are new observations since last heartbeat
  let hasNewObservationsSinceLastBeat = true;
  if (ctx.lastHeartbeat?.startedAt) {
    const countSince = ctx.db.countObservationsSince(ctx.lastHeartbeat.startedAt);
    hasNewObservationsSinceLastBeat = countSince > 0;
  }

  // --- OBSERVE phase (always runs after wake) ---
  result.phases.push('observe');
  ctx.db.updateHeartbeat(heartbeatRecord.id, { phase: 'observe', activity: 'observing repos' });

  const observeResult = await activityObserve(ctx);
  result.observationsCreated = observeResult.observationsCreated;

  ctx.db.updateHeartbeat(heartbeatRecord.id, {
    reposObserved: observeResult.reposObserved,
    observationsCreated: observeResult.observationsCreated,
  });

  // Determine next phase after observe
  const hasObservations = observeResult.observationsCreated > 0;
  const needsConsolidation = shouldConsolidate(ctx.db);

  // Smart heartbeat: if no new observations since last heartbeat AND no new ones this beat,
  // skip analyze/suggest/consolidate entirely (no LLM cost)
  const skipLlmPhases = !hasNewObservationsSinceLastBeat && !hasObservations;

  if (skipLlmPhases) {
    // Nothing new to process — go straight to notify then idle
    result.phases.push('notify');
    ctx.db.updateHeartbeat(heartbeatRecord.id, { phase: 'notify', activity: 'checking notifications' });
    const notifyResult = await activityNotify(ctx);
    result.eventsQueued = notifyResult.eventsQueued;

    result.phases.push('idle');
    ctx.db.updateHeartbeat(heartbeatRecord.id, {
      phase: 'idle',
      activity: null,
      durationMs: Date.now() - startTime,
      finishedAt: new Date().toISOString(),
    });
    result.durationMs = Date.now() - startTime;
    return result;
  }

  // --- ANALYZE phase ---
  if (hasObservations && !focusActive) {
    result.phases.push('analyze');
    ctx.db.updateHeartbeat(heartbeatRecord.id, { phase: 'analyze', activity: 'analyzing observations' });

    const unprocessed = ctx.db.listObservations({ processed: false });
    const analyzeResult = await activityAnalyze(ctx, unprocessed);

    result.llmCalls += analyzeResult.llmCalls;
    result.tokensUsed += analyzeResult.tokensUsed;

    // --- SUGGEST phase ---
    // Suggest if notable observations AND trust >= 2 AND not in focus mode
    if (unprocessed.length > 0 && ctx.profile.trustLevel >= 2 && !focusActive) {
      result.phases.push('suggest');
      ctx.db.updateHeartbeat(heartbeatRecord.id, { phase: 'suggest', activity: 'generating suggestions' });

      const suggestResult = await activitySuggest(ctx, unprocessed);
      result.suggestionsCreated = suggestResult.suggestionsCreated;
      result.llmCalls += suggestResult.llmCalls;
      result.tokensUsed += suggestResult.tokensUsed;

      ctx.db.updateHeartbeat(heartbeatRecord.id, {
        suggestionsCreated: result.suggestionsCreated,
      });
    }
  }

  // --- CONSOLIDATE phase ---
  if (needsConsolidation) {
    result.phases.push('consolidate');
    ctx.db.updateHeartbeat(heartbeatRecord.id, { phase: 'consolidate', activity: 'consolidating memories' });

    const consolidateResult = await activityConsolidate(ctx);
    result.memoriesPromoted = consolidateResult.memoriesPromoted;
    result.memoriesDemoted = consolidateResult.memoriesDemoted;
    result.llmCalls += consolidateResult.llmCalls;
    result.tokensUsed += consolidateResult.tokensUsed;
  }

  // --- NOTIFY phase ---
  result.phases.push('notify');
  ctx.db.updateHeartbeat(heartbeatRecord.id, { phase: 'notify', activity: 'checking notifications' });

  const notifyResult = await activityNotify(ctx);
  result.eventsQueued = notifyResult.eventsQueued;

  // --- IDLE phase ---
  result.phases.push('idle');
  result.durationMs = Date.now() - startTime;

  ctx.db.updateHeartbeat(heartbeatRecord.id, {
    phase: 'idle',
    activity: null,
    durationMs: result.durationMs,
    finishedAt: new Date().toISOString(),
  });

  return result;
}
