import type { Command } from 'commander';
import type { ShadowConfig } from '../config/load-config.js';
import type { WithDb } from './types.js';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { printOutput } from './output.js';

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

async function gracefulStopDaemon(opts: {
  config: ShadowConfig;
  execSync: typeof import('node:child_process').execSync;
  plistPath: string;
  timeoutMs?: number;
}): Promise<'graceful' | 'forced'> {
  const { config, execSync, plistPath, timeoutMs = 30_000 } = opts;
  const { stopDaemon, isDaemonRunning } = await import('../daemon/runtime.js');

  const wasStopped = stopDaemon(config);

  if (wasStopped) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && isDaemonRunning(config)) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  if (!isDaemonRunning(config)) {
    if (existsSync(plistPath)) {
      try { execSync(`launchctl bootout gui/$(id -u) ${plistPath}`, { stdio: 'pipe' }); } catch { /* ok */ }
    }
    await new Promise(r => setTimeout(r, 500));
    return 'graceful';
  }

  if (existsSync(plistPath)) {
    try { execSync(`launchctl bootout gui/$(id -u) ${plistPath}`, { stdio: 'pipe' }); } catch { /* ok */ }
  }
  try { execSync('pkill -f "shadow/src/daemon/runtime.ts"', { stdio: 'pipe' }); } catch { /* ok */ }
  try { execSync('pkill -f "claude.*--allowedTools.*mcp__shadow"', { stdio: 'pipe' }); } catch { /* ok */ }
  try { execSync('lsof -ti :3700 | xargs kill -9', { stdio: 'pipe' }); } catch { /* ok */ }
  await new Promise(r => setTimeout(r, 1500));
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
          printOutput({ ok: true, message: 'daemon started via launchd' }, Boolean(program.opts().json));
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

      // Unload launchd service
      if (existsSync(plistPath)) {
        try { execSync(`launchctl bootout gui/$(id -u) ${plistPath}`, { stdio: 'pipe' }); } catch { /* ok */ }
      }

      // Kill ALL shadow daemon processes (tsx runtime.ts + node on port 3700) + orphaned claude
      try { execSync('pkill -f "shadow/src/daemon/runtime.ts"', { stdio: 'pipe' }); } catch { /* ok */ }
      try { execSync('pkill -f "claude.*--allowedTools.*mcp__shadow"', { stdio: 'pipe' }); } catch { /* ok */ }
      try { execSync('lsof -ti :3700 | xargs kill -9', { stdio: 'pipe' }); } catch { /* ok */ }

      // Clean up PID file
      const { stopDaemon } = await import('../daemon/runtime.js');
      stopDaemon(config);

      printOutput({ ok: true, message: 'daemon stopped' }, Boolean(program.opts().json));
    });

  daemon
    .command('restart')
    .description('restart the background daemon (picks up code changes)')
    .action(async () => {
      const { execSync } = await import('node:child_process');
      const plistPath = resolve(homedir(), 'Library', 'LaunchAgents', 'com.shadow.daemon.plist');

      await gracefulStopDaemon({ config, execSync, plistPath });

      // Start
      if (existsSync(plistPath)) {
        try {
          execSync(`launchctl bootstrap gui/$(id -u) ${plistPath} 2>/dev/null || launchctl kickstart gui/$(id -u)/com.shadow.daemon`, { stdio: 'pipe' });
          printOutput({ ok: true, message: 'daemon restarted via launchd' }, Boolean(program.opts().json));
          return;
        } catch { /* fallback */ }
      }

      printOutput({ error: 'could not restart — plist not found' }, Boolean(program.opts().json));
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

  // --- heartbeat ---

  program
    .command('heartbeat')
    .description('trigger a heartbeat cycle immediately')
    .action(() => withDb((db, json) => {
      if (db.hasQueuedOrRunning('heartbeat')) {
        printOutput({ error: 'heartbeat already queued or running' }, json);
        return;
      }
      db.enqueueJob('heartbeat', { priority: 10, triggerSource: 'manual' });
      printOutput({ triggered: true, message: 'heartbeat enqueued — daemon will pick it up on next tick' }, json);
    }));

  // --- reflect ---

  program
    .command('reflect')
    .description('trigger a soul reflection immediately')
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
      const { execSync } = await import('node:child_process');
      const json = Boolean(program.opts().json);
      const projectRoot = resolve(__dirname, '..', '..');
      const currentVersion: string = JSON.parse(
        readFileSync(join(projectRoot, 'package.json'), 'utf8'),
      ).version;

      console.error(`Current version: v${currentVersion}`);

      // Fetch tags + branches
      console.error('Fetching updates...');
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
          execSync(`git fetch origin ${opts.branch}`, { cwd: projectRoot, stdio: 'pipe' });
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

      console.error(`Upgrading to ${targetLabel}...`);

      // Stop daemon
      console.error('Stopping daemon...');
      const plistPath = resolve(homedir(), 'Library', 'LaunchAgents', 'com.shadow.daemon.plist');
      await gracefulStopDaemon({ config, execSync, plistPath });

      // Checkout target
      try {
        execSync(`git checkout ${target}`, { cwd: projectRoot, stdio: 'inherit' });
      } catch {
        printOutput({ error: `Failed to checkout ${targetLabel}` }, json);
        return;
      }

      // Rebuild
      console.error('Installing dependencies...');
      execSync('npm install --loglevel=error', { cwd: projectRoot, stdio: 'inherit' });
      execSync('npm run dashboard:install --loglevel=error', { cwd: projectRoot, stdio: 'inherit' });

      console.error('Building...');
      execSync('npm run build', { cwd: projectRoot, stdio: 'inherit' });

      // Re-init (regenerate hooks, settings)
      console.error('Re-initializing...');
      execSync('node dist/cli.js init', { cwd: projectRoot, stdio: 'inherit', input: '' });

      // Start daemon
      console.error('Starting daemon...');
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
