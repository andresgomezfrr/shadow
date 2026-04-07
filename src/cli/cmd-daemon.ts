import type { Command } from 'commander';
import type { ShadowConfig } from '../config/load-config.js';
import type { WithDb } from './types.js';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { printOutput } from './output.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
      const shadowSrcDir = resolve(__dirname, '..');
      const child = spawn(
        'npx',
        ['tsx', join(shadowSrcDir, 'daemon', 'runtime.ts')],
        {
          detached: true,
          stdio: 'ignore',
          env: { ...process.env },
          cwd: resolve(shadowSrcDir, '..'),
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

      // Step 1: Graceful stop — SIGTERM lets daemon drain active jobs
      const { stopDaemon, isDaemonRunning } = await import('../daemon/runtime.js');
      const wasStopped = stopDaemon(config);

      if (wasStopped) {
        // Wait for drain (up to 30s — daemon has 60s drain internally)
        const deadline = Date.now() + 30_000;
        while (Date.now() < deadline && isDaemonRunning(config)) {
          await new Promise(r => setTimeout(r, 500));
        }
      }

      // Step 2: Force kill if still alive after graceful wait
      if (isDaemonRunning(config)) {
        if (existsSync(plistPath)) {
          try { execSync(`launchctl bootout gui/$(id -u) ${plistPath}`, { stdio: 'pipe' }); } catch { /* ok */ }
        }
        try { execSync('pkill -f "shadow/src/daemon/runtime.ts"', { stdio: 'pipe' }); } catch { /* ok */ }
        try { execSync('pkill -f "claude.*--allowedTools.*mcp__shadow"', { stdio: 'pipe' }); } catch { /* ok */ }
        try { execSync('lsof -ti :3700 | xargs kill -9', { stdio: 'pipe' }); } catch { /* ok */ }
        await new Promise(r => setTimeout(r, 1500));
      } else {
        // Graceful stop worked — just bootout launchd
        if (existsSync(plistPath)) {
          try { execSync(`launchctl bootout gui/$(id -u) ${plistPath}`, { stdio: 'pipe' }); } catch { /* ok */ }
        }
        await new Promise(r => setTimeout(r, 500));
      }

      // Step 3: Start
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
}
