import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

import { ConfigSchema } from '../../config/schema.js';
import type { ShadowConfig } from '../../config/schema.js';
import { ShadowDatabase } from '../../storage/database.js';
import { buildRepoHealth } from './repo-health.js';

function createTestDb(): { db: ShadowDatabase; config: ShadowConfig; cleanup: () => void } {
  const dbPath = join(tmpdir(), `shadow-rh-test-${randomUUID()}.db`);
  const parsed = ConfigSchema.parse({});
  const config: ShadowConfig = {
    ...parsed,
    resolvedDataDir: tmpdir(),
    resolvedDatabasePath: dbPath,
    resolvedArtifactsDir: join(tmpdir(), 'artifacts'),
  };
  const db = new ShadowDatabase(config);
  return {
    db,
    config,
    cleanup: () => {
      db.close();
      try { unlinkSync(dbPath); } catch {}
      try { unlinkSync(dbPath + '-wal'); } catch {}
      try { unlinkSync(dbPath + '-shm'); } catch {}
    },
  };
}

function gitInitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'shadow-rh-repo-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@shadow.test'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'shadow-test'], { cwd: dir });
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir });
  writeFileSync(join(dir, 'README.md'), 'initial\n');
  execFileSync('git', ['add', 'README.md'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
  return dir;
}

// Crea un PATH dir con un stub bash `gh` que printa los JSON predefinidos según
// los argumentos. Devuelve la ruta del directorio para inyectarlo en PATH.
function stubGhDir(behaviour: 'happy' | 'garbage' | 'missing'): string {
  const dir = mkdtempSync(join(tmpdir(), 'shadow-rh-bin-'));
  if (behaviour === 'missing') return dir; // dir vacío → gh no found

  const ghPath = join(dir, 'gh');
  const happyScript = `#!/usr/bin/env bash
case "$2" in
  list)
    case "$1" in
      pr) echo '[{"number":42,"state":"OPEN","title":"feat: foo","headRefName":"feat/foo"}]' ;;
      run) echo '[{"workflowName":"CI","status":"completed","conclusion":"success","createdAt":"2026-05-12T10:00:00Z"}]' ;;
    esac
    ;;
esac
`;
  const garbageScript = `#!/usr/bin/env bash
echo "Warning: gh updated, please rerun"
echo "not json"
`;
  writeFileSync(ghPath, behaviour === 'happy' ? happyScript : garbageScript);
  chmodSync(ghPath, 0o755);
  return dir;
}

function makeCtx(db: ShadowDatabase, config: ShadowConfig) {
  return {
    db,
    config,
    getTrustLevel: () => 0,
    deriveMood: () => 'neutral',
    deriveGreeting: () => 'continuing_session',
    trustNames: {},
  };
}

describe('buildRepoHealth', () => {
  let db: ShadowDatabase;
  let config: ShadowConfig;
  let cleanup: () => void;
  const tmpDirs: string[] = [];
  const originalPath = process.env.PATH;

  before(() => {
    ({ db, config, cleanup } = createTestDb());
    db.ensureProfile();
  });
  after(() => {
    for (const d of tmpDirs) {
      try { rmSync(d, { recursive: true, force: true }); } catch {}
    }
    process.env.PATH = originalPath;
    cleanup();
  });

  it('returns error when repo not found in DB', async () => {
    const ctx = makeCtx(db, config);
    const result = await buildRepoHealth(ctx, 'nonexistent-id', ['prs', 'ci', 'branch']);
    assert.ok('error' in result);
    assert.match(result.error, /repo not found/);
  });

  it('parses gh happy-path stdout for prs and ci', async () => {
    const repoPath = gitInitRepo();
    const ghDir = stubGhDir('happy');
    tmpDirs.push(repoPath, ghDir);
    const repo = db.createRepo({ name: 'happy-repo', path: repoPath });

    process.env.PATH = `${ghDir}:${originalPath ?? ''}`;
    const ctx = makeCtx(db, config);
    const result = await buildRepoHealth(ctx, repo.id, ['prs', 'ci']);
    process.env.PATH = originalPath;

    assert.ok(!('error' in result));
    const r = result as Exclude<typeof result, { error: string }>;
    assert.equal(r.prs?.ok, true);
    if (r.prs?.ok) {
      assert.equal(r.prs.data.length, 1);
      assert.equal(r.prs.data[0].number, 42);
      assert.equal(r.prs.data[0].state, 'OPEN');
    }
    assert.equal(r.ci?.ok, true);
    if (r.ci?.ok && r.ci.data) {
      assert.equal(r.ci.data.conclusion, 'success');
    }
    // branch no fue solicitado
    assert.equal(r.branch, undefined);
  });

  it('returns parse-error when gh stdout is not valid JSON', async () => {
    const repoPath = gitInitRepo();
    const ghDir = stubGhDir('garbage');
    tmpDirs.push(repoPath, ghDir);
    const repo = db.createRepo({ name: 'garbage-repo', path: repoPath });

    process.env.PATH = `${ghDir}:${originalPath ?? ''}`;
    const ctx = makeCtx(db, config);
    const result = await buildRepoHealth(ctx, repo.id, ['prs']);
    process.env.PATH = originalPath;

    assert.ok(!('error' in result));
    const r = result as Exclude<typeof result, { error: string }>;
    assert.equal(r.prs?.ok, false);
    if (!r.prs?.ok) {
      assert.match(r.prs!.error, /parse-error/);
    }
  });

  it('returns gh-not-installed when gh binary is missing from PATH', async () => {
    const repoPath = gitInitRepo();
    const emptyBin = stubGhDir('missing');
    tmpDirs.push(repoPath, emptyBin);
    const repo = db.createRepo({ name: 'no-gh-repo', path: repoPath });

    // PATH solo apunta a un dir vacío → gh no se encuentra. git sí sigue por
    // su path absoluto si lo hay; mantenemos el PATH original al final para no
    // romper otros tests.
    process.env.PATH = emptyBin;
    const ctx = makeCtx(db, config);
    const result = await buildRepoHealth(ctx, repo.id, ['prs', 'ci']);
    process.env.PATH = originalPath;

    assert.ok(!('error' in result));
    const r = result as Exclude<typeof result, { error: string }>;
    assert.equal(r.prs?.ok, false);
    assert.equal(r.ci?.ok, false);
    if (!r.prs?.ok) assert.match(r.prs!.error, /gh-not-installed|gh-error/);
  });

  it('only fetches requested aspects', async () => {
    const repoPath = gitInitRepo();
    const ghDir = stubGhDir('happy');
    tmpDirs.push(repoPath, ghDir);
    const repo = db.createRepo({ name: 'partial-repo', path: repoPath });

    process.env.PATH = `${ghDir}:${originalPath ?? ''}`;
    const ctx = makeCtx(db, config);
    const result = await buildRepoHealth(ctx, repo.id, ['prs']);
    process.env.PATH = originalPath;

    const r = result as Exclude<typeof result, { error: string }>;
    assert.notEqual(r.prs, undefined);
    assert.equal(r.ci, undefined);
    assert.equal(r.branch, undefined);
  });
});
