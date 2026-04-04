import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

import type { ShadowConfig } from '../config/schema.js';
import { killActiveChild } from '../backend/claude-cli.js';
import { createDatabase, ShadowDatabase } from '../storage/database.js';
import { startThoughtLoop, stopThoughtLoop } from './thought.js';
import { DIGEST_SCHEDULES, isScheduleReady } from './schedules.js';
import { EventBus } from '../web/event-bus.js';
import { RepoWatcher } from '../observation/repo-watcher.js';
import { RunQueue } from '../runner/queue.js';

// --- Types ---

export type DaemonState = {
  pid: number | null;
  startedAt: string | null;
  lastHeartbeatAt: string | null;
  lastTickAt: string | null;
  nextHeartbeatAt: string | null;
  lastHeartbeatPhase: string | null;
  lastConsolidationAt: string | null;
  consecutiveIdleTicks: number;
  currentSleepMs: number | null;
  pendingEventCount: number;
  thought: string | null;
  thoughtExpiresAt: string | null;
  lastActivityAt: string | null;
  pendingActivityCount: number;
  watchedRepoCount: number;
  activeRunCount: number;
  activeProjects: Array<{ projectId: string; projectName: string; score: number }>;
};

// --- Constants ---

const ACTIVE_SLEEP_MS = 5_000;
const IDLE_SLEEP_MS = 30_000;
const MAX_IDLE_SLEEP_MS = 120_000;

// --- Helpers ---

function daemonStatePath(config: ShadowConfig): string {
  return resolve(config.resolvedDataDir, 'daemon.json');
}

