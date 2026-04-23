import type { ShadowConfig } from '../config/load-config.js';
import type { ShadowDatabase } from '../storage/database.js';
import type { JobRecord, UserProfileRecord } from '../storage/models.js';
import { isFocusModeActive } from '../profile/user-profile.js';

import {
  activityAnalyze,
  activityNotify,
} from './activities.js';

// --- Types ---

export type HeartbeatPhase = 'wake' | 'prepare' | 'summarize' | 'extract' | 'cleanup' | 'observe' | 'notify' | 'idle';

export type HeartbeatContext = {
  config: ShadowConfig;
  db: ShadowDatabase;
  profile: UserProfileRecord;
  lastHeartbeat: JobRecord | null;
  pendingEventCount: number;
  // Sensor data from daemon (optional, enriches LLM prompts)
  pendingGitEvents?: Array<{ repoId: string; repoName: string; type: string; ts: string }>;
  remoteSyncResults?: Array<{ repoId: string; repoName: string; newRemoteCommits: number; behindBranches: Array<{ branch: string; behind: number; ahead: number }>; newCommitMessages: string[] }>;
  enrichmentContext?: string;
  activeProjects?: Array<{ projectId: string; projectName: string; score: number }>;
  onPhase?: (phase: HeartbeatPhase) => void;
  /**
   * AbortSignal from the hosting job. Callers propagate this to
   * adapter.execute(pack.signal) so shutdown/drain cancels in-flight LLM
   * calls cooperatively (audit R-16 completion).
   */
  signal?: AbortSignal;
};

export type HeartbeatResult = {
  phases: HeartbeatPhase[];
  observationsCreated: number;
  eventsQueued: number;
  durationMs: number;
  llmCalls: number;
  tokensUsed: number;
};

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
  ctx.onPhase?.('wake');

  const unprocessedCount = ctx.db.listObservations({ processed: false }).length;
  let hasNewObservationsSinceLastBeat = unprocessedCount > 0;
  if (!hasNewObservationsSinceLastBeat && ctx.lastHeartbeat?.startedAt) {
    hasNewObservationsSinceLastBeat = ctx.db.countObservationsSince(ctx.lastHeartbeat.startedAt) > 0;
  }

  let hasRecentActivity = false;
  try {
    const { statSync, existsSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const interactionsPath = resolve(ctx.config.resolvedDataDir, 'interactions.jsonl');
    const conversationsPath = resolve(ctx.config.resolvedDataDir, 'conversations.jsonl');
    const eventsPath = resolve(ctx.config.resolvedDataDir, 'events.jsonl');

    // Check main files for new data (consume-and-delete: any content = new activity)
    const hasContent = (p: string) => { try { return statSync(p).size > 0; } catch { return false; } };
    hasRecentActivity = hasContent(interactionsPath) || hasContent(conversationsPath) || hasContent(eventsPath);

    // Check for orphaned .rotating files from crashed heartbeat
    if (!hasRecentActivity) {
      hasRecentActivity = existsSync(interactionsPath + '.rotating')
        || existsSync(conversationsPath + '.rotating')
        || existsSync(eventsPath + '.rotating');
    }
  } catch { /* no files */ }

  // --- Determine if LLM phases should run ---
  const skipLlmPhases = !hasNewObservationsSinceLastBeat && !hasRecentActivity;

  if (skipLlmPhases) {
    result.phases.push('notify');
    ctx.onPhase?.('notify');
    const notifyResult = await activityNotify(ctx);
    result.eventsQueued = notifyResult.eventsQueued;
    result.phases.push('idle');
    result.durationMs = Date.now() - startTime;
    return result;
  }

  // --- EXTRACT + CLEANUP + OBSERVE phases (3 LLM calls inside activityAnalyze) ---
  if ((unprocessedCount > 0 || hasRecentActivity) && !focusActive) {
    const unprocessed = ctx.db.listObservations({ processed: false });
    const analyzeResult = await activityAnalyze(ctx, unprocessed, undefined, (phase) => {
      result.phases.push(phase as HeartbeatPhase);
      ctx.onPhase?.(phase as HeartbeatPhase);
    });
    result.llmCalls += analyzeResult.llmCalls;
    result.tokensUsed += analyzeResult.tokensUsed;
    result.observationsCreated += analyzeResult.observationsCreated ?? 0;
  }

  // --- NOTIFY phase ---
  result.phases.push('notify');
  ctx.onPhase?.('notify');
  const notifyResult = await activityNotify(ctx);
  result.eventsQueued = notifyResult.eventsQueued;

  // --- IDLE ---
  result.phases.push('idle');
  result.durationMs = Date.now() - startTime;

  return result;
}
