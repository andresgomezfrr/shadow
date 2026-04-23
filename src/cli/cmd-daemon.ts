import type { Command } from 'commander';
import type { ShadowConfig } from '../config/load-config.js';
import type { WithDb } from './types.js';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { printOutput } from './output.js';
import { JOB_TYPES } from '../daemon/job-types.js';
import { log } from '../log.js';

function parseLatestSemver(tagOutput: string): string | null {
  const tags = tagOutput
    .split('\n')
    .map(t => t.trim())
    .filter(t => /^v\d+\.\d+\.\d+$/.test(t));
  if (tags.length === 0) return null;
  tags.sort((a, b) => {
    const pa = a.slice(1).split('.').map(Number);
    const pb = b.slice(1).split('.').map(Number);
    return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2];
  });
  return tags[tags.length - 1];
}

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Detect if running from compiled dist/ or source src/ and return the right daemon command */
function resolveDaemonRunner(): { command: string; args: string[]; cwd: string } {
  const shadowSrcDir = resolve(__dirname, '..');
  const projectRoot = resolve(shadowSrcDir, '..');
  const runtimeTs = join(shadowSrcDir, 'daemon', 'runtime.ts');
  const runtimeJs = join(shadowSrcDir, 'daemon', 'runtime.js');

  if (existsSync(runtimeTs) && !__dirname.includes('/dist/')) {
    // Dev mode: run .ts via tsx
    return {
      command: resolve(projectRoot, 'node_modules', '.bin', 'tsx'),
      args: [runtimeTs],
      cwd: projectRoot,
    };
  }
  // Production: run compiled .js via node
  return {
    command: process.execPath,
    args: [runtimeJs],
    cwd: projectRoot,
  };
}

/**
 * Poll `launchctl list | grep -q com.shadow.daemon` until grep exits
 * non-zero (service unloaded). Returns true on unload, false on timeout.
 *
 * `launchctl list LABEL` and `launchctl print` both return exit 0 even for
 * nonexistent services (error to stderr only), so we pipe to grep which
 * gives a reliable binary signal.
 */
async function waitForLaunchdUnload(
  execSync: typeof import('node:child_process').execSync,
  timeoutMs: number = 5_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      execSync('launchctl list | grep -q com.shadow.daemon', { stdio: 'pipe' });
      // grep exit 0 → still loaded
      await new Promise(r => setTimeout(r, 200));
    } catch {
      // grep exit non-0 → not loaded
      return true;
    }
  }
  return false;
}

type StopResult = 'not_running' | 'graceful' | 'forced';

type ActiveJobBrief = { type: string; phase: string | null };
type DaemonSnapshot = { jobCount: number; runCount: number; jobs: ActiveJobBrief[] };

/**
 * Read the live-ish snapshot from `daemon.json`. Note: the file stops updating
 * once the daemon enters its drain phase, so the jobs/runs listed here are
 * accurate up to the last tick before shutdown — good enough for "here's what
 * was running when you pressed stop" but not real-time.
 */
function readDaemonSnapshot(config: ShadowConfig): DaemonSnapshot {
  try {
    const raw = readFileSync(resolve(config.resolvedDataDir, 'daemon.json'), 'utf-8');
    const state = JSON.parse(raw) as {
      activeJobCount?: unknown;
      activeRunCount?: unknown;
      activeJobs?: unknown;
    };
    const jobCount = typeof state?.activeJobCount === 'number' ? state.activeJobCount : 0;
    const runCount = typeof state?.activeRunCount === 'number' ? state.activeRunCount : 0;
    const jobs: ActiveJobBrief[] = Array.isArray(state?.activeJobs)
      ? (state.activeJobs as Array<Record<string, unknown>>)
          .map((j) => ({
            type: typeof j.type === 'string' ? j.type : 'unknown',
            phase: typeof j.phase === 'string' ? j.phase : null,
          }))
      : [];
    return { jobCount, runCount, jobs };
  } catch {
    return { jobCount: 0, runCount: 0, jobs: [] };
  }
}

/**
 * Count claude child processes currently alive for this daemon. This is the
 * real signal during drain — daemon.json stops updating while shutting down,
 * but pgrep against the running process table stays accurate.
 */
