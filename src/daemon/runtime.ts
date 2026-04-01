import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

import type { ShadowConfig } from '../config/schema.js';
import { createDatabase, ShadowDatabase } from '../storage/database.js';

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

  const shutdown = () => {
    running = false;
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
      await startWebServer(3700, db);
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
    };

    writeDaemonState(config, state);

    // Step 5: Main loop
    while (running) {
      let worked = false;
      const tickStart = new Date();

      // --- Heartbeat tick ---
      const heartbeatDue =
        nextHeartbeatAt && new Date(nextHeartbeatAt) <= tickStart;

      if (heartbeatDue) {
        try {
          const { runHeartbeat } = await import(
            '../heartbeat/state-machine.js'
          );
          const profile = db.ensureProfile();
          const lastHb = db.getLastHeartbeat();
          const pendingEvents = db.listPendingEvents().length;
          const result = await runHeartbeat({
            config,
            db,
            profile,
            lastHeartbeat: lastHb,
            pendingEventCount: pendingEvents,
          });
          lastHeartbeatAt = new Date().toISOString();
          lastHeartbeatPhase = null; // Reset — heartbeat is done, back to idle
          worked = true;
        } catch {
          // heartbeat module not yet implemented or runtime error
        }
        nextHeartbeatAt = new Date(
          Date.now() + config.heartbeatIntervalMs,
        ).toISOString();
      }

      // --- Fast tick ---

      // Deliver pending events
      const pendingEvents = db.listPendingEvents();
      if (pendingEvents.length > 0) {
        db.deliverAllEvents();
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
      const pendingCount = db.listPendingEvents().length;
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

      // Sleep
      await sleep(sleepMs);
    }
  } finally {
    // Step 6: Cleanup
    if (db) {
      try {
        db.close();
      } catch {
        // best-effort
      }
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