function daemonPidPath(config: ShadowConfig): string {
  return resolve(config.resolvedDataDir, 'daemon.pid');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeSleepMs(
  activeSleepMs: number,
  idleSleepMs: number,
  maxIdleSleepMs: number,
  worked: boolean,
  idleTicks: number,
): number {
  if (worked) return activeSleepMs;
  const multiplier = Math.min(idleTicks, 4);
  return Math.min(idleSleepMs * multiplier, maxIdleSleepMs);
}

function writePidFile(config: ShadowConfig): void {
  mkdirSync(config.resolvedDataDir, { recursive: true });
  writeFileSync(daemonPidPath(config), String(process.pid), 'utf-8');
}

function removePidFile(config: ShadowConfig): void {
  const pidPath = daemonPidPath(config);
  if (existsSync(pidPath)) {
    try {
      unlinkSync(pidPath);
    } catch {
      // best-effort cleanup
    }
  }
}

function writeDaemonState(config: ShadowConfig, state: DaemonState): void {
  writeFileSync(daemonStatePath(config), JSON.stringify(state, null, 2), 'utf-8');
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function emptyState(): DaemonState {
  return {
    pid: null,
    startedAt: null,
    lastHeartbeatAt: null,
    lastTickAt: null,
    nextHeartbeatAt: null,
    lastHeartbeatPhase: null,
    lastConsolidationAt: null,
    consecutiveIdleTicks: 0,
    currentSleepMs: null,
    pendingEventCount: 0,
    thought: null,
    thoughtExpiresAt: null,
    lastActivityAt: null,
    pendingActivityCount: 0,
    watchedRepoCount: 0,
    activeRunCount: 0,
    activeProjects: [],
  };
}

// --- Public API ---

export function getDaemonState(config: ShadowConfig): DaemonState {
  const statePath = daemonStatePath(config);
  if (!existsSync(statePath)) {
    return emptyState();
  }
  try {
    const raw = readFileSync(statePath, 'utf-8');
    return JSON.parse(raw) as DaemonState;
  } catch {
    return emptyState();
  }
}

export function isDaemonRunning(config: ShadowConfig): boolean {
  const pidPath = daemonPidPath(config);
  if (!existsSync(pidPath)) return false;

  try {
    const pid = parseInt(readFileSync(pidPath, 'utf-8').trim(), 10);
    if (isNaN(pid)) return false;
    return isProcessAlive(pid);
  } catch {
    return false;
  }
}

export function stopDaemon(config: ShadowConfig): boolean {
  const pidPath = daemonPidPath(config);
  if (!existsSync(pidPath)) return false;

  try {
    const pid = parseInt(readFileSync(pidPath, 'utf-8').trim(), 10);
    if (isNaN(pid)) return false;

    if (!isProcessAlive(pid)) {
      removePidFile(config);
      return false;
    }

    process.kill(pid, 'SIGTERM');
    removePidFile(config);
    return true;
  } catch {
    removePidFile(config);
    return false;
  }
}

export async function startDaemon(config: ShadowConfig): Promise<void> {
  let running = true;
  let db: ShadowDatabase | null = null;
  let webServer: { close: () => void } | null = null;
  let sleepReject: (() => void) | null = null;
  let currentJobPromise: Promise<void> | null = null;

  const shutdown = () => {
    running = false;
    stopThoughtLoop();
    killActiveChild();
    if (sleepReject) sleepReject();
  };

  let repoWatcherRef: RepoWatcher | null = null;
  let eventBusRef: EventBus | null = null;
  let runQueueRef: RunQueue | null = null;

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  try {
    // Step 1: Write PID file
    writePidFile(config);

    // Step 2: Create database
    db = createDatabase(config);

    // Step 3: Load profile (ensure it exists)
    db.ensureProfile();

    // Step 3b: Start EventBus + web server
    const eventBus = new EventBus();
    try {
      const { startWebServer } = await import('../web/server.js');
      webServer = await startWebServer(3700, db, eventBus);
    } catch {
      // web module not available — continue without it
    }

    // Step 3c: Start filesystem watcher
    const repoWatcher = new RepoWatcher(config, db);
    let pendingActivityCount = 0; // display-only counter for dashboard
    let lastActivityAt: string | null = null;
    const pendingGitEvents: Array<{ repoId: string; repoName: string; type: string; ts: string }> = [];
    let pendingRemoteSyncResults: Array<{ repoId: string; repoName: string; newRemoteCommits: number; behindBranches: Array<{ branch: string; behind: number; ahead: number }>; newCommitMessages: string[] }> = [];

    // Wake function — interrupts the sleep to process runs/events sooner
    let wakeLoop: (() => void) | null = null;

    repoWatcher.on('activity', (evt: import('../observation/repo-watcher.js').ActivityEvent) => {
      pendingActivityCount++; // display-only — does NOT trigger heartbeat
      lastActivityAt = new Date().toISOString();
      eventBus.emit({ type: 'activity:detected', data: { repoId: evt.repoId, repoName: evt.repoName, fileCount: evt.fileCount } });
      if (wakeLoop) wakeLoop();
    });

    repoWatcher.on('git-event', (evt: import('../observation/repo-watcher.js').GitEvent) => {
      pendingActivityCount++;
      lastActivityAt = new Date().toISOString();
      pendingGitEvents.push({ repoId: evt.repoId, repoName: evt.repoName, type: evt.type, ts: new Date().toISOString() });
      if (pendingGitEvents.length > 50) pendingGitEvents.splice(0, pendingGitEvents.length - 50); // cap
      eventBus.emit({ type: 'git:event', data: { repoId: evt.repoId, repoName: evt.repoName, type: evt.type } });
      if (wakeLoop) wakeLoop();
    });

    repoWatcher.startAll();
    repoWatcherRef = repoWatcher;
    eventBusRef = eventBus;

    // Step 4: Initialize state
    const now = new Date().toISOString();
    let consecutiveIdleTicks = 0;
    let lastHeartbeatAt: string | null = null;
    let lastHeartbeatPhase: string | null = null;
    let lastConsolidationAt: string | null = null;
    let nextHeartbeatAt: string = new Date(
      Date.now() + config.activityHeartbeatMaxIntervalMs,
    ).toISOString();

    const state: DaemonState = {
      pid: process.pid,
      startedAt: now,
      lastHeartbeatAt,
      lastTickAt: null,
      nextHeartbeatAt,
      lastHeartbeatPhase,
      lastConsolidationAt,
      consecutiveIdleTicks,
      currentSleepMs: null,
      pendingEventCount: 0,
      thought: null,
      thoughtExpiresAt: null,
      lastActivityAt: null,
      pendingActivityCount: 0,
      watchedRepoCount: repoWatcher.watchedCount,
      activeRunCount: 0,
      activeProjects: [],
    };

    writeDaemonState(config, state);

    // db is guaranteed non-null at this point (created in Step 2)
    const _db = db!;

    // Step 4b: Create concurrent run queue (after _db is assigned)
    const runQueue = new RunQueue(config, _db);
    runQueueRef = runQueue;

    // --- Job scheduler helpers ---

    function cleanStaleJobs(): void {
      const staleJobs = _db.listJobs({ status: 'running' });
      const staleThresholdMs = 10 * 60 * 1000; // 10min — no job should take longer
      for (const job of staleJobs) {
        const age = Date.now() - new Date(job.startedAt).getTime();
        if (age > staleThresholdMs) {
          _db.updateJob(job.id, {
            status: 'failed',
            result: { error: `stale — stuck running for ${Math.round(age / 60000)}m` },
            durationMs: age,
            finishedAt: new Date().toISOString(),
          });
          console.error(`[daemon] Marked stale job ${job.type}/${job.id.slice(0, 8)} as failed (${Math.round(age / 60000)}m)`);
        }
      }
    }

    // On startup, ALL 'running' jobs/runs are orphans (old daemon is dead) — fail them immediately
    function cleanOrphanedJobsOnStartup(): void {
      const runningJobs = _db.listJobs({ status: 'running' });
      for (const job of runningJobs) {
        const age = Date.now() - new Date(job.startedAt).getTime();
        _db.updateJob(job.id, {
          status: 'failed',
          result: { error: 'orphaned — daemon restarted' },
          durationMs: age,
          finishedAt: new Date().toISOString(),
        });
        console.error(`[daemon] Marked orphaned job ${job.type}/${job.id.slice(0, 8)} as failed (daemon restart)`);
      }
      const runningRuns = _db.listRuns({ status: 'running' });
      for (const run of runningRuns) {
        _db.transitionRun(run.id, 'failed');
        _db.updateRun(run.id, {
          errorSummary: 'orphaned — daemon restarted',
          finishedAt: new Date().toISOString(),
        });
        console.error(`[daemon] Marked orphaned run ${run.id.slice(0, 8)} as failed (daemon restart)`);
      }
      const queuedRuns = _db.listRuns({ status: 'queued' });
      for (const run of queuedRuns) {
        _db.transitionRun(run.id, 'failed');
        _db.updateRun(run.id, {
          errorSummary: 'orphaned — daemon restarted',
          finishedAt: new Date().toISOString(),
        });
        console.error(`[daemon] Marked orphaned queued run ${run.id.slice(0, 8)} as failed (daemon restart)`);
      }
    }
    cleanOrphanedJobsOnStartup();

    // Backfill embeddings for entities created outside heartbeat (MCP teach, CLI, etc.)
    (async () => {
      try {
        const { backfillEmbeddings } = await import('../memory/lifecycle.js');
        const counts = await backfillEmbeddings(_db);
        const total = counts.memories + counts.observations + counts.suggestions;
        if (total > 0) console.error(`[daemon] Backfilled embeddings: ${counts.memories} memories, ${counts.observations} observations, ${counts.suggestions} suggestions`);
      } catch (e) {
        console.error('[daemon] Embedding backfill failed:', e instanceof Error ? e.message : e);
      }
    })();

    // --- Thought loop (random status line thoughts, independent of heartbeat) ---
    startThoughtLoop({
      config,
      db: _db,
      getState: () => state,
      writeState: (s) => { Object.assign(state, s); writeDaemonState(config, state); },
    });

    // --- Job queue ---

    function shouldEnqueue(type: string, intervalMs: number): boolean {
      if (_db.hasQueuedOrRunning(type)) return false;
      const last = _db.getLastJob(type);
      if (!last) return true;
      return Date.now() - new Date(last.startedAt).getTime() >= intervalMs;
    }

    let currentJobId: string | null = null;
    const JOB_TIMEOUT_MS = 8 * 60 * 1000; // 8min (< 10min stale threshold)

    async function executeJob(job: import('../storage/models.js').JobRecord, fn: (jobId: string) => Promise<{ llmCalls: number; tokensUsed: number; phases: string[]; result: Record<string, unknown> }>, timeoutMs = JOB_TIMEOUT_MS): Promise<void> {
      currentJobId = job.id;
      const startMs = Date.now();
      let cancelled = false;

      const p = (async () => {
        try {
          const out = await fn(job.id);
          if (cancelled) return; // timeout already handled this job
          _db.updateJob(job.id, {
            status: 'completed', phases: out.phases, llmCalls: out.llmCalls,
            tokensUsed: out.tokensUsed, result: out.result,
            durationMs: Date.now() - startMs, finishedAt: new Date().toISOString(),
          });
        } catch (err) {
          if (cancelled) return;
          _db.updateJob(job.id, {
            status: 'failed', result: { error: err instanceof Error ? err.message : String(err) },
            durationMs: Date.now() - startMs, finishedAt: new Date().toISOString(),
          });
          console.error(`[daemon] Job ${job.type} failed:`, err instanceof Error ? err.message : err);
        }
      })();
      currentJobPromise = p;

      // Race the job against a timeout that kills the LLM child process
      const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), timeoutMs));
      const winner = await Promise.race([p.then(() => 'done' as const), timeout]);

      if (winner === 'timeout') {
        cancelled = true;
        killActiveChild();
        _db.updateJob(job.id, {
          status: 'failed', result: { error: `timeout (${Math.round(timeoutMs / 60000)}min)` },
          durationMs: timeoutMs, finishedAt: new Date().toISOString(),
        });
        console.error(`[daemon] Job ${job.type}/${job.id.slice(0, 8)} timed out after ${Math.round(timeoutMs / 60000)}min — killed child process`);
      }

      currentJobPromise = null;
      currentJobId = null;
    }

    // Step 5: Main loop
    while (running) {
      let worked = false;
      const tickStart = new Date();

      // Clean stale jobs every tick (catches jobs stuck by suspend/crash)
      cleanStaleJobs();

      // Reactivate snoozed suggestions whose snooze period has expired
      try {
        const { reactivateSnoozed } = await import('../suggestion/engine.js');
        const reactivated = reactivateSnoozed(_db);
        if (reactivated > 0) console.error(`[daemon] Reactivated ${reactivated} snoozed suggestions`);
      } catch { /* ignore */ }

      // Observation lifecycle: auto-expire stale + cap per repo
      try {
        const expired = _db.expireObservationsBySeverity();
        const capped = _db.capObservationsPerRepo(10);
        if (expired > 0) console.error(`[daemon] Expired ${expired} stale observations`);
        if (capped > 0) console.error(`[daemon] Capped ${capped} excess observations`);
      } catch { /* ignore */ }

      // Live phase tracking — updates daemon state file so status line can show current phase
      const setPhase = (phase: string | null) => {
        lastHeartbeatPhase = phase;
        state.lastHeartbeatPhase = phase;
        writeDaemonState(config, state);
        if (currentJobId) {
          try { _db.updateJob(currentJobId, { activity: phase }); } catch { /* best-effort */ }
        }
        eventBus.emit({ type: 'heartbeat:phase', data: { phase, jobId: currentJobId } });
      };

      // === Phase 1: Enqueue scheduled jobs ===

      // Time-based heartbeat scheduling (watcher events do NOT trigger heartbeats)
      const timeSinceLastHeartbeat = lastHeartbeatAt ? Date.now() - new Date(lastHeartbeatAt).getTime() : Infinity;
      const heartbeatInterval = consecutiveIdleTicks > 10
        ? config.activityHeartbeatMaxIntervalMs * 2  // deep idle: 60min
        : config.activityHeartbeatMaxIntervalMs;      // normal: 30min
      if (!_db.hasQueuedOrRunning('heartbeat') && timeSinceLastHeartbeat >= heartbeatInterval) {
        _db.enqueueJob('heartbeat', { priority: 10 });
      }
      if (shouldEnqueue('consolidate', 6 * 60 * 60 * 1000)) {
        _db.enqueueJob('consolidate', { priority: 3 });
      }
      if (shouldEnqueue('reflect', 24 * 60 * 60 * 1000)) {
        _db.enqueueJob('reflect', { priority: 5 });
      }

      // Remote sync: periodic git ls-remote for detecting remote changes
      if (config.remoteSyncEnabled && shouldEnqueue('remote-sync', config.remoteSyncIntervalMs)) {
        _db.enqueueJob('remote-sync', { priority: 2 });
      }

      // Context enrichment: periodic MCP-based external data gathering
      // Profile preferences override config defaults
      const profilePrefs = _db.ensureProfile().preferences as Record<string, unknown> | undefined;
      const enrichEnabled = (profilePrefs?.enrichmentEnabled as boolean | undefined) ?? config.enrichmentEnabled;
      const enrichIntervalMin = profilePrefs?.enrichmentIntervalMin as number | undefined;
      const enrichIntervalMs = enrichIntervalMin ? enrichIntervalMin * 60 * 1000 : config.enrichmentIntervalMs;
      if (enrichEnabled && shouldEnqueue('context-enrich', enrichIntervalMs)) {
        _db.enqueueJob('context-enrich', { priority: 4 });
      }

      // Digests: clock-time scheduled, timezone-aware
      const userTz = _db.ensureProfile().timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
      for (const [jobType, schedule] of Object.entries(DIGEST_SCHEDULES)) {
        if (!_db.hasQueuedOrRunning(jobType) && isScheduleReady(schedule, userTz, _db.getLastJob(jobType)?.startedAt)) {
          _db.enqueueJob(jobType, { priority: 5 });
        }
      }

      // === Phase 2: Claim and execute one job ===

      const claimed = _db.claimNextJob();
      if (claimed) {
        const jobType = claimed.type;

        if (jobType === 'heartbeat') {
          // Get last completed heartbeat for context (the claimed one is now 'running', skip it)
          const previousHeartbeat = _db.listJobs({ type: 'heartbeat', status: 'completed', limit: 1 })[0] ?? null;
          setPhase('observe');
          try {
            await executeJob(claimed, async () => {
              const profile = _db.ensureProfile();
              const pendingEvts = _db.listPendingEvents().length;

              // Detect active projects from recent interactions + conversations
              let detectedProjects: Array<{ projectId: string; projectName: string; score: number }> = [];
              try {
                const { detectActiveProjects } = await import('../heartbeat/project-detection.js');
                const { readFileSync } = await import('node:fs');
                const { resolve } = await import('node:path');
                const sinceIso = previousHeartbeat?.startedAt
                  ? previousHeartbeat.startedAt
                  : new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
                const sinceMs = new Date(sinceIso).getTime();

                // Load recent interactions
                let recentInteractions: Array<{ file: string; tool: string; ts: string }> = [];
                try {
                  const intPath = resolve(config.resolvedDataDir, 'interactions.jsonl');
                  const lines = readFileSync(intPath, 'utf8').trim().split('\n').filter(Boolean);
                  recentInteractions = lines.flatMap(line => {
                    try {
                      const e = JSON.parse(line) as { ts: string; tool: string; file?: string };
                      return new Date(e.ts).getTime() > sinceMs ? [{ ts: e.ts, tool: e.tool, file: e.file ?? '' }] : [];
                    } catch { return []; }
                  });
                } catch { /* no file */ }

                // Load recent conversations
                let recentConvTexts: Array<{ text: string }> = [];
                try {
                  const convPath = resolve(config.resolvedDataDir, 'conversations.jsonl');
                  const lines = readFileSync(convPath, 'utf8').trim().split('\n').filter(Boolean);
                  recentConvTexts = lines.flatMap(line => {
                    try {
                      const e = JSON.parse(line) as { ts: string; text?: string };
                      return new Date(e.ts).getTime() > sinceMs && e.text ? [{ text: e.text }] : [];
                    } catch { return []; }
                  });
                } catch { /* no file */ }

                detectedProjects = detectActiveProjects(_db, recentInteractions, recentConvTexts);
                if (detectedProjects.length > 0) {
                  console.error(`[daemon] Active projects: ${detectedProjects.map(p => `${p.projectName}(${p.score.toFixed(0)})`).join(', ')}`);
                }
              } catch (e) {
                console.error('[daemon] Project detection failed:', e instanceof Error ? e.message : e);
              }

              // Persist to daemon state
              state.activeProjects = detectedProjects;

              // Build enrichment context from cached MCP data
              let enrichmentCtx: string | undefined;
              try {
                const { buildEnrichmentContext } = await import('../heartbeat/enrichment.js');
                enrichmentCtx = buildEnrichmentContext(_db);
              } catch { /* enrichment not available */ }

              setPhase('analyze');
              const { runHeartbeat } = await import('../heartbeat/state-machine.js');
              // Drain sensor data for heartbeat context
              const gitEvents = pendingGitEvents.splice(0);
              const remoteSyncData = pendingRemoteSyncResults.splice(0);
              const result = await runHeartbeat({
                config, db: _db, profile, lastHeartbeat: previousHeartbeat, pendingEventCount: pendingEvts,
                pendingGitEvents: gitEvents.length > 0 ? gitEvents : undefined,
                remoteSyncResults: remoteSyncData.length > 0 ? remoteSyncData : undefined,
                enrichmentContext: enrichmentCtx,
                activeProjects: detectedProjects.length > 0 ? detectedProjects : undefined,
              });
              return {
                llmCalls: result.llmCalls, tokensUsed: result.tokensUsed, phases: result.phases,
                result: { observationsCreated: result.observationsCreated },
              };
            });
          } catch (hbErr) {
            console.error('[daemon] Heartbeat failed/timeout:', hbErr instanceof Error ? hbErr.message : hbErr);
          } finally {
            setPhase(null);
          }
          lastHeartbeatAt = new Date().toISOString();
          nextHeartbeatAt = new Date(Date.now() + config.activityHeartbeatMaxIntervalMs).toISOString();
          eventBus.emit({ type: 'heartbeat:complete', data: { jobId: claimed.id } });

          // Post-heartbeat: consolidate similar observations
          try {
            const { consolidateObservations } = await import('../observation/consolidation.js');
            const obsMerged = await consolidateObservations(_db);
            if (obsMerged > 0) console.error(`[daemon] Consolidated ${obsMerged} similar observations`);
          } catch { /* ignore */ }

          // Post-heartbeat: enqueue suggest if there was activity
          const hbJob = _db.getJob(claimed.id);
          const hbResult = (hbJob?.result ?? {}) as Record<string, number>;
          if ((hbResult.observationsCreated ?? 0) > 0) {
            const profile = _db.ensureProfile();
            if (profile.trustLevel >= 2) {
              _db.enqueueJob('suggest', { priority: 8, triggerSource: 'reactive' });
            }
          }

        } else if (jobType === 'suggest') {
          const { activitySuggest, activityNotify } = await import('../heartbeat/activities.js');
          setPhase('suggest');
          try {
            await executeJob(claimed, async () => {
              const unprocessed = _db.listObservations({ processed: false });
              const profile = _db.ensureProfile();
              const ctx = { config, db: _db, profile, lastHeartbeat: _db.getLastJob('heartbeat'), pendingEventCount: _db.listPendingEvents().length };
              const suggestResult = await activitySuggest(ctx, unprocessed);
              await activityNotify(ctx);
              return {
                llmCalls: suggestResult.llmCalls, tokensUsed: suggestResult.tokensUsed,
                phases: ['suggest', 'notify'],
                result: { suggestionsCreated: suggestResult.suggestionsCreated },
              };
            });
          } catch (sugErr) {
            console.error('[daemon] Suggest failed/timeout:', sugErr instanceof Error ? sugErr.message : sugErr);
          } finally {
            setPhase(null);
          }

        } else if (jobType === 'consolidate') {
          const { activityConsolidate } = await import('../heartbeat/activities.js');
          setPhase('consolidate');
          try {
            await executeJob(claimed, async () => {
              const profile = _db.ensureProfile();
              const ctx = { config, db: _db, profile, lastHeartbeat: _db.getLastJob('heartbeat'), pendingEventCount: _db.listPendingEvents().length };
              const consolidateResult = await activityConsolidate(ctx);
              return {
                llmCalls: consolidateResult.llmCalls, tokensUsed: consolidateResult.tokensUsed,
                phases: ['consolidate'],
                result: { memoriesPromoted: consolidateResult.memoriesPromoted, memoriesDemoted: consolidateResult.memoriesDemoted },
              };
            });
          } catch (conErr) {
            console.error('[daemon] Consolidate failed/timeout:', conErr instanceof Error ? conErr.message : conErr);
          } finally {
            setPhase(null);
          }

        } else if (jobType === 'reflect') {
          const { activityReflect } = await import('../heartbeat/activities.js');
          setPhase('reflect');
          try {
            await executeJob(claimed, async () => {
              const profile = _db.ensureProfile();
              const ctx = { config, db: _db, profile, lastHeartbeat: _db.getLastJob('heartbeat'), pendingEventCount: _db.listPendingEvents().length };
              const reflectResult = await activityReflect(ctx);
              return {
                llmCalls: reflectResult.llmCalls, tokensUsed: reflectResult.tokensUsed,
                phases: reflectResult.skipped ? ['reflect', 'skip'] : ['reflect-delta', 'reflect-evolve'],
                result: { skipped: reflectResult.skipped, ...(reflectResult.reason ? { reason: reflectResult.reason } : {}) },
              };
            });
          } catch (refErr) {
            console.error('[daemon] Reflect failed/timeout:', refErr instanceof Error ? refErr.message : refErr);
          } finally {
            setPhase(null);
          }

        } else if (jobType.startsWith('digest-')) {
          const periodStart = claimed.result.periodStart as string | undefined;
          const { activityDailyDigest, activityWeeklyDigest, activityBragDoc } = await import('../heartbeat/digests.js');
          const activities: Record<string, () => Promise<{ contentMd: string; tokensUsed: number }>> = {
            'digest-daily': () => activityDailyDigest(_db, config, periodStart),
            'digest-weekly': () => activityWeeklyDigest(_db, config, periodStart),
            'digest-brag': () => activityBragDoc(_db, config),
          };
          setPhase('digest');
          try {
            await executeJob(claimed, async () => {
              const result = await activities[jobType]();
              return { llmCalls: 1, tokensUsed: result.tokensUsed, phases: [jobType], result: { periodStart } };
            });
          } catch (e) { console.error(`[daemon] ${jobType} failed:`, e instanceof Error ? e.message : e); }
          finally { setPhase(null); }

        } else if (jobType === 'remote-sync') {
          setPhase('remote-sync');
          try {
            await executeJob(claimed, async () => {
              const { remoteSyncRepos } = await import('../observation/remote-sync.js');
              const results = remoteSyncRepos(_db, config.remoteSyncBatchSize);
              const withChanges = results.filter(r => r.newRemoteCommits > 0);
              if (withChanges.length > 0) {
                pendingRemoteSyncResults.push(...withChanges);
              }
              return {
                llmCalls: 0, tokensUsed: 0, phases: ['remote-sync'],
                result: { reposSynced: results.length, reposWithChanges: withChanges.length },
              };
            });
          } catch (e) { console.error('[daemon] Remote sync failed:', e instanceof Error ? e.message : e); }
          finally { setPhase(null); }

        } else if (jobType === 'context-enrich') {
          setPhase('enrich');
          try {
            await executeJob(claimed, async () => {
              const { activityEnrich } = await import('../heartbeat/enrichment.js');
              const result = await activityEnrich(_db, config);
              return {
                llmCalls: result.llmCalls, tokensUsed: result.tokensUsed,
                phases: ['enrich'],
                result: { itemsCollected: result.itemsCollected },
              };
            });
          } catch (e) { console.error('[daemon] Enrichment failed:', e instanceof Error ? e.message : e); }
          finally { setPhase(null); }
        }

        worked = true;
      }

      // --- Stale run detector ---
      const staleRunCandidates = _db.listRuns({ status: 'running' });
      const STALE_RUN_MS = 10 * 60 * 1000; // 10min
      for (const sr of staleRunCandidates) {
        const elapsed = sr.startedAt ? Date.now() - new Date(sr.startedAt).getTime() : 0;
        if (elapsed > STALE_RUN_MS) {
          console.error(`[daemon] Marked stale run ${sr.id.slice(0, 8)} as failed (${Math.round(elapsed / 60000)}m)`);
          _db.transitionRun(sr.id, 'failed');
          _db.updateRun(sr.id, { errorSummary: 'Stale: exceeded 10min timeout', finishedAt: new Date().toISOString() });
        }
      }

      // --- Run processing (concurrent via RunQueue) ---
      try {
        const runQueueActive = await runQueue.tick();
        if (runQueueActive) worked = true;
        state.activeRunCount = runQueue.activeCount;
      } catch (runErr) {
        console.error('[daemon] Run queue tick failed:', runErr instanceof Error ? runErr.message : runErr);
      }

      // --- Fast tick ---
      const pendingEvents = _db.listPendingEvents();
      if (pendingEvents.length > 0) {
        _db.deliverAllEvents();
        worked = true;
      }

      // Update idle tracking
      if (worked) {
        consecutiveIdleTicks = 0;
      } else {
        consecutiveIdleTicks++;
      }

      // Compute sleep duration
      const sleepMs = computeSleepMs(
        ACTIVE_SLEEP_MS,
        IDLE_SLEEP_MS,
        MAX_IDLE_SLEEP_MS,
        worked,
        consecutiveIdleTicks,
      );

      // Update and persist daemon state
      const pendingCount = _db.listPendingEvents().length;
      state.pid = process.pid;
      state.lastHeartbeatAt = lastHeartbeatAt;
      state.lastTickAt = tickStart.toISOString();
      state.nextHeartbeatAt = nextHeartbeatAt;
      state.lastHeartbeatPhase = lastHeartbeatPhase;
      state.lastConsolidationAt = lastConsolidationAt;
      state.consecutiveIdleTicks = consecutiveIdleTicks;
      state.currentSleepMs = sleepMs;
      state.pendingEventCount = pendingCount;
      state.lastActivityAt = lastActivityAt;
      state.pendingActivityCount = pendingActivityCount;
      state.watchedRepoCount = repoWatcher.watchedCount;

      // Periodically rotate watchers to pick up newly-active repos (~every 60 idle ticks ≈ 30min)
      if (consecutiveIdleTicks > 0 && consecutiveIdleTicks % 60 === 0) {
        repoWatcher.rotateWatchers();
        state.watchedRepoCount = repoWatcher.watchedCount;
      }

      writeDaemonState(config, state);

      // Sleep (interruptible by SIGTERM or watcher activity)
      await new Promise<void>((resolve, reject) => {
        sleepReject = reject;
        wakeLoop = resolve;
        setTimeout(resolve, sleepMs);
      }).catch(() => { /* interrupted by shutdown */ });
      sleepReject = null;
      wakeLoop = null;
    }
  } finally {
    // Step 6: Graceful drain — wait for current job to finish (max 60s)
    if (currentJobPromise) {
      console.error('[daemon] Draining current job (max 60s)...');
      await Promise.race([
        currentJobPromise,
        new Promise<void>(r => setTimeout(r, 60_000)),
      ]);
    }

    // Step 7: Kill any lingering child claude process + run queue
    killActiveChild();
    if (runQueueRef) try { runQueueRef.killAll(); } catch { /* cleanup */ }

    // Step 7b: Shutdown watcher + SSE
    if (repoWatcherRef) repoWatcherRef.stopAll();
    if (eventBusRef) eventBusRef.shutdown();

    // Step 8: Cleanup
    if (webServer) {
      try { webServer.close(); } catch { /* best-effort */ }
    }
    if (db) {
      try { db.close(); } catch { /* best-effort */ }
    }
    removePidFile(config);

    process.off('SIGTERM', shutdown);
    process.off('SIGINT', shutdown);
  }
}

// --- Auto-start when executed directly ---

const isDirectExecution = process.argv[1]?.includes('daemon/runtime');
if (isDirectExecution) {
  const { loadConfig } = await import('../config/load-config.js');
  const config = loadConfig();
  startDaemon(config).catch((err) => {
    console.error('Daemon failed:', err);
    process.exit(1);
  });
}
