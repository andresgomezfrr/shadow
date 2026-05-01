#!/usr/bin/env tsx
// Eval runner para Shadow. Carga fixtures, valida snapshots contra expectations.
//
// Uso:
//   tsx evals/runner.ts                 # offline, todas las fases
//   tsx evals/runner.ts --phase=extract # solo extract
//   tsx evals/runner.ts --json          # output como JSON (para CI)
//   tsx evals/runner.ts --mode=live     # refresca snapshots llamando al LLM (TODO)
//
// El modo offline NO llama al LLM: lee snapshots de evals/snapshots/<id>.json
// (gitignored) y los valida contra las expectations del fixture. Si el snapshot
// falta, el caso se reporta como `missing-snapshot` (no falla CI).
//
// Genera los snapshots con `--mode=live` (manual, gasta tokens). El modo live
// se completa en una iteración posterior — por ahora solo está el scaffolding.

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractCases } from './fixtures/extract.js';
import { observeCases } from './fixtures/observe.js';
import type { EvalCase, EvalPhase, EvalResult, EvalCheck } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOTS_DIR = resolve(__dirname, 'snapshots');

type CliOpts = {
  phase: EvalPhase | 'all';
  mode: 'offline' | 'live';
  json: boolean;
};

function parseArgs(argv: string[]): CliOpts {
  const opts: CliOpts = { phase: 'all', mode: 'offline', json: false };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--phase=')) {
      const v = arg.slice('--phase='.length);
      if (v !== 'extract' && v !== 'observe' && v !== 'all') {
        throw new Error(`Invalid --phase: ${v}`);
      }
      opts.phase = v;
    } else if (arg.startsWith('--mode=')) {
      const v = arg.slice('--mode='.length);
      if (v !== 'offline' && v !== 'live') throw new Error(`Invalid --mode: ${v}`);
      opts.mode = v;
    } else if (arg === '--json') {
      opts.json = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log('Uso: tsx evals/runner.ts [--phase=extract|observe|all] [--mode=offline|live] [--json]');
      process.exit(0);
    } else {
      throw new Error(`Unknown arg: ${arg}`);
    }
  }
  return opts;
}

function readSnapshot(id: string): unknown | null {
  const path = resolve(SNAPSHOTS_DIR, `${id}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function runOfflineCase(c: EvalCase): EvalResult {
  const snapshot = readSnapshot(c.id);
  if (snapshot === null) {
    return { id: c.id, status: 'missing-snapshot', checks: [] };
  }

  const checks: EvalCheck[] = [];
  const exp = c.expectations;

  // 1. Schema validation (Zod)
  if (exp.schema) {
    const parsed = exp.schema.safeParse(snapshot);
    checks.push({
      name: 'schema-valid',
      ok: parsed.success,
      detail: parsed.success ? undefined : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    });
  }

  // 2. minItems / maxItems — busca el primer array top-level en el snapshot.
  const snapObj = snapshot as Record<string, unknown>;
  const firstArrayKey = Object.keys(snapObj).find((k) => Array.isArray(snapObj[k]));
  const items = firstArrayKey ? (snapObj[firstArrayKey] as unknown[]) : [];
  if (exp.minItems !== undefined) {
    checks.push({
      name: `min-items>=${exp.minItems}`,
      ok: items.length >= exp.minItems,
      detail: `got ${items.length}`,
    });
  }
  if (exp.maxItems !== undefined) {
    checks.push({
      name: `max-items<=${exp.maxItems}`,
      ok: items.length <= exp.maxItems,
      detail: `got ${items.length}`,
    });
  }

  // 3. requiredKinds — al menos un item tiene su kind en la lista.
  if (exp.requiredKinds && exp.requiredKinds.length > 0 && items.length > 0) {
    const kindsPresent = new Set(items.map((it) => (it as Record<string, unknown>).kind).filter(Boolean) as string[]);
    const overlap = exp.requiredKinds.some((k) => kindsPresent.has(k));
    checks.push({
      name: `kind ∈ {${exp.requiredKinds.join(',')}}`,
      ok: overlap,
      detail: overlap ? undefined : `got [${[...kindsPresent].join(',')}]`,
    });
  }

  // 4. forbiddenSubstrings — ningún substring prohibido en el snapshot serializado.
  if (exp.forbiddenSubstrings && exp.forbiddenSubstrings.length > 0) {
    const serialized = JSON.stringify(snapshot);
    const hits = exp.forbiddenSubstrings.filter((s) => serialized.includes(s));
    checks.push({
      name: 'no-forbidden-substrings',
      ok: hits.length === 0,
      detail: hits.length > 0 ? `leaked: ${hits.join(', ')}` : undefined,
    });
  }

  const allOk = checks.every((c) => c.ok);
  return { id: c.id, status: allOk ? 'pass' : 'fail', checks };
}

function summarize(results: EvalResult[]): { pass: number; fail: number; missing: number } {
  return {
    pass: results.filter((r) => r.status === 'pass').length,
    fail: results.filter((r) => r.status === 'fail').length,
    missing: results.filter((r) => r.status === 'missing-snapshot').length,
  };
}

function printHuman(results: EvalResult[]): void {
  for (const r of results) {
    const icon = r.status === 'pass' ? 'PASS' : r.status === 'fail' ? 'FAIL' : 'MISS';
    console.log(`[${icon}] ${r.id}`);
    for (const c of r.checks) {
      const sub = c.ok ? '   ok  ' : '   FAIL';
      const detail = c.detail ? ` (${c.detail})` : '';
      console.log(`  ${sub} ${c.name}${detail}`);
    }
  }
  const s = summarize(results);
  console.log(`\nTotal: ${results.length} | pass=${s.pass} fail=${s.fail} missing=${s.missing}`);
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv);

  if (opts.mode === 'live') {
    console.error('error: --mode=live no está implementado todavía. Genera snapshots manualmente o espera al sprint siguiente.');
    process.exit(2);
  }

  const cases: EvalCase[] = [];
  if (opts.phase === 'extract' || opts.phase === 'all') cases.push(...extractCases);
  if (opts.phase === 'observe' || opts.phase === 'all') cases.push(...observeCases);

  const results = cases.map(runOfflineCase);

  if (opts.json) {
    console.log(JSON.stringify({ results, summary: summarize(results) }, null, 2));
  } else {
    printHuman(results);
  }

  // Exit code: 1 sólo si hay FAIL real. missing-snapshot no falla (los snapshots
  // se generan manualmente con --mode=live).
  process.exit(summarize(results).fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('eval runner crashed:', err);
  process.exit(2);
});