function countClaudeChildren(): number {
  try {
    const { execSync } = require('node:child_process');
    const result: string = execSync(
      'pgrep -cf "claude.*--allowedTools.*mcp__shadow"',
      { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' as const },
    );
    return parseInt(result.trim(), 10) || 0;
  } catch {
    // pgrep exits 1 when no matches — expected, just means 0.
    return 0;
  }
}

/**
 * Run `launchctl bootout` asynchronously (via spawn), polling daemon.json every
 * 2s in parallel so the CLI can show live drain progress. execSync would block
 * the event loop during the entire 65s graceful drain, making the CLI look
 * frozen. stdio is ignored to avoid pipe-buffer lock-ups.
 */
async function bootoutLaunchdAsync(opts: {
  plistPath: string;
  config: ShadowConfig;
  log?: (msg: string) => void;
}): Promise<void> {
  const { spawn } = await import('node:child_process');
  const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
  const started = Date.now();

  return new Promise<void>((resolveP) => {
    const child = spawn('launchctl', ['bootout', `gui/${uid}`, opts.plistPath], { stdio: 'ignore' });

    const interval = opts.log
      ? setInterval(() => {
          const elapsedSec = Math.floor((Date.now() - started) / 1000);
          const snap = readDaemonSnapshot(opts.config);
          const children = countClaudeChildren();
          const parts: string[] = [];
          if (snap.jobCount > 0) parts.push(`${snap.jobCount} job(s)`);
          if (snap.runCount > 0) parts.push(`${snap.runCount} run(s)`);
          if (children > 0) parts.push(`${children} claude child${children === 1 ? '' : 'ren'}`);
          const detail = parts.length > 0 ? ` — ${parts.join(', ')}` : '';
          opts.log!(`  draining (${elapsedSec}s)${detail}…`);
        }, 2_000)
      : null;

    const done = () => {
      if (interval) clearInterval(interval);
      resolveP();
    };
    child.on('close', done);
    child.on('error', done);
  });
}

async function gracefulStopDaemon(opts: {
  config: ShadowConfig;
  execSync: typeof import('node:child_process').execSync;
  plistPath: string;
  drainTimeoutMs?: number;
  log?: (msg: string) => void;
}): Promise<StopResult> {
  const { config, execSync, plistPath, drainTimeoutMs = 65_000, log } = opts;
  const { stopDaemon, isDaemonRunning, waitForDaemonStopped } = await import('../daemon/runtime.js');

  // Capture initial state so we can tell "was never running" from
  // "running but stopped during bootout" (fast graceful drain via
  // launchd's own SIGTERM).
  const wasRunning = isDaemonRunning(config);

  // 1. Unload launchd FIRST so KeepAlive cannot respawn mid-shutdown.
  //    (Harmless if the plist isn't loaded or doesn't exist.)
  if (existsSync(plistPath)) {
    // Pre-drain snapshot so the user sees scope before the bootout blocks.
    // daemon.json is accurate up to the last tick; claude child count is
    // live from the process table.
    if (log && wasRunning) {
      const snap = readDaemonSnapshot(config);
      const children = countClaudeChildren();
      const inventory: string[] = [];
      if (snap.jobs.length > 0) {
        const jobList = snap.jobs.map(j => j.phase ? `${j.type}/${j.phase}` : j.type).join(', ');
        inventory.push(`${snap.jobs.length} job(s): ${jobList}`);
      } else if (snap.jobCount > 0) {
        inventory.push(`${snap.jobCount} job(s)`);
      }
      if (snap.runCount > 0) inventory.push(`${snap.runCount} run(s)`);
      if (children > 0) inventory.push(`${children} claude child${children === 1 ? '' : 'ren'}`);
      if (inventory.length > 0) {
        log(`  active at shutdown: ${inventory.join(' + ')}`);
        log(`  graceful drain up to ${Math.round(drainTimeoutMs / 1000)}s…`);
      } else {
        log(`  no active work — stop should be near-instant`);
      }
    }
    await bootoutLaunchdAsync({ plistPath, config, log });
    await waitForLaunchdUnload(execSync, 5_000);
  }

  // 2. Not running after bootout → decide between "was never running"
  //    and "ran, then exited cleanly via launchd's SIGTERM".
  if (!isDaemonRunning(config)) {
    return wasRunning ? 'graceful' : 'not_running';
  }

  // 3. Still alive (tsx orphan, or no launchd, or long drain). Send SIGTERM
  //    directly to the pid in the file.
  stopDaemon(config);

  // 4. Wait for graceful drain, reporting progress every 5 s.
  const stopped = await waitForDaemonStopped(config, drainTimeoutMs, (elapsedSec, jobCount) => {
    if (!log) return;
    if (jobCount !== null && jobCount > 0) {
      log(`waiting for ${jobCount} job(s) to drain (${elapsedSec}s elapsed)…`);
    } else {
      log(`waiting for daemon to stop (${elapsedSec}s elapsed)…`);
    }
  });
  if (stopped) return 'graceful';

  // 5. Graceful timeout exceeded — force-kill everything.
  if (log) log('graceful timeout exceeded — force-killing');
  try { execSync('pkill -9 -f "shadow/.*daemon/runtime"', { stdio: 'pipe' }); } catch { /* ok */ }
  try { execSync('pkill -9 -f "claude.*--allowedTools.*mcp__shadow"', { stdio: 'pipe' }); } catch { /* ok */ }
  try { execSync('lsof -ti :3700 | xargs kill -9', { stdio: 'pipe' }); } catch { /* ok */ }
  await new Promise(r => setTimeout(r, 500));
  return 'forced';
}

export function registerDaemonCommands(program: Command, config: ShadowConfig, withDb: WithDb): void {
  // --- daemon ---

  const daemon = program.command('daemon').description('manage the background daemon');

  daemon
    .command('start')
    .description('start the background daemon')
    .action(async () => {
      const { execSync } = await import('node:child_process');
      const json = Boolean(program.opts().json);

      // Linux (systemd): delegate to systemctl --user. Audit C-01.
      if (process.platform === 'linux') {
        const { SYSTEMD_UNIT_PATH } = await import('./systemd.js');
        if (existsSync(SYSTEMD_UNIT_PATH)) {
          try {
            execSync('systemctl --user start shadow-daemon.service', { stdio: 'pipe' });
            printOutput({ ok: true, message: 'daemon started via systemd --user' }, json);
            return;
          } catch (e) {
            printOutput({ error: `systemctl start failed: ${(e as Error).message}` }, json);
            return;
          }
        }
        // Fall through to manual spawn if unit missing
      }

      // Kill stale processes first to avoid EADDRINUSE
      try { execSync('pkill -f "shadow/src/daemon/runtime.ts"', { stdio: 'pipe' }); } catch { /* ok */ }
      try { execSync('pkill -f "claude.*--allowedTools.*mcp__shadow"', { stdio: 'pipe' }); } catch { /* ok */ }
      try { execSync('lsof -ti :3700 | xargs kill -9', { stdio: 'pipe' }); } catch { /* ok */ }
      await new Promise(r => setTimeout(r, 1000));

      // Try launchd first
      const plistPath = resolve(homedir(), 'Library', 'LaunchAgents', 'com.shadow.daemon.plist');
      if (existsSync(plistPath)) {
        try {
          execSync(`launchctl bootstrap gui/$(id -u) ${plistPath} 2>/dev/null || launchctl kickstart gui/$(id -u)/com.shadow.daemon`, { stdio: 'pipe' });
          printOutput({ ok: true, message: 'daemon started via launchd' }, json);
          return;
        } catch { /* fallback to manual start */ }
      }

      const { isDaemonRunning } = await import('../daemon/runtime.js');
      if (isDaemonRunning(config)) {
        printOutput({ error: 'daemon is already running' }, Boolean(program.opts().json));
        return;
      }

      const { spawn } = await import('node:child_process');
      const runner = resolveDaemonRunner();
      const child = spawn(
        runner.command,
        runner.args,
        {
          detached: true,
          stdio: 'ignore',
          env: { ...process.env },
          cwd: runner.cwd,
        },
      );
      child.unref();

      printOutput(
        { ok: true, pid: child.pid, message: 'daemon started in background' },
        Boolean(program.opts().json),
      );
    });

  daemon
    .command('stop')
    .description('stop the background daemon')
    .action(async () => {
      const { execSync } = await import('node:child_process');
      const plistPath = resolve(homedir(), 'Library', 'LaunchAgents', 'com.shadow.daemon.plist');
      const json = Boolean(program.opts().json);

      if (process.platform === 'linux') {
        if (!json) log.cli('Stopping daemon…');
        try {
          execSync('systemctl --user stop shadow-daemon.service', { stdio: 'pipe' });
          printOutput({ ok: true, status: 'graceful', message: 'daemon stopped via systemd --user' }, json);
          return;
        } catch (e) {
          printOutput({ error: `systemctl stop failed: ${(e as Error).message}` }, json);
          return;
        }
      }

      if (!json) log.cli('Stopping daemon…');
      const startedAt = Date.now();
      const result = await gracefulStopDaemon({
        config,
        execSync,
        plistPath,
        log: json ? undefined : (msg) => log.cli(`  ${msg}`),
      });
      const elapsedSec = Math.max(1, Math.round((Date.now() - startedAt) / 1000));

      const messages: Record<StopResult, string> = {
        not_running: 'daemon was not running',
        graceful: `daemon stopped gracefully (${elapsedSec}s)`,
        forced: `daemon force-killed after ${elapsedSec}s graceful timeout`,
      };
      printOutput({ ok: true, status: result, message: messages[result] }, json);
    });

  daemon
    .command('restart')
    .description('restart the background daemon (picks up code changes)')
    .action(async () => {
      const { execSync } = await import('node:child_process');
      const plistPath = resolve(homedir(), 'Library', 'LaunchAgents', 'com.shadow.daemon.plist');
      const json = Boolean(program.opts().json);

      if (process.platform === 'linux') {
        if (!json) log.cli('Restarting daemon…');
        try {
          execSync('systemctl --user restart shadow-daemon.service', { stdio: 'pipe' });
          printOutput({ ok: true, status: 'graceful', message: 'daemon restarted via systemd --user' }, json);
          return;
        } catch (e) {
          printOutput({ error: `systemctl restart failed: ${(e as Error).message}` }, json);
          return;
        }
      }

      if (!json) log.cli('Stopping daemon…');
      const stopStartedAt = Date.now();
      const stopResult = await gracefulStopDaemon({
        config,
        execSync,
        plistPath,
        log: json ? undefined : (msg) => log.cli(`  ${msg}`),
      });
      const stopElapsedSec = Math.max(1, Math.round((Date.now() - stopStartedAt) / 1000));

      if (!existsSync(plistPath)) {
        printOutput({ error: 'could not restart — plist not found (run `shadow init` or `shadow daemon reinstall`)' }, json);
        return;
      }

      if (!json) log.cli('Starting daemon…');
      const startStartedAt = Date.now();

      // Prefer bootstrap (clean load after bootout). Fall back to kickstart -k
      // (force-restart) if bootstrap fails because the service is in a
      // transitional state.
      let bootstrapMode: 'bootstrap' | 'kickstart';
      try {
        execSync(`launchctl bootstrap gui/$(id -u) ${plistPath}`, { stdio: 'pipe' });
        bootstrapMode = 'bootstrap';
      } catch {
        try {
          execSync(`launchctl kickstart -k gui/$(id -u)/com.shadow.daemon`, { stdio: 'pipe' });
          bootstrapMode = 'kickstart';
        } catch (e) {
          printOutput({ error: `failed to restart launchd service: ${(e as Error).message}` }, json);
          return;
        }
      }

      // launchd accepting the command does NOT mean the daemon is up. Startup
      // takes ~5-15s (migrations, stores, MCP, embeddings backfill). Poll until
      // the pid file appears and the process is alive, so the CLI only reports
      // success when the daemon is actually ready.
      const { waitForDaemonReady } = await import('../daemon/runtime.js');
      const ready = await waitForDaemonReady(config, 30_000, (elapsedSec) => {
        if (!json) log.cli(`  waiting for daemon to come up (${elapsedSec}s)…`);
      });
      const startElapsedSec = Math.max(1, Math.round((Date.now() - startStartedAt) / 1000));
      if (!ready) {
        printOutput({ error: `daemon ${bootstrapMode} reported success but daemon did not come up within 30s — check ~/.shadow/daemon.stderr.log` }, json);
        return;
      }
      const transport = bootstrapMode === 'bootstrap' ? 'launchd' : 'kickstart';
      printOutput({
        ok: true,
        status: stopResult,
        message: `daemon restarted via ${transport} (${stopElapsedSec}s stop + ${startElapsedSec}s start = ${stopElapsedSec + startElapsedSec}s total)`,
      }, json);
    });

  daemon
    .command('reinstall')
    .description('regenerate the launchd plist from the current template and reload')
    .action(async () => {
      const { execSync } = await import('node:child_process');
      const { PLIST_PATH, writeAndReloadPlist } = await import('./plist.js');
      const json = Boolean(program.opts().json);

      // Stop the current daemon first (if running). This also unloads launchd
      // so writeAndReloadPlist's bootstrap gets a clean slate.
      if (!json) log.cli('Stopping daemon…');
      await gracefulStopDaemon({
        config,
        execSync,
        plistPath: PLIST_PATH,
        log: json ? undefined : (msg) => log.cli(`  ${msg}`),
      });

      if (!json) log.cli('Regenerating plist and starting daemon…');
      const runner = resolveDaemonRunner();
      const result = await writeAndReloadPlist(config, runner);
      if (result.status === 'failed') {
        printOutput({ error: `failed to reinstall plist: ${result.error}` }, json);
        return;
      }

      const { waitForDaemonReady } = await import('../daemon/runtime.js');
      const ready = await waitForDaemonReady(config, 30_000, (elapsedSec) => {
        if (!json) log.cli(`  waiting for daemon to come up (${elapsedSec}s)…`);
      });
      if (!ready) {
        printOutput({ error: 'plist reinstalled but daemon did not come up within 30s — check ~/.shadow/daemon.stderr.log' }, json);
        return;
      }

      printOutput({
        ok: true,
        status: result.status,
        plist: PLIST_PATH,
        message: `plist ${result.status} and daemon restarted via launchd`,
      }, json);
    });

  daemon
    .command('status')
    .description('show daemon status')
    .action(async () => {
      const { getDaemonState, isDaemonRunning } = await import('../daemon/runtime.js');
      const running = isDaemonRunning(config);
      const state = getDaemonState(config);
      printOutput(
        { running, ...state },
        Boolean(program.opts().json),
      );
    });

  // --- job <type> ---

  // JOB_TYPES lives in src/daemon/job-types.ts so the web route's allowlist
  // and this CLI share a single source of truth.

  program
    .command('job <type>')
    .description('trigger a daemon job by type (use "shadow job list" to see available types)')
    .action((type: string) => {
      if (type === 'list') {
        const lines = Object.entries(JOB_TYPES).map(([t, info]) => `  ${t.padEnd(24)} ${info.description}`);
        console.log('Available job types:\n' + lines.join('\n'));
        return;
      }
      const info = JOB_TYPES[type];
      if (!info) {
        log.cli(`Unknown job type: ${type}
Run "shadow job list" to see available types.`);
        process.exit(1);
      }
      withDb((db, json) => {
        if (db.hasQueuedOrRunning(type)) {
          printOutput({ error: `${type} already queued or running` }, json);
          return;
        }
        db.enqueueJob(type, { priority: info.priority, triggerSource: 'manual' });
        printOutput({ triggered: true, message: `${type} enqueued — daemon will pick it up on next tick` }, json);
      });
    });

  // --- heartbeat / reflect (aliases for backwards compat) ---

  program
    .command('heartbeat')
    .description('trigger a heartbeat cycle (alias for "shadow job heartbeat")')
    .action(() => withDb((db, json) => {
      if (db.hasQueuedOrRunning('heartbeat')) {
        printOutput({ error: 'heartbeat already queued or running' }, json);
        return;
      }
      db.enqueueJob('heartbeat', { priority: 10, triggerSource: 'manual' });
      printOutput({ triggered: true, message: 'heartbeat enqueued — daemon will pick it up on next tick' }, json);
    }));

  program
    .command('reflect')
    .description('trigger a soul reflection (alias for "shadow job reflect")')
    .action(() => withDb((db, json) => {
      if (db.hasQueuedOrRunning('reflect')) {
        printOutput({ error: 'reflect already queued or running' }, json);
        return;
      }
      db.enqueueJob('reflect', { priority: 5, triggerSource: 'manual' });
      printOutput({ triggered: true, message: 'reflect enqueued — daemon will pick it up on next tick' }, json);
    }));

  // --- upgrade ---

  program
    .command('upgrade')
    .description('upgrade Shadow to the latest release (or a specific branch)')
    .option('--branch <branch>', 'use a specific branch instead of latest release tag')
    .action(async (opts: { branch?: string }) => {
      const { execSync, execFileSync } = await import('node:child_process');
      const json = Boolean(program.opts().json);
      const projectRoot = resolve(__dirname, '..', '..');
      const currentVersion: string = JSON.parse(
        readFileSync(join(projectRoot, 'package.json'), 'utf8'),
      ).version;

      log.cli(`Current version: v${currentVersion}`);

      // Fetch tags + branches
      log.cli('Fetching updates...');
      try {
        execSync('git fetch --tags origin', { cwd: projectRoot, stdio: 'pipe' });
      } catch {
        printOutput({ error: 'Failed to fetch from remote — check your network/SSH keys' }, json);
        return;
      }

      // Determine target
      let target: string;
      let targetLabel: string;

      if (opts.branch) {
        target = `origin/${opts.branch}`;
        targetLabel = opts.branch;
        try {
          execFileSync('git', ['fetch', 'origin', opts.branch], { cwd: projectRoot, stdio: 'pipe' });
        } catch {
          printOutput({ error: `Branch '${opts.branch}' not found on remote` }, json);
          return;
        }
      } else {
        const tagsRaw = execSync('git tag -l "v*"', { cwd: projectRoot, encoding: 'utf8' });
        const latest = parseLatestSemver(tagsRaw);
        if (!latest) {
          printOutput({ message: `No release tags found. Use --branch to upgrade from a branch.` }, json);
          return;
        }
        if (latest === `v${currentVersion}`) {
          printOutput({ message: `Already up to date (v${currentVersion})` }, json);
          return;
        }
        target = latest;
        targetLabel = latest;
      }

      log.cli(`Upgrading to ${targetLabel}...`);

      // Stop daemon
      log.cli('Stopping daemon...');
      const plistPath = resolve(homedir(), 'Library', 'LaunchAgents', 'com.shadow.daemon.plist');
      await gracefulStopDaemon({ config, execSync, plistPath });

      // Checkout target
      try {
        execFileSync('git', ['checkout', target], { cwd: projectRoot, stdio: 'inherit' });
      } catch {
        printOutput({ error: `Failed to checkout ${targetLabel}` }, json);
        return;
      }

      // Rebuild
      log.cli('Installing dependencies...');
      execSync('npm install --loglevel=error', { cwd: projectRoot, stdio: 'inherit' });
      execSync('npm run dashboard:install --loglevel=error', { cwd: projectRoot, stdio: 'inherit' });

      log.cli('Building...');
      execSync('npm run build', { cwd: projectRoot, stdio: 'inherit' });

      // Re-init (regenerate hooks, settings)
      log.cli('Re-initializing...');
      execSync('node dist/cli.js init', { cwd: projectRoot, stdio: 'inherit', input: '' });

      // Start daemon
      log.cli('Starting daemon...');
      if (existsSync(plistPath)) {
        try {
          execSync(`launchctl bootstrap gui/$(id -u) ${plistPath} 2>/dev/null || launchctl kickstart gui/$(id -u)/com.shadow.daemon`, { stdio: 'pipe' });
        } catch { /* ok */ }
      }

      const newVersion: string = JSON.parse(
        readFileSync(join(projectRoot, 'package.json'), 'utf8'),
      ).version;

      // Enqueue a version-check so the daemon picks up the new version and clears stale alerts
      try {
        const { createDatabase } = await import('../storage/database.js');
        const upgradeDb = createDatabase(config);
        upgradeDb.enqueueJob('version-check', { priority: 9, triggerSource: 'manual' });
        upgradeDb.close();
      } catch { /* best-effort — daemon will run version-check on its own schedule */ }

      printOutput({
        upgraded: true,
        from: `v${currentVersion}`,
        to: `v${newVersion}`,
        message: `Shadow upgraded from v${currentVersion} to v${newVersion}`,
      }, json);
    });
}
