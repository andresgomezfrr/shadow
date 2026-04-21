import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { ShadowConfig } from '../config/load-config.js';

/**
 * Linux equivalent of `plist.ts`. Generates a systemd user unit at
 * `~/.config/systemd/user/shadow-daemon.service`, reloads the user
 * systemd manager, enables and starts the service. See audit C-01.
 *
 * Stamp comment in unit file lets `shadow init` detect stale templates
 * and regenerate when the constant is bumped — same pattern as plist.
 *
 * History:
 *   v1 — initial unit (Restart=on-failure, RestartSec=5, WantedBy=default.target)
 */
export const SYSTEMD_UNIT_VERSION = 1;

export const SYSTEMD_UNIT_PATH = resolve(homedir(), '.config', 'systemd', 'user', 'shadow-daemon.service');

const STAMP_RE = /^#\s*shadow-unit-version:\s*(\d+)/m;

export function renderSystemdUnit(
  config: ShadowConfig,
  runner: { command: string; args: string[]; cwd: string },
): string {
  const nodeBinDir = dirname(runner.command);
  const envPath = [nodeBinDir, `${homedir()}/.local/bin`, '/usr/local/bin', '/usr/bin', '/bin']
    .filter((v, i, a) => a.indexOf(v) === i)
    .join(':');

  // Quote each arg so paths with spaces work
  const quotedArgs = runner.args.map((a) => `"${a.replace(/"/g, '\\"')}"`).join(' ');
  const stdoutPath = resolve(config.resolvedDataDir, 'daemon.stdout.log');
  const stderrPath = resolve(config.resolvedDataDir, 'daemon.stderr.log');

  return `# shadow-unit-version: ${SYSTEMD_UNIT_VERSION}
[Unit]
Description=Shadow — local-first engineering companion
After=default.target

[Service]
Type=simple
ExecStart="${runner.command}" ${quotedArgs}
WorkingDirectory=${runner.cwd}
Restart=on-failure
RestartSec=5
StandardOutput=append:${stdoutPath}
StandardError=append:${stderrPath}
Environment="PATH=${envPath}"
Environment="SHADOW_DATA_DIR=${config.resolvedDataDir}"

[Install]
WantedBy=default.target
`;
}

export function readSystemdUnitVersion(unitPath: string): number | null {
  if (!existsSync(unitPath)) return null;
  try {
    const content = readFileSync(unitPath, 'utf-8');
    const match = content.match(STAMP_RE);
    if (match) return parseInt(match[1], 10);
    return 1; // pre-stamp — assume v1
  } catch {
    return null;
  }
}

export async function writeAndReloadSystemdUnit(
  config: ShadowConfig,
  runner: { command: string; args: string[]; cwd: string },
): Promise<{ status: 'installed' | 'reloaded' | 'failed'; error?: string }> {
  const unitDir = dirname(SYSTEMD_UNIT_PATH);
  const wasInstalled = existsSync(SYSTEMD_UNIT_PATH);

  mkdirSync(unitDir, { recursive: true });
  writeFileSync(SYSTEMD_UNIT_PATH, renderSystemdUnit(config, runner), 'utf8');

  const { execSync } = await import('node:child_process');
  try {
    execSync('systemctl --user daemon-reload', { stdio: 'pipe' });
    if (wasInstalled) {
      execSync('systemctl --user restart shadow-daemon.service', { stdio: 'pipe' });
    } else {
      execSync('systemctl --user enable --now shadow-daemon.service', { stdio: 'pipe' });
    }
    return { status: wasInstalled ? 'reloaded' : 'installed' };
  } catch (e) {
    return { status: 'failed', error: String(e) };
  }
}
