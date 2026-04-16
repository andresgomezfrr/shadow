import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { ShadowConfig } from '../config/load-config.js';

/**
 * Bump this constant whenever the plist template meaningfully changes.
 * `shadow init` compares the stamp in the installed plist against this
 * value and replaces the plist when the stamp is older.
 *
 * History:
 *   v1 — pre-stamp (KeepAlive: <true/>, no ExitTimeOut)
 *   v2 — KeepAlive: { Crashed: true } + ExitTimeOut: 90 + stamp comment
 */
export const PLIST_VERSION = 2;

export const PLIST_PATH = resolve(homedir(), 'Library', 'LaunchAgents', 'com.shadow.daemon.plist');

/** Matches the stamp comment. Missing stamp = assume v1 (pre-stamp install). */
const STAMP_RE = /<!--\s*shadow-plist-version:\s*(\d+)\s*-->/;

/** Render the current plist template for this install. */
export function renderPlistContent(
  config: ShadowConfig,
  runner: { command: string; args: string[]; cwd: string },
): string {
  const nodeBinDir = dirname(runner.command);
  const envPath = [nodeBinDir, `${homedir()}/.local/bin`, '/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin']
    .filter((v, i, a) => a.indexOf(v) === i)
    .join(':');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- shadow-plist-version: ${PLIST_VERSION} -->
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.shadow.daemon</string>
  <key>ProgramArguments</key>
  <array>
    <string>${runner.command}</string>
${runner.args.map(a => `    <string>${a}</string>`).join('\n')}
  </array>
  <key>WorkingDirectory</key>
  <string>${runner.cwd}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>Crashed</key>
    <true/>
  </dict>
  <key>ExitTimeOut</key>
  <integer>90</integer>
  <key>StandardOutPath</key>
  <string>${resolve(config.resolvedDataDir, 'daemon.stdout.log')}</string>
  <key>StandardErrorPath</key>
  <string>${resolve(config.resolvedDataDir, 'daemon.stderr.log')}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${envPath}</string>
    <key>SHADOW_DATA_DIR</key>
    <string>${config.resolvedDataDir}</string>
  </dict>
</dict>
</plist>`;
}

/**
 * Read the stamp comment from an existing plist file. Returns the version
 * number if present, 1 if the file exists without a stamp (pre-stamp
 * install), or null if the file doesn't exist.
 */
export function readPlistVersion(plistPath: string): number | null {
  if (!existsSync(plistPath)) return null;
  try {
    const content = readFileSync(plistPath, 'utf-8');
    const match = content.match(STAMP_RE);
    if (match) return parseInt(match[1], 10);
    return 1; // pre-stamp
  } catch {
    return null;
  }
}

/**
 * Write the plist to disk and reload launchd. Returns a status string.
 */
export async function writeAndReloadPlist(
  config: ShadowConfig,
  runner: { command: string; args: string[]; cwd: string },
): Promise<{ status: 'installed' | 'reloaded' | 'failed'; error?: string }> {
  const plistDir = dirname(PLIST_PATH);
  const wasInstalled = existsSync(PLIST_PATH);

  mkdirSync(plistDir, { recursive: true });
  writeFileSync(PLIST_PATH, renderPlistContent(config, runner), 'utf8');

  const { execSync } = await import('node:child_process');
  try {
    if (wasInstalled) {
      execSync(`launchctl bootout gui/$(id -u) ${PLIST_PATH} 2>/dev/null || true`, { stdio: 'ignore' });
      // Wait for unload (best-effort — up to 5 s)
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        try {
          execSync('launchctl list | grep -q com.shadow.daemon', { stdio: 'pipe' });
          await new Promise(r => setTimeout(r, 200));
        } catch { break; }
      }
    }
    execSync(`launchctl bootstrap gui/$(id -u) ${PLIST_PATH}`, { stdio: 'pipe' });
    return { status: wasInstalled ? 'reloaded' : 'installed' };
  } catch (e) {
    return { status: 'failed', error: String(e) };
  }
}
