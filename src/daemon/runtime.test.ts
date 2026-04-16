import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';

import { stopDaemon, waitForDaemonStopped, isDaemonRunning } from './runtime.js';

// Minimal ShadowConfig shape — only the fields these helpers touch.
function makeConfig(dataDir: string): any {
  return {
    resolvedDataDir: dataDir,
    resolvedDatabasePath: join(dataDir, 'shadow.db'),
  };
}

function pidPath(dataDir: string): string {
  return join(dataDir, 'daemon.pid');
}

describe('stopDaemon', () => {
  let tmpDir: string;
  const spawned: ChildProcess[] = [];

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'shadow-daemon-test-'));
  });

  after(() => {
    for (const p of spawned) {
      try { p.kill('SIGKILL'); } catch { /* best-effort */ }
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('preserves the pid file when the target process is alive', async () => {
    const child = spawn('sleep', ['30'], { stdio: 'ignore' });
    spawned.push(child);
    const dataDir = mkdtempSync(join(tmpDir, 'alive-'));
    const pf = pidPath(dataDir);
    writeFileSync(pf, String(child.pid), 'utf-8');

    const config = makeConfig(dataDir);
    const result = stopDaemon(config);

    assert.equal(result, true, 'stopDaemon returns true when SIGTERM sent');
    assert.equal(existsSync(pf), true, 'pid file must persist so isDaemonRunning does not lie during drain');
    assert.equal(readFileSync(pf, 'utf-8').trim(), String(child.pid));
  });

  it('removes the pid file when the target process is already dead', () => {
    const dataDir = mkdtempSync(join(tmpDir, 'dead-'));
    const pf = pidPath(dataDir);
    // PID 1 exists but can't be signaled by a non-root user; use a likely-free PID instead.
    // Use a PID that almost certainly doesn't exist: very high number.
    writeFileSync(pf, '999999', 'utf-8');

    const config = makeConfig(dataDir);
    const result = stopDaemon(config);

    assert.equal(result, false, 'stopDaemon returns false when target is dead');
    assert.equal(existsSync(pf), false, 'stale pid file must be cleaned up');
  });
});

describe('waitForDaemonStopped', () => {
  let tmpDir: string;
  const spawned: ChildProcess[] = [];

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'shadow-wait-test-'));
  });

  after(() => {
    for (const p of spawned) {
      try { p.kill('SIGKILL'); } catch { /* best-effort */ }
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns true quickly when the process dies mid-wait', async () => {
    const child = spawn('sleep', ['0.5'], { stdio: 'ignore' });
    spawned.push(child);
    const dataDir = mkdtempSync(join(tmpDir, 'diesmidwait-'));
    writeFileSync(pidPath(dataDir), String(child.pid), 'utf-8');

    const config = makeConfig(dataDir);
    // Sanity: daemon looks alive at the start
    assert.equal(isDaemonRunning(config), true);

    const start = Date.now();
    const stopped = await waitForDaemonStopped(config, 5_000);
    const elapsed = Date.now() - start;

    assert.equal(stopped, true, 'must return true when process exits');
    assert.ok(elapsed < 2_000, `must return within 2 s (took ${elapsed} ms)`);
  });

  it('returns false on timeout when the process stays alive', async () => {
    const child = spawn('sleep', ['30'], { stdio: 'ignore' });
    spawned.push(child);
    const dataDir = mkdtempSync(join(tmpDir, 'timeout-'));
    writeFileSync(pidPath(dataDir), String(child.pid), 'utf-8');

    const config = makeConfig(dataDir);
    const start = Date.now();
    const stopped = await waitForDaemonStopped(config, 1_000);
    const elapsed = Date.now() - start;

    assert.equal(stopped, false, 'must return false on timeout');
    assert.ok(elapsed >= 1_000 && elapsed < 2_000, `must respect timeout (took ${elapsed} ms)`);
  });
});
