import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

import type { ShadowConfig } from '../config/schema.js';
import { killActiveChild } from '../backend/claude-cli.js';
import { createDatabase, ShadowDatabase } from '../storage/database.js';
import { startThoughtLoop, stopThoughtLoop } from './thought.js';

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

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  try {
    // Step 1: Write PID file
    writePidFile(config);

    // Step 2: Create database
    db = createDatabase(config);

    // Step 3: Load profile (ensure it exists)
    db.ensureProfile();

    // Step 3b: Start web server
    try {
      const { startWebServer } = await import('../web/server.js');
      webServer = await startWebServer(3700, db);
    } catch {
      // web module not available — continue without it
    }

    // Step 4: Initialize state
    const now = new Date().toISOString();
    let consecutiveIdleTicks = 0;
    let lastHeartbeatAt: string | null = null;
    let lastHeartbeatPhase: string | null = null;
    let lastConsolidationAt: string | null = null;
    let nextHeartbeatAt: string = new Date(
      Date.now() + config.heartbeatIntervalMs,
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
    };

    writeDaemonState(config, state);

    // db is guaranteed non-null at this point (created in Step 2)
    const _db = db!;

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
        _db.updateRun(run.id, {
          status: 'failed',
          errorSummary: 'orphaned — daemon restarted',
          finishedAt: new Date().toISOString(),
        });
        console.error(`[daemon] Marked orphaned run ${run.id.slice(0, 8)} as failed (daemon restart)`);
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

    // --- Job scheduler continued ---
    function shouldRunJob(type: string, intervalMs: number): boolean {
      // Check for manual trigger files
      const triggerPath = resolve(config.resolvedDataDir, `${type}-trigger`);
      if (existsSync(triggerPath)) {
        try { unlinkSync(triggerPath); } catch { /* */ }
        return true;
      }
      const last = _db.getLastJob(type);
      if (!last) return true;
      if (last.status === 'running') return false;
      return Date.now() - new Date(last.startedAt).getTime() >= intervalMs;
    }

    let currentJobId: string | null = null;
    const JOB_TIMEOUT_MS = 8 * 60 * 1000; // 8min (< 10min stale threshold)

    async function runJobType(type: string, fn: (jobId: string) => Promise<{ llmCalls: number; tokensUsed: number; phases: string[]; result: Record<string, unknown> }>, timeoutMs = JOB_TIMEOUT_MS): Promise<void> {
      const now = new Date().toISOString();
      const job = _db.createJob({ type, startedAt: now });
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
          console.error(`[daemon] Job ${type} failed:`, err instanceof Error ? err.message : err);
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
        console.error(`[daemon] Job ${type}/${job.id.slice(0, 8)} timed out after ${Math.round(timeoutMs / 60000)}min — killed child process`);
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
      };

      // --- Job: heartbeat (extract + observe) ---
      if (shouldRunJob('heartbeat', config.heartbeatIntervalMs)) {
        const { runHeartbeat } = await import('../heartbeat/state-machine.js');
        // Get last heartbeat BEFORE creating the new job — otherwise getLastJob returns the new one
        const previousHeartbeat = _db.getLastJob('heartbeat');

        setPhase('observe');
        try {
          await runJobType('heartbeat', async () => {
            const profile = _db.ensureProfile();
            const pendingEvts = _db.listPendingEvents().length;
            setPhase('analyze');
            const result = await runHeartbeat({ config, db: _db, profile, lastHeartbeat: previousHeartbeat, pendingEventCount: pendingEvts });
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
        // Always update timestamps, even on failure
        lastHeartbeatAt = new Date().toISOString();
        nextHeartbeatAt = new Date(Date.now() + config.heartbeatIntervalMs).toISOString();
        worked = true;

        // Consolidate similar observations after heartbeat (async, non-blocking)
        try {
          const { consolidateObservations } = await import('../observation/consolidation.js');
          const obsMerged = await consolidateObservations(_db);
          if (obsMerged > 0) console.error(`[daemon] Consolidated ${obsMerged} similar observations`);
        } catch { /* ignore */ }

        // --- Job: suggest (runs right after heartbeat if there was activity) ---
        const lastHbJob = _db.getLastJob('heartbeat');
        const hbResult = (lastHbJob?.result ?? {}) as Record<string, number>;
        const hadActivity = (hbResult.observationsCreated ?? 0) > 0;
        const profile = _db.ensureProfile();
        const pendingCount = _db.countPendingSuggestions();
        if (hadActivity && profile.trustLevel >= 2 && pendingCount < 30) {
          const { activitySuggest, activityNotify } = await import('../heartbeat/activities.js');
          setPhase('suggest');
          try {
            await runJobType('suggest', async () => {
              const unprocessed = _db.listObservations({ processed: false });
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
        }
      }

      // --- Job: consolidate (every 6h) ---
      if (shouldRunJob('consolidate', 6 * 60 * 60 * 1000)) {
        const { activityConsolidate } = await import('../heartbeat/activities.js');
        setPhase('consolidate');
        try {
          await runJobType('consolidate', async () => {
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
        worked = true;
      }

      // --- Job: reflect (every 24h) ---
      if (shouldRunJob('reflect', 24 * 60 * 60 * 1000)) {
        const { activityReflect } = await import('../heartbeat/activities.js');
        setPhase('reflect');
        try {
          await runJobType('reflect', async () => {
            const profile = _db.ensureProfile();
            const ctx = { config, db: _db, profile, lastHeartbeat: _db.getLastJob('heartbeat'), pendingEventCount: _db.listPendingEvents().length };
            const reflectResult = await activityReflect(ctx);
            return {
              llmCalls: reflectResult.llmCalls, tokensUsed: reflectResult.tokensUsed,
              phases: ['reflect'],
              result: {},
            };
          });
        } catch (refErr) {
          console.error('[daemon] Reflect failed/timeout:', refErr instanceof Error ? refErr.message : refErr);
        } finally {
          setPhase(null);
        }
        worked = true;
      }

      // --- Job: digest-daily (every 24h or on-demand) ---
      if (shouldRunJob('digest-daily', 24 * 60 * 60 * 1000)) {
        const { activityDailyDigest } = await import('../heartbeat/digests.js');
        setPhase('digest');
        try {
          await runJobType('digest-daily', async () => {
            const result = await activityDailyDigest(_db, config);
            return { llmCalls: 1, tokensUsed: result.tokensUsed, phases: ['digest-daily'], result: {} };
          });
        } catch (e) { console.error('[daemon] Daily digest failed:', e instanceof Error ? e.message : e); }
        finally { setPhase(null); }
        worked = true;
      }

      // --- Job: digest-weekly (every 7d or on-demand) ---
      if (shouldRunJob('digest-weekly', 7 * 24 * 60 * 60 * 1000)) {
        const { activityWeeklyDigest } = await import('../heartbeat/digests.js');
        setPhase('digest');
        try {
          await runJobType('digest-weekly', async () => {
            const result = await activityWeeklyDigest(_db, config);
            return { llmCalls: 1, tokensUsed: result.tokensUsed, phases: ['digest-weekly'], result: {} };
          });
        } catch (e) { console.error('[daemon] Weekly digest failed:', e instanceof Error ? e.message : e); }
        finally { setPhase(null); }
        worked = true;
      }

      // --- Job: digest-brag (every 7d or on-demand) ---
      if (shouldRunJob('digest-brag', 7 * 24 * 60 * 60 * 1000)) {
        const { activityBragDoc } = await import('../heartbeat/digests.js');
        setPhase('digest');
        try {
          await runJobType('digest-brag', async () => {
            const result = await activityBragDoc(_db, config);
            return { llmCalls: 1, tokensUsed: result.tokensUsed, phases: ['digest-brag'], result: {} };
          });
        } catch (e) { console.error('[daemon] Brag doc failed:', e instanceof Error ? e.message : e); }
        finally { setPhase(null); }
        worked = true;
      }

      // --- Stale run detector ---
      const staleRunCandidates = _db.listRuns({ status: 'running' });
      const STALE_RUN_MS = 10 * 60 * 1000; // 10min
      for (const sr of staleRunCandidates) {
        const elapsed = sr.startedAt ? Date.now() - new Date(sr.startedAt).getTime() : 0;
        if (elapsed > STALE_RUN_MS) {
          console.error(`[daemon] Marked stale run ${sr.id.slice(0, 8)} as failed (${Math.round(elapsed / 60000)}m)`);
          _db.updateRun(sr.id, { status: 'failed', errorSummary: 'Stale: exceeded 10min timeout', finishedAt: new Date().toISOString() });
        }
      }

      // --- Run processing ---
      const queuedRuns = _db.listRuns({ status: 'queued' });
      if (queuedRuns.length > 0) {
        try {
          const { RunnerService } = await import('../runner/service.js');
          const runner = new RunnerService(config, _db);
          const runTimeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), JOB_TIMEOUT_MS));
          const runResult = await Promise.race([
            runner.processNextRun().then(() => 'done' as const),
            runTimeout,
          ]);
          if (runResult === 'timeout') {
            killActiveChild();
            console.error('[daemon] Run processing timed out — killed child process');
          }
          worked = true;
        } catch (runErr) {
          console.error('[daemon] Run processing failed:', runErr instanceof Error ? runErr.message : runErr);
        }
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

      writeDaemonState(config, state);

      // Sleep (interruptible by SIGTERM)
      await new Promise<void>((resolve, reject) => {
        sleepReject = reject;
        setTimeout(resolve, sleepMs);
      }).catch(() => { /* interrupted by shutdown */ });
      sleepReject = null;
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

    // Step 7: Kill any lingering child claude process
    killActiveChild();

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
