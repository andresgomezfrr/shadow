import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

import type { ShadowConfig } from '../config/schema.js';
import { killAllActiveChildren } from '../backend/claude-cli.js';
import { createDatabase, ShadowDatabase } from '../storage/database.js';
import { startThoughtLoop, stopThoughtLoop } from './thought.js';
import { DIGEST_SCHEDULES, isScheduleReady } from './schedules.js';
import { EventBus } from '../web/event-bus.js';
import { RepoWatcher } from '../observation/repo-watcher.js';
import { RunQueue } from '../runner/queue.js';
import { JobQueue } from './job-queue.js';
import { buildHandlerRegistry } from './job-handlers.js';
import type { DaemonSharedState } from './job-handlers.js';

// --- Types ---

export type DaemonState = {
  pid: number | null;
  startedAt: string | null;
  lastHeartbeatAt: string | null;
  lastTickAt: string | null;
  nextHeartbeatAt: string | null;
  lastHeartbeatPhase: string | null; // backward compat — derived from activeJobs
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
  activeJobCount: number;
  activeJobs: Array<{ jobId: string; type: string; phase: string | null }>;
  activeProjects: Array<{ projectId: string; projectName: string; score: number }>;
  updateAvailable: { latest: string; current: string } | null;
  alerts: Array<{ id: string; message: string; severity: 'info' | 'warning' | 'critical'; since: string; acked: boolean }>;
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
    activeJobCount: 0,
    activeJobs: [],
    activeProjects: [],
    updateAvailable: null,
    alerts: [],
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
  let draining = false;
  let db: ShadowDatabase | null = null;
  let webServer: { close: () => void } | null = null;
  let sleepReject: (() => void) | null = null;

  const shutdown = () => {
    running = false;
    draining = true;
    stopThoughtLoop();
    if (sleepReject) sleepReject();
  };

  let repoWatcherRef: RepoWatcher | null = null;
  let eventBusRef: EventBus | null = null;
  let runQueueRef: RunQueue | null = null;
  let jobQueueRef: JobQueue | null = null;

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  try {
    // Step 1: Write PID file
    writePidFile(config);

    // Step 2: Create database
    db = createDatabase(config);

    // Step 3: Load profile (ensure it exists)
    db.ensureProfile();

    // Step 3b: Initialize shared state arrays + DaemonSharedState (needed by web server)
    const pendingGitEvents: Array<{ repoId: string; repoName: string; type: string; ts: string }> = [];
    let pendingRemoteSyncResults: Array<{ repoId: string; repoName: string; newRemoteCommits: number; behindBranches: Array<{ branch: string; behind: number; ahead: number }>; newCommitMessages: string[] }> = [];

    const daemonShared: DaemonSharedState = {
      get draining() { return draining; },
      set draining(v: boolean) { draining = v; },
      lastHeartbeatAt: null,
      nextHeartbeatAt: new Date(Date.now() + config.activityHeartbeatMaxIntervalMs).toISOString(),
      lastConsolidationAt: null,
      pendingGitEvents,
      pendingRemoteSyncResults,
      activeProjects: [],
      consecutiveIdleTicks: 0,
      consecutiveGhostJobs: 0,
      lastGhostHint: null,
    };

    // Step 3c: Start EventBus + web server (receives daemonShared for MCP + /api/status)
    const eventBus = new EventBus();
    try {
      const { startWebServer } = await import('../web/server.js');
      webServer = await startWebServer(3700, config.webBindHost, db, eventBus, daemonShared);
    } catch {
      // web module not available — continue without it
    }

    // Step 3d: Start filesystem watcher
    const repoWatcher = new RepoWatcher(config, db);
    let pendingActivityCount = 0; // display-only counter for dashboard
    let lastActivityAt: string | null = null;

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
    let lastConsolidationAt: string | null = null;
    let nextHeartbeatAt: string = daemonShared.nextHeartbeatAt!;

    const state: DaemonState = {
      pid: process.pid,
      startedAt: now,
      lastHeartbeatAt,
      lastTickAt: null,
      nextHeartbeatAt,
      lastHeartbeatPhase: null,
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
      activeJobCount: 0,
      activeJobs: [],
      activeProjects: [],
      updateAvailable: null,
      alerts: [],
    };

    writeDaemonState(config, state);

    // db is guaranteed non-null at this point (created in Step 2)
    const _db = db!;

    // Seed timestamps from last completed jobs (avoids immediate re-enqueue on restart)
    lastHeartbeatAt = _db.getLastJob('heartbeat')?.startedAt ?? null;
    lastConsolidationAt = _db.getLastJob('consolidate')?.startedAt ?? null;
    daemonShared.lastHeartbeatAt = lastHeartbeatAt;
    daemonShared.lastConsolidationAt = lastConsolidationAt;

    // Step 4b: Create concurrent run queue (after _db is assigned)
    const runQueue = new RunQueue(config, _db);
    runQueueRef = runQueue;

    // Step 4c: Create parallel job queue (reuses daemonShared created in step 3b)
    const jobHandlers = buildHandlerRegistry();
    const jobQueue = new JobQueue(config, _db, eventBus, jobHandlers, daemonShared);
    jobQueueRef = jobQueue;

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
          result: { ...job.result, error: 'orphaned — daemon restarted' },
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

      // Sync shared state from job handlers BEFORE enqueue decisions
      lastHeartbeatAt = daemonShared.lastHeartbeatAt ?? lastHeartbeatAt;
      nextHeartbeatAt = daemonShared.nextHeartbeatAt ?? nextHeartbeatAt;
      lastConsolidationAt = daemonShared.lastConsolidationAt ?? lastConsolidationAt;

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

      // Version check: periodic check for new Shadow releases (every 12h)
      if (shouldEnqueue('version-check', 12 * 60 * 60 * 1000)) {
        _db.enqueueJob('version-check', { priority: 1 });
      }

      // Repo profiling: now reactive (triggered by remote-sync when changes detected)
      // Manual trigger still available via /api/jobs/trigger/repo-profile

      // Context enrichment: periodic MCP-based external data gathering
      // Profile preferences override config defaults
      const profilePrefs = _db.ensureProfile().preferences as Record<string, unknown> | undefined;
      const enrichEnabled = (profilePrefs?.enrichmentEnabled as boolean | undefined) ?? config.enrichmentEnabled;
      const enrichIntervalMin = profilePrefs?.enrichmentIntervalMin as number | undefined;
      const enrichIntervalMs = enrichIntervalMin ? enrichIntervalMin * 60 * 1000 : config.enrichmentIntervalMs;
      if (enrichEnabled && shouldEnqueue('context-enrich', enrichIntervalMs)) {
        _db.enqueueJob('context-enrich', { priority: 4 });
      }

      // MCP server discovery: describe servers from tool schemas (same gate as enrichment)
      if (enrichEnabled && shouldEnqueue('mcp-discover', 24 * 60 * 60 * 1000)) {
        _db.enqueueJob('mcp-discover', { priority: 2 });
      }

      // Suggest: reactive only (triggered by heartbeat handler when activity detected)
      // No scheduled timer — activity score determines when to suggest

      // Digests: clock-time scheduled, timezone-aware, with backfill for missed days
      const userTz = _db.ensureProfile().timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
      const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: userTz }); // YYYY-MM-DD

      // Daily backfill: check for missed days
      if (!_db.hasQueuedOrRunning('digest-daily')) {
        const lastDaily = _db.getLatestDigest('daily');
        const lastDate = lastDaily?.periodStart;

        if (lastDate && lastDate < todayStr) {
          const next = new Date(lastDate);
          next.setDate(next.getDate() + 1);
          const nextStr = next.toISOString().slice(0, 10);

          if (nextStr < todayStr) {
            // Backfill a missed day (one per tick, catches up over multiple ticks)
            _db.enqueueJob('digest-daily', { priority: 3, triggerSource: 'backfill', params: { periodStart: nextStr } });
          } else {
            // No gaps — normal clock scheduling for today
            if (isScheduleReady(DIGEST_SCHEDULES['digest-daily'], userTz, _db.getLastJob('digest-daily')?.startedAt)) {
              _db.enqueueJob('digest-daily', { priority: 5 });
            }
          }
        } else {
          // Up to date or never generated — normal scheduling
          if (isScheduleReady(DIGEST_SCHEDULES['digest-daily'], userTz, _db.getLastJob('digest-daily')?.startedAt)) {
            _db.enqueueJob('digest-daily', { priority: 5 });
          }
        }
      }

      // Weekly backfill: check if last week's digest is missing
      if (!_db.hasQueuedOrRunning('digest-weekly')) {
        const lastWeekly = _db.getLatestDigest('weekly');
        const nowTz = new Date(new Date().toLocaleString('en-US', { timeZone: userTz }));
        // Last Sunday = start of current week (or today if Sunday)
        const thisSunday = new Date(nowTz);
        thisSunday.setDate(thisSunday.getDate() - thisSunday.getDay());
        // Previous Sunday = start of last week
        const prevSunday = new Date(thisSunday);
        prevSunday.setDate(prevSunday.getDate() - 7);
        const prevSundayStr = prevSunday.toISOString().slice(0, 10);

        // Backfill if no weekly covers last week (periodEnd >= prevSunday+6)
        const lastWeekCovered = lastWeekly && lastWeekly.periodEnd >= prevSundayStr;
        if (!lastWeekCovered && nowTz.getDay() !== 0) {
          // Missing last week's digest and it's not Sunday yet (avoid racing with normal schedule)
          const weekStart = new Date(prevSunday);
          _db.enqueueJob('digest-weekly', { priority: 3, triggerSource: 'backfill', params: { periodStart: weekStart.toISOString().slice(0, 10) } });
        } else if (isScheduleReady(DIGEST_SCHEDULES['digest-weekly'], userTz, _db.getLastJob('digest-weekly')?.startedAt)) {
          _db.enqueueJob('digest-weekly', { priority: 5 });
        }
      }

      // Brag: normal scheduling only (quarterly, no backfill)
      if (!_db.hasQueuedOrRunning('digest-brag') && isScheduleReady(DIGEST_SCHEDULES['digest-brag'], userTz, _db.getLastJob('digest-brag')?.startedAt)) {
        _db.enqueueJob('digest-brag', { priority: 5 });
      }

      // Suggest-deep: periodic deep scan — find the repo with highest need
      if (!_db.hasQueuedOrRunning('suggest-deep')) {
        const repos = _db.listRepos();
        for (const repo of repos) {
          const lastDeep = _db.listJobs({ type: 'suggest-deep', status: 'completed', limit: 50 })
            .find(j => (j.result as Record<string, unknown>)?.repoId === repo.id);

          if (!lastDeep) continue; // first-time handled by repo-profile trigger

          const daysSince = (Date.now() - new Date(lastDeep.startedAt).getTime()) / (24 * 60 * 60 * 1000);
          const { execSync } = await import('node:child_process');
          let commitsSince = 0;
          try {
            const log = execSync(`git log --since="${lastDeep.startedAt}" --oneline`, { cwd: repo.path, encoding: 'utf-8', timeout: 5000, stdio: 'pipe' }).trim();
            commitsSince = log ? log.split('\n').length : 0;
          } catch { /* ignore */ }

          const isDormant = commitsSince === 0 && daysSince >= config.suggestDeepDormantThresholdDays;
          const maxDays = isDormant ? config.suggestDeepDormantIntervalDays : config.suggestDeepActiveIntervalDays;

          if (commitsSince >= config.suggestDeepMinCommits || daysSince >= maxDays) {
            _db.enqueueJob('suggest-deep', { priority: 6, params: { repoId: repo.id } });
            break; // one at a time
          }
        }
      }

      // === Phase 2: Parallel job execution via JobQueue ===

      try {
        const jobsActive = await jobQueue.tick();
        if (jobsActive) worked = true;
      } catch (jqErr) {
        console.error('[daemon] Job queue tick failed:', jqErr instanceof Error ? jqErr.message : jqErr);
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

      daemonShared.consecutiveIdleTicks = consecutiveIdleTicks;

      // Update and persist daemon state
      const pendingCount = _db.listPendingEvents().length;
      state.pid = process.pid;
      state.lastHeartbeatAt = lastHeartbeatAt;
      state.lastTickAt = tickStart.toISOString();
      state.nextHeartbeatAt = nextHeartbeatAt;
      state.lastConsolidationAt = lastConsolidationAt;
      state.consecutiveIdleTicks = consecutiveIdleTicks;
      state.currentSleepMs = sleepMs;
      state.pendingEventCount = pendingCount;
      state.lastActivityAt = lastActivityAt;
      state.pendingActivityCount = pendingActivityCount;
      pendingActivityCount = 0;
      state.watchedRepoCount = repoWatcher.watchedCount;
      state.activeJobCount = jobQueue.activeCount;
      state.activeJobs = jobQueue.activeJobs;
      state.activeProjects = daemonShared.activeProjects;

      // Process alert actions from MCP/external tools
      const alertActionsPath = resolve(config.resolvedDataDir, 'alert-actions.jsonl');
      try {
        if (existsSync(alertActionsPath)) {
          const raw = readFileSync(alertActionsPath, 'utf-8').trim();
          if (raw) {
            for (const line of raw.split('\n')) {
              try {
                const action = JSON.parse(line) as { action: string; id: string };
                const idx = state.alerts.findIndex(a => a.id === action.id);
                if (idx === -1) continue;
                if (action.action === 'ack') {
                  state.alerts[idx].acked = true;
                  console.error(`[daemon] Alert acked: ${action.id}`);
                } else if (action.action === 'resolve') {
                  state.alerts.splice(idx, 1);
                  console.error(`[daemon] Alert resolved: ${action.id}`);
                }
              } catch { /* skip malformed line */ }
            }
          }
          unlinkSync(alertActionsPath);
        }
      } catch { /* best-effort */ }

      // Manage alerts based on daemon health signals
      const GHOST_JOB_THRESHOLD = 2;
      const existingBackendAlert = state.alerts.findIndex(a => a.id === 'backend_unhealthy');
      if (daemonShared.consecutiveGhostJobs >= GHOST_JOB_THRESHOLD && existingBackendAlert === -1) {
        const hint = daemonShared.lastGhostHint;
        state.alerts.push({
          id: 'backend_unhealthy',
          message: hint ? `LLM jobs failing — ${hint}` : 'LLM jobs failing — unknown cause',
          severity: 'critical',
          since: new Date().toISOString(),
          acked: false,
        });
        console.error(`[daemon] Alert raised: backend_unhealthy (${daemonShared.consecutiveGhostJobs} consecutive ghost jobs)`);
      } else if (daemonShared.consecutiveGhostJobs === 0 && existingBackendAlert !== -1) {
        state.alerts.splice(existingBackendAlert, 1);
        console.error('[daemon] Alert cleared: backend_unhealthy — LLM jobs recovering');
      }

      // Derive lastHeartbeatPhase from the highest-priority active job
      // For heartbeat: use phase directly (observe, analyze, etc.)
      // For other jobs: use "type" or "type-phase" to distinguish in status line
      if (state.activeJobs.length > 0) {
        const top = state.activeJobs[0]; // already sorted by claim priority
        if (top.type === 'heartbeat') {
          state.lastHeartbeatPhase = top.phase;
        } else if (top.phase && top.phase !== top.type) {
          state.lastHeartbeatPhase = `${top.type}-${top.phase}`;
        } else {
          state.lastHeartbeatPhase = top.type;
        }
      } else {
        state.lastHeartbeatPhase = null;
      }

      // Derive updateAvailable from latest version-check job + create info alert
      const lastVersionCheck = _db.getLastJob('version-check');
      if (lastVersionCheck?.status === 'completed') {
        const vcResult = lastVersionCheck.result as Record<string, unknown> | null;
        if (vcResult?.isNewer === true) {
          state.updateAvailable = { latest: vcResult.latestVersion as string, current: vcResult.currentVersion as string };
          const existingUpdateAlert = state.alerts.findIndex(a => a.id === 'update_available');
          if (existingUpdateAlert === -1) {
            state.alerts.push({
              id: 'update_available',
              message: `New version available: ${vcResult.latestVersion} (current: ${vcResult.currentVersion})`,
              severity: 'info',
              since: lastVersionCheck.finishedAt ?? new Date().toISOString(),
              acked: false,
            });
          }
        } else {
          state.updateAvailable = null;
          // Clear version alert if no longer applicable
          const existingUpdateAlert = state.alerts.findIndex(a => a.id === 'update_available');
          if (existingUpdateAlert !== -1) state.alerts.splice(existingUpdateAlert, 1);
        }
      }

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
    // Step 6: Graceful drain — wait for active jobs + runs to finish (max 60s)
    if (jobQueueRef) {
      try { await jobQueueRef.drainAll(60_000); } catch { /* timeout */ }
    }

    // Step 7: Kill any lingering child processes
    if (jobQueueRef) try { jobQueueRef.killAll(); } catch { /* cleanup */ }
    if (runQueueRef) try { runQueueRef.killAll(); } catch { /* cleanup */ }
    killAllActiveChildren(); // safety net

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
