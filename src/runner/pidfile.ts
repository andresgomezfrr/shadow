import { writeFileSync, readFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { log } from '../log.js';

/**
 * Per-run pidfiles (audit R-15) — adapter writes on spawn, clears on exit.
 * Stale detector reads + probes via process.kill(pid, 0) to catch runs
 * whose adapter crashed without cleanup (queue.active dropped them but
 * the DB still says 'running'). Saves waiting the full runnerTimeoutMs
 * before declaring the run stale.
 *
 * Files live under dataDir/run-pids/<runId>.pid. One line, the pid.
 */

function runPidDir(dataDir: string): string {
  return resolve(dataDir, 'run-pids');
}

export function runPidPath(dataDir: string, runId: string): string {
  return resolve(runPidDir(dataDir), `${runId}.pid`);
}

export function writeRunPid(dataDir: string, runId: string, pid: number): void {
  try {
    mkdirSync(runPidDir(dataDir), { recursive: true });
    writeFileSync(runPidPath(dataDir, runId), String(pid), 'utf-8');
  } catch (e) {
    log.error(`[pidfile] failed to write pid for run ${runId.slice(0, 8)}:`, e instanceof Error ? e.message : e);
  }
}

export function clearRunPid(dataDir: string, runId: string): void {
  try {
    unlinkSync(runPidPath(dataDir, runId));
  } catch (e) {
    const errno = (e as NodeJS.ErrnoException).code;
    if (errno !== 'ENOENT') {
      log.error(`[pidfile] failed to clear pid for run ${runId.slice(0, 8)}: ${errno ?? 'unknown'}`);
    }
  }
}

/** Returns the stored pid or null if file missing/unparseable. */
export function readRunPid(dataDir: string, runId: string): number | null {
  try {
    const raw = readFileSync(runPidPath(dataDir, runId), 'utf-8').trim();
    const pid = Number(raw);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/**
 * Non-destructive probe for whether a pid is still running. Returns true
 * if the process exists, false if it's gone. Uses kill(pid, 0) — signal 0
 * checks permission/existence without actually signaling.
 */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    const errno = (e as NodeJS.ErrnoException).code;
    // EPERM means the process exists but we can't signal it (different user)
    // — still counts as alive for our purposes. ESRCH means it's gone.
    return errno === 'EPERM';
  }
}
