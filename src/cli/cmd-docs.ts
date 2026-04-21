import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Command } from 'commander';
import { printOutput } from './output.js';
import { log } from '../log.js';

/**
 * `shadow docs check` — drift detector between CLAUDE.md counts and code reality.
 * Surfaces discrepancies in the three load-bearing numbers we document:
 *   • MCP tool count        (src/mcp/tools/*.ts → `name: 'shadow_…'`)
 *   • DB table count        (src/storage/migrations.ts → `CREATE TABLE IF NOT EXISTS`)
 *   • Dashboard route count (src/web/dashboard/src/App.tsx → `<Route path=`)
 *
 * Exits non-zero if any documented count doesn't match the real one, so CI
 * or a pre-commit hook can catch CLAUDE.md drift before it ships.
 *
 * Intentionally narrow — audit C-05 proposed a richer comparison (tool
 * descriptions, schema fields, etc.) but counts alone already catch the
 * realistic drift class (e.g. CLAUDE.md saying 67 tools when there are 68).
 * Expand the set of checks when a specific drift bites.
 */

type DriftCheck = { label: string; documented: number | null; actual: number; ok: boolean };

function findRepoRoot(): string {
  // CLI can run from anywhere; locate the repo root by walking up until package.json exists.
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    try {
      readFileSync(join(dir, 'package.json'));
      return dir;
    } catch { /* try parent */ }
    dir = resolve(dir, '..');
  }
  // Last resort — assume cwd
  return process.cwd();
}

function countMcpTools(repoRoot: string): number {
  const dir = join(repoRoot, 'src/mcp/tools');
  const files = readdirSync(dir).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'types.ts' && f !== '_test-helpers.ts');
  let total = 0;
  for (const f of files) {
    const body = readFileSync(join(dir, f), 'utf-8');
    const matches = body.match(/name: 'shadow_\w+'/g);
    if (matches) total += matches.length;
  }
  return total;
}

function countDbTables(repoRoot: string): number {
  const body = readFileSync(join(repoRoot, 'src/storage/migrations.ts'), 'utf-8');
  const matches = body.match(/CREATE TABLE IF NOT EXISTS \w+/g) ?? [];
  const uniqueNames = new Set(matches.map(m => m.replace(/CREATE TABLE IF NOT EXISTS /, '')));
  // schema_migrations is internal, not user-facing
  uniqueNames.delete('schema_migrations');
  return uniqueNames.size;
}

function countDashboardRoutes(repoRoot: string): number {
  const body = readFileSync(join(repoRoot, 'src/web/dashboard/src/App.tsx'), 'utf-8');
  const matches = body.match(/<Route\s+path="/g) ?? [];
  return matches.length;
}

function extractDocumented(claudeMd: string, pattern: RegExp): number | null {
  const m = claudeMd.match(pattern);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

export function registerDocsCommands(program: Command): void {
  const docs = program.command('docs').description('documentation integrity checks');

  docs
    .command('check')
    .description('report drift between CLAUDE.md counts and code reality (MCP tools, DB tables, dashboard routes)')
    .option('--json', 'machine-readable output')
    .action((opts: { json?: boolean }) => {
      const repoRoot = findRepoRoot();
      const claudeMdPath = join(repoRoot, 'CLAUDE.md');
      let claudeMd = '';
      try { claudeMd = readFileSync(claudeMdPath, 'utf-8'); } catch {
        printOutput({ error: `CLAUDE.md not found at ${claudeMdPath}` }, !!opts.json);
        process.exit(1);
      }

      const toolsActual = countMcpTools(repoRoot);
      const tablesActual = countDbTables(repoRoot);
      const routesActual = countDashboardRoutes(repoRoot);

      const toolsDoc = extractDocumented(claudeMd, /\((\d+)\s+tools\)/);
      const tablesDoc = extractDocumented(claudeMd, /(\d+)\s+tables\s*\+\s*virtual tables/);
      // Dashboard routes line looks like: "14 routes" or "Dashboard Routes"
      // We document per-row, not a single count. Approximate via "| `/…` |" table rows.
      const routeRows = (claudeMd.match(/^\| `\/[a-z][^`]*`/gm) ?? []).length;

      // MCP tools and DB tables are hard checks — a mismatch means CLAUDE.md
      // lies about the API surface. Dashboard routes is intentionally soft
      // (CLAUDE.md documents top-level pages, App.tsx has sub-routes too) —
      // informational only, doesn't fail the check.
      const hardChecks: DriftCheck[] = [
        { label: 'MCP tools', documented: toolsDoc,  actual: toolsActual,  ok: toolsDoc === toolsActual },
        { label: 'DB tables', documented: tablesDoc, actual: tablesActual, ok: tablesDoc === tablesActual },
      ];
      const softChecks: DriftCheck[] = [
        { label: 'Dashboard routes (rows/paths)', documented: routeRows || null, actual: routesActual, ok: routeRows === routesActual },
      ];
      const checks = [...hardChecks, ...softChecks];
      const drift = hardChecks.filter(c => !c.ok);

      if (opts.json) {
        printOutput({ ok: drift.length === 0, checks }, true);
        process.exit(drift.length === 0 ? 0 : 1);
      }

      log.info(drift.length === 0 ? '✓ docs check: CLAUDE.md matches code' : '✗ docs check: drift detected');
      for (const c of checks) {
        const mark = c.ok ? '✓' : '✗';
        const doc = c.documented ?? '(not documented)';
        log.info(`  ${mark} ${c.label.padEnd(20)} documented=${doc}  actual=${c.actual}`);
      }
      if (drift.length > 0) {
        log.info('');
        log.info('Update CLAUDE.md to match the actual counts, or investigate why the code diverged.');
      }
      process.exit(drift.length === 0 ? 0 : 1);
    });
}
