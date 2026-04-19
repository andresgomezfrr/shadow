import * as fs from 'node:fs';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { resolve } from 'node:path';
import process from 'node:process';
import { promises as dns } from 'node:dns';

import type { ShadowConfig } from '../config/schema.js';
import { killAllActiveChildren } from '../backend/claude-cli.js';
import { createDatabase, ShadowDatabase } from '../storage/database.js';
import { startThoughtLoop, stopThoughtLoop } from './thought.js';
import { DIGEST_SCHEDULES, CLEANUP_SCHEDULE, isScheduleReady } from './schedules.js';
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
  networkAvailable: boolean;
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

async function isNetworkAvailable(): Promise<boolean> {
  try {
    await Promise.race([
      dns.resolve4('api.anthropic.com'),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
    ]);
    return true;
  } catch {
    return false;
  }
}

// Detects whether macOS is in full wake (display on / user active) vs darkwake.
// macOS keeps TCPKeepAlive active during darkwake, so DNS alone cannot distinguish
// the two — we need UserIsActive from pmset assertions.
// Fail-open: any error, timeout, or parse failure returns true so non-macOS hosts
// and unexpected environments keep working.
async function isSystemAwake(): Promise<boolean> {
  try {
    const { execFile } = await import('node:child_process');
    return await new Promise<boolean>((resolvePromise) => {
      const child = execFile('pmset', ['-g', 'assertions'], { timeout: 2000 }, (err, stdout) => {
        if (err) return resolvePromise(true);
        const match = stdout.match(/^\s*UserIsActive\s+(\d)/m);
        resolvePromise(match ? match[1] === '1' : true);
      });
      child.on('error', () => resolvePromise(true));
    });
  } catch {
    return true;
  }
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
    networkAvailable: true,
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
    if (isNaN(pid)) {
      removePidFile(config);
      return false;
    }

    if (!isProcessAlive(pid)) {
      removePidFile(config);
      return false;
    }

    process.kill(pid, 'SIGTERM');
    // Do NOT remove the pid file here. The daemon's own shutdown handler
    // removes it as the last step of its graceful drain (can take up to
    // 60 s due to JobQueue.drainAll). Removing it now would make
    // isDaemonRunning() return false while the process is still alive,
    // misleading any polling caller waiting for the daemon to stop.
    return true;
  } catch {
    return false;
  }
}

/**
 * Poll isDaemonRunning() until it returns false or timeoutMs elapses.
 * Returns true if the daemon stopped within the timeout, false otherwise.
 * The optional onProgress callback fires every 5 s with the elapsed seconds
 * and the last known active job count from daemon.json (null if unknown).
 */
