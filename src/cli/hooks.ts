import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Hook script versioning (audit d74a6227).
 *
 * Hooks in `scripts/*.sh` get copied to `~/.shadow/*.sh` during `shadow init`.
 * Before this stamp existed, there was no way to detect when deployed hooks
 * drifted from the shipped ones — user pulled new Shadow code but forgot to
 * re-run init → daemon/Claude invoke stale scripts → subtle bugs.
 *
 * Pattern: each `scripts/*.sh` carries a `# shadow-hook-version: <semver>`
 * comment near the top. On init we read the deployed stamp and compare to
 * the Shadow package version; if they don't match (any direction), re-copy.
 * This ties hook freshness directly to the release version — no separate
 * number to bump, and easy to eyeball ("what hooks version do you have?
 * grep the stamp, that's your shadow version").
 *
 * Trade-off: every release re-deploys all 7 hooks even if their content
 * didn't change. Cost = 7 copyFileSync of sub-KB files = <10ms. Accepted
 * for the zero-discipline win.
 *
 * Comparison is equality (not semver ordering): we always want deployed to
 * match current, not "deployed ≥ current". Downgrades or dev/prod mismatch
 * both trigger a re-deploy, which is the correct behaviour.
 */
export const HOOK_SCRIPTS = [
  'statusline.sh',
  'session-start.sh',
  'post-tool.sh',
  'user-prompt.sh',
  'stop.sh',
  'stop-failure.sh',
  'subagent-start.sh',
] as const;

const STAMP_RE = /^#\s*shadow-hook-version:\s*(\S+)/m;

export function readHookVersion(path: string): string | null {
  if (!existsSync(path)) return null;
  try {
    const content = readFileSync(path, 'utf-8');
    const match = content.match(STAMP_RE);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export type HookDeployResult = {
  deployed: string[];   // files newly installed (no prior copy)
  upgraded: string[];   // files that replaced a stamped copy with a different version
  current: string[];    // files already at the target version (skipped)
  missingSrc: string[]; // files not present in scripts/ — warning-worthy
};

/**
 * Deploy hook scripts to `dataDir`, skipping any already stamped with
 * `targetVersion`. Safe to call every time (init, daemon startup, doctor).
 * `targetVersion` is typically the Shadow package.json version so every
 * release auto-bumps the hook stamps. See audit d74a6227.
 */
export function ensureHooksDeployed(
  dataDir: string,
  scriptsDir: string,
  targetVersion: string,
  opts?: { force?: boolean },
): HookDeployResult {
  const result: HookDeployResult = { deployed: [], upgraded: [], current: [], missingSrc: [] };
  const force = opts?.force ?? false;
  for (const name of HOOK_SCRIPTS) {
    const src = resolve(scriptsDir, name);
    const dest = resolve(dataDir, name);
    if (!existsSync(src)) { result.missingSrc.push(name); continue; }

    const installed = readHookVersion(dest);
    if (!force && installed !== null && installed === targetVersion) {
      result.current.push(name);
      continue;
    }

    // Substitute __SHADOW_VERSION__ placeholder with the actual version so the
    // deployed script carries the version that installed it. Source files in
    // the repo stay stable (placeholder, no manual bump), deployed files
    // carry the semver stamp for grep/debug.
    const content = readFileSync(src, 'utf-8').replace(/__SHADOW_VERSION__/g, targetVersion);
    writeFileSync(dest, content);
    chmodSync(dest, 0o755);

    if (installed === null) result.deployed.push(name);
    else result.upgraded.push(name);
  }
  return result;
}
