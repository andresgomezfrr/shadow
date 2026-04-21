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
    try { execSync(`launchctl bootout gui/$(id -u) ${plistPath}`, { stdio: 'pipe' }); } catch { /* ok */ }
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
        try {
          execSync('systemctl --user stop shadow-daemon.service', { stdio: 'pipe' });
          printOutput({ ok: true, status: 'graceful', message: 'daemon stopped via systemd --user' }, json);
          return;
        } catch (e) {
          printOutput({ error: `systemctl stop failed: ${(e as Error).message}` }, json);
          return;
        }
      }

      const result = await gracefulStopDaemon({
        config,
        execSync,
        plistPath,
        log: json ? undefined : (msg) => log.error(msg),
      });

      const messages: Record<StopResult, string> = {
        not_running: 'daemon was not running',
        graceful: 'daemon stopped gracefully',
        forced: 'daemon force-killed after graceful timeout',
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
        try {
          execSync('systemctl --user restart shadow-daemon.service', { stdio: 'pipe' });
          printOutput({ ok: true, status: 'graceful', message: 'daemon restarted via systemd --user' }, json);
          return;
        } catch (e) {
          printOutput({ error: `systemctl restart failed: ${(e as Error).message}` }, json);
          return;
        }
      }

      const stopResult = await gracefulStopDaemon({
        config,
        execSync,
        plistPath,
        log: json ? undefined : (msg) => log.error(msg),
      });

      if (!existsSync(plistPath)) {
        printOutput({ error: 'could not restart — plist not found (run `shadow init` or `shadow daemon reinstall`)' }, json);
        return;
      }

      // Prefer bootstrap (clean load after bootout). Fall back to kickstart -k
      // (force-restart) if bootstrap fails because the service is in a
      // transitional state.
      try {
        execSync(`launchctl bootstrap gui/$(id -u) ${plistPath}`, { stdio: 'pipe' });
        printOutput({ ok: true, status: stopResult, message: 'daemon restarted via launchd' }, json);
        return;
      } catch {
        try {
          execSync(`launchctl kickstart -k gui/$(id -u)/com.shadow.daemon`, { stdio: 'pipe' });
          printOutput({ ok: true, status: stopResult, message: 'daemon restarted via kickstart' }, json);
          return;
        } catch (e) {
          printOutput({ error: `failed to restart launchd service: ${(e as Error).message}` }, json);
          return;
        }
      }
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
      await gracefulStopDaemon({
        config,
        execSync,
        plistPath: PLIST_PATH,
        log: json ? undefined : (msg) => log.error(msg),
      });

      const runner = resolveDaemonRunner();
      const result = await writeAndReloadPlist(config, runner);
      if (result.status === 'failed') {
        printOutput({ error: `failed to reinstall plist: ${result.error}` }, json);
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
        log.error(`Unknown job type: ${type}\nRun "shadow job list" to see available types.`);
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

      log.error(`Current version: v${currentVersion}`);

      // Fetch tags + branches
      log.error('Fetching updates...');
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

      log.error(`Upgrading to ${targetLabel}...`);

      // Stop daemon
      log.error('Stopping daemon...');
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
      log.error('Installing dependencies...');
      execSync('npm install --loglevel=error', { cwd: projectRoot, stdio: 'inherit' });
      execSync('npm run dashboard:install --loglevel=error', { cwd: projectRoot, stdio: 'inherit' });

      log.error('Building...');
      execSync('npm run build', { cwd: projectRoot, stdio: 'inherit' });

      // Re-init (regenerate hooks, settings)
      log.error('Re-initializing...');
      execSync('node dist/cli.js init', { cwd: projectRoot, stdio: 'inherit', input: '' });

      // Start daemon
      log.error('Starting daemon...');
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