export async function waitForDaemonStopped(
  config: ShadowConfig,
  timeoutMs: number = 30_000,
  onProgress?: (elapsedSec: number, activeJobCount: number | null) => void,
): Promise<boolean> {
  const start = Date.now();
  const deadline = start + timeoutMs;
  let lastProgressAt = start;

  while (Date.now() < deadline) {
    if (!isDaemonRunning(config)) return true;
    if (onProgress && Date.now() - lastProgressAt >= 5_000) {
      lastProgressAt = Date.now();
      const elapsedSec = Math.floor((Date.now() - start) / 1000);
      let activeJobCount: number | null = null;
      try {
        const raw = readFileSync(daemonStatePath(config), 'utf-8');
        const state = JSON.parse(raw);
        activeJobCount = typeof state?.activeJobCount === 'number' ? state.activeJobCount : null;
      } catch { /* best-effort */ }
      onProgress(elapsedSec, activeJobCount);
    }
    await sleep(250);
  }
  return false;
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

    // Step 3a: First-boot sentinel-file reset for v49 bond system.
    // Runs exactly once per data dir: creates sentinel atomically, then
    // resets bond state (memories/suggestions/runs preserved). After that,
    // subsequent restarts see the sentinel and skip.
    try {
      const sentinelPath = path.join(config.resolvedDataDir, 'bond-reset.v49.done');
      let shouldReset = false;
      try {
        const fd = fs.openSync(sentinelPath, 'wx');
        fs.writeSync(fd, new Date().toISOString() + '\n');
        fs.closeSync(fd);
        shouldReset = true;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      }
      if (shouldReset) {
        const { resetBondState } = await import('../profile/bond.js');
        resetBondState(db);
        console.error('[bond] v49 reset applied — bond starts at tier 1 (memories preserved)');
      }
    } catch (e) {
      console.error('[bond] v49 reset hook failed:', e);
    }

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
      networkAvailable: true,
      systemAwake: true,
    };

    // Step 3c: Start EventBus + web server (receives daemonShared for MCP + /api/status)
    const eventBus = new EventBus();
    try {
      const { startWebServer } = await import('../web/server.js');
      webServer = await startWebServer(3700, config.webBindHost, db, eventBus, daemonShared);
    } catch (err) {
      // A daemon without a web server is useless (no dashboard, no MCP
      // HTTP endpoint). Fail loud so the user sees it in logs, but exit
      // cleanly (code 0) so launchd's KeepAlive: { Crashed: true } does
      // NOT trigger a restart loop on a persistent error like EADDRINUSE.
      const e = err as NodeJS.ErrnoException;
      console.error(`[daemon] FATAL: web server failed to start on :3700`);
      console.error(`[daemon] ${e?.message ?? String(err)}`);
      if (e?.code === 'EADDRINUSE') {
        console.error(`[daemon] Port 3700 is already in use — likely an orphan`);
        console.error(`[daemon] from a previous shadow instance. Run:`);
        console.error(`[daemon]   shadow daemon stop && shadow daemon start`);
      }
      if (db) try { db.close(); } catch { /* best-effort */ }
      removePidFile(config);
      process.off('SIGTERM', shutdown);
      process.off('SIGINT', shutdown);
      process.exit(0);
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
      networkAvailable: true,
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
    const runQueue = new RunQueue(config, _db, eventBus);
    runQueueRef = runQueue;

    // Step 4c: Create parallel job queue (reuses daemonShared created in step 3b)
    const jobHandlers = buildHandlerRegistry();
    const jobQueue = new JobQueue(config, _db, eventBus, jobHandlers, daemonShared);
    jobQueueRef = jobQueue;

    // --- Job scheduler helpers ---

    function cleanStaleJobs(): void {
      const staleJobs = _db.listJobs({ status: 'running' });
      const staleThresholdMs = 16 * 60 * 1000; // 16min — must exceed JOB_TIMEOUT_MS (15min) so only orphaned jobs from crashes are caught, not jobs still being managed by JobQueue
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
      // Note: 'queued' runs are intentionally left untouched — RunQueue.tick() re-picks them on the next tick.
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

      // Sleep/wake gate: skip scheduling when offline or when the Mac is in darkwake.
      // DNS alone is not enough — TCPKeepAlive keeps resolution alive during darkwake,
      // so we also check pmset UserIsActive to distinguish full wake from micro-wakes.
      const [networkUp, systemAwake] = await Promise.all([
        isNetworkAvailable(),
        isSystemAwake(),
      ]);
      const canSchedule = networkUp && systemAwake;
      if (!canSchedule) {
        const reason = !networkUp ? 'no network' : 'system not fully awake (darkwake/sleep)';
        console.error(`[daemon] Skipping job scheduling — ${reason}`);
      }
      daemonShared.networkAvailable = networkUp;
      daemonShared.systemAwake = systemAwake;
      state.networkAvailable = networkUp;

      // Time-based heartbeat scheduling (watcher events do NOT trigger heartbeats)
      const timeSinceLastHeartbeat = lastHeartbeatAt ? Date.now() - new Date(lastHeartbeatAt).getTime() : Infinity;
      const heartbeatInterval = consecutiveIdleTicks > 10
        ? config.activityHeartbeatMaxIntervalMs * 2  // deep idle: 60min
        : config.activityHeartbeatMaxIntervalMs;      // normal: 30min
      if (canSchedule && !_db.hasQueuedOrRunning('heartbeat') && timeSinceLastHeartbeat >= heartbeatInterval) {
        _db.enqueueJob('heartbeat', { priority: 10 });
      }
      if (canSchedule && shouldEnqueue('consolidate', 6 * 60 * 60 * 1000)) {
        _db.enqueueJob('consolidate', { priority: 3 });
      }
      if (canSchedule && shouldEnqueue('reflect', 24 * 60 * 60 * 1000)) {
        _db.enqueueJob('reflect', { priority: 5 });
      }

      // Remote sync: periodic git ls-remote for detecting remote changes
      if (canSchedule && config.remoteSyncEnabled && shouldEnqueue('remote-sync', config.remoteSyncIntervalMs)) {
        _db.enqueueJob('remote-sync', { priority: 2 });
      }

      // PR sync: detect merge/close for runs in awaiting_pr (every 30m, only if any awaiting)
      if (canSchedule && shouldEnqueue('pr-sync', 30 * 60 * 1000)) {
        const awaitingCount = _db.listRuns({ status: 'awaiting_pr' }).length;
        if (awaitingCount > 0) {
          _db.enqueueJob('pr-sync', { priority: 3 });
        }
      }

      // Version check: periodic check for new Shadow releases (every 12h)
      if (canSchedule && shouldEnqueue('version-check', 12 * 60 * 60 * 1000)) {
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
      if (canSchedule && enrichEnabled && shouldEnqueue('context-enrich', enrichIntervalMs)) {
        _db.enqueueJob('context-enrich', { priority: 4 });
      }

      // MCP server discovery: describe servers from tool schemas (same gate as enrichment)
      if (canSchedule && enrichEnabled && shouldEnqueue('mcp-discover', 24 * 60 * 60 * 1000)) {
        _db.enqueueJob('mcp-discover', { priority: 2 });
      }

      // Suggest: reactive only (triggered by heartbeat handler when activity detected)
      // No scheduled timer — activity score determines when to suggest

      // Autonomy: auto-plan + auto-execute (periodic, only if enabled + repos configured)
      try {
        const { loadAutonomyConfig } = await import('../autonomy/rules.js');
        const autonomy = loadAutonomyConfig(_db);

        // Auto-plan: every 3h
        if (canSchedule && autonomy.planRules.enabled && autonomy.planRules.repoIds.length > 0 && shouldEnqueue('auto-plan', 3 * 60 * 60 * 1000)) {
          _db.enqueueJob('auto-plan', { priority: 4 });
        }

        // Auto-execute: every 3h, offset 1.5h from last auto-plan
        if (canSchedule && autonomy.executeRules.enabled && autonomy.executeRules.repoIds.length > 0 && shouldEnqueue('auto-execute', 3 * 60 * 60 * 1000)) {
          const lastPlan = _db.getLastJob('auto-plan');
          const elapsed = lastPlan ? Date.now() - new Date(lastPlan.startedAt).getTime() : Infinity;
          if (elapsed >= 1.5 * 60 * 60 * 1000) {
            _db.enqueueJob('auto-execute', { priority: 4 });
          }
        }
      } catch { /* autonomy module not available or config invalid — skip */ }

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
            if (canSchedule) _db.enqueueJob('digest-daily', { priority: 3, triggerSource: 'backfill', params: { periodStart: nextStr } });
          } else {
            // No gaps — normal clock scheduling for today
            if (canSchedule && isScheduleReady(DIGEST_SCHEDULES['digest-daily'], userTz, _db.getLastJob('digest-daily')?.startedAt)) {
              _db.enqueueJob('digest-daily', { priority: 5 });
            }
          }
        } else {
          // Up to date or never generated — normal scheduling
          if (canSchedule && isScheduleReady(DIGEST_SCHEDULES['digest-daily'], userTz, _db.getLastJob('digest-daily')?.startedAt)) {
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
          if (canSchedule) _db.enqueueJob('digest-weekly', { priority: 3, triggerSource: 'backfill', params: { periodStart: weekStart.toISOString().slice(0, 10) } });
        } else if (canSchedule && isScheduleReady(DIGEST_SCHEDULES['digest-weekly'], userTz, _db.getLastJob('digest-weekly')?.startedAt)) {
          _db.enqueueJob('digest-weekly', { priority: 5 });
        }
      }

      // Brag: normal scheduling only (quarterly, no backfill)
      if (canSchedule && !_db.hasQueuedOrRunning('digest-brag') && isScheduleReady(DIGEST_SCHEDULES['digest-brag'], userTz, _db.getLastJob('digest-brag')?.startedAt)) {
        _db.enqueueJob('digest-brag', { priority: 5 });
      }

      // Cleanup: daily retention purge for high-churn tables + llm_usage rollup
      if (canSchedule && !_db.hasQueuedOrRunning('cleanup') && isScheduleReady(CLEANUP_SCHEDULE, userTz, _db.getLastJob('cleanup')?.startedAt)) {
        _db.enqueueJob('cleanup', { priority: 2 });
      }

      // Suggest-deep: periodic deep scan — find the repo with highest need
      if (canSchedule) {
        const repos = _db.listRepos();
        for (const repo of repos) {
          if (_db.hasQueuedOrRunningWithParams('suggest-deep', 'repoId', repo.id)) continue;

          const lastDeep = _db.listJobs({ type: 'suggest-deep', status: 'completed', limit: 50 })
            .find(j => (j.result as Record<string, unknown>)?.repoId === repo.id);

          if (!lastDeep) continue; // first-time handled by repo-profile trigger

          const daysSince = (Date.now() - new Date(lastDeep.startedAt).getTime()) / (24 * 60 * 60 * 1000);
          const { execFileSync } = await import('node:child_process');
          let commitsSince = 0;
          try {
            const log = execFileSync('git', ['log', `--since=${lastDeep.startedAt}`, '--oneline'], { cwd: repo.path, encoding: 'utf-8', timeout: 5000, stdio: 'pipe' }).trim();
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
      // Pass canSchedule so the queue skips claiming new jobs during darkwake/offline
      // while still letting in-flight jobs complete.

      try {
        const jobsActive = await jobQueue.tick({ allowClaim: canSchedule });
        if (jobsActive) worked = true;
      } catch (jqErr) {
        console.error('[daemon] Job queue tick failed:', jqErr instanceof Error ? jqErr.message : jqErr);
      }

      // --- Stale run detector ---
      // Kills runs that exceed runnerTimeoutMs AND are no longer tracked by RunQueue.active.
      // A run present in the queue has a live adapter — it is not stale even if slow.
      // Orphaned runs (DB says 'running' but no adapter) are caught once they cross the timeout.
      const staleRunCandidates = _db.listRuns({ status: 'running' });
      for (const sr of staleRunCandidates) {
        if (runQueue.isActive(sr.id)) continue; // live in the queue — not stale
        const elapsed = sr.startedAt ? Date.now() - new Date(sr.startedAt).getTime() : 0;
        if (elapsed > config.runnerTimeoutMs) {
          const timeoutMin = Math.round(config.runnerTimeoutMs / 60000);
          console.error(`[daemon] Marked stale run ${sr.id.slice(0, 8)} as failed (${Math.round(elapsed / 60000)}m, orphaned from queue)`);
          _db.transitionRun(sr.id, 'failed');
          _db.updateRun(sr.id, {
            errorSummary: `Stale: exceeded ${timeoutMin}min timeout (orphaned from queue)`,
            finishedAt: new Date().toISOString(),
          });
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
      state.networkAvailable = networkUp;

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

// Match the exact entry-point filename so `.test.ts` files don't trigger auto-start.
const entryFile = (process.argv[1] ?? '').split('/').pop() ?? '';
const isDirectExecution = entryFile === 'runtime.ts' || entryFile === 'runtime.js';
if (isDirectExecution) {
  const { loadConfig } = await import('../config/load-config.js');
  const config = loadConfig();
  startDaemon(config).catch((err) => {
    console.error('Daemon failed:', err);
    process.exit(1);
  });
}
