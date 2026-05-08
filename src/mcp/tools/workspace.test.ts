import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

import { ConfigSchema } from '../../config/schema.js';
import type { ShadowConfig } from '../../config/schema.js';
import { ShadowDatabase } from '../../storage/database.js';
import { scanRepoGitStatus, buildWorkspaceStatus } from './workspace.js';

function createTestDb(): { db: ShadowDatabase; config: ShadowConfig; cleanup: () => void } {
  const dbPath = join(tmpdir(), `shadow-workspace-test-${randomUUID()}.db`);
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
  const dir = mkdtempSync(join(tmpdir(), 'shadow-ws-repo-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@shadow.test'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'shadow-test'], { cwd: dir });
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir });
  writeFileSync(join(dir, 'README.md'), 'initial\n');
  execFileSync('git', ['add', 'README.md'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
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

describe('scanRepoGitStatus', () => {
  it('reports clean repo as not dirty', async () => {
    const dir = gitInitRepo();
    try {
      const status = await scanRepoGitStatus({ id: 'r1', name: 'test-repo', path: dir }, 5000);
      assert.equal(status.error, undefined);
      assert.equal(status.dirty, false);
      assert.equal(status.changedFiles, 0);
      assert.equal(status.branch, 'main');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports dirty when there are uncommitted changes', async () => {
    const dir = gitInitRepo();
    try {
      writeFileSync(join(dir, 'new-file.txt'), 'untracked\n');
      writeFileSync(join(dir, 'README.md'), 'modified\n');
      const status = await scanRepoGitStatus({ id: 'r1', name: 'test-repo', path: dir }, 5000);
      assert.equal(status.error, undefined);
      assert.equal(status.dirty, true);
      assert.equal(status.changedFiles, 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns path-not-found error when repo path does not exist', async () => {
    const status = await scanRepoGitStatus({ id: 'r1', name: 'ghost', path: '/tmp/shadow-does-not-exist-12345' }, 5000);
    assert.equal(status.error, 'path-not-found');
    assert.equal(status.dirty, false);
  });

  it('returns git-error when path exists but is not a git repo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'shadow-not-git-'));
    try {
      const status = await scanRepoGitStatus({ id: 'r1', name: 'plain-dir', path: dir }, 5000);
      assert.ok(status.error, 'should have error');
      assert.notEqual(status.error, 'path-not-found');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('buildWorkspaceStatus', () => {
  let db: ShadowDatabase;
  let config: ShadowConfig;
  let cleanup: () => void;
  const tmpRepos: string[] = [];

  before(() => {
    ({ db, config, cleanup } = createTestDb());
    db.ensureProfile();
  });
  after(() => {
    for (const d of tmpRepos) {
      try { rmSync(d, { recursive: true, force: true }); } catch {}
    }
    cleanup();
  });

  it('composes status across multiple repos, awaiting_pr runs and HIGH observations', async () => {
    const dirClean = gitInitRepo();
    const dirDirty = gitInitRepo();
    writeFileSync(join(dirDirty, 'change.txt'), 'pending\n');
    tmpRepos.push(dirClean, dirDirty);

    const repoClean = db.createRepo({ name: 'repo-clean', path: dirClean });
    const repoDirty = db.createRepo({ name: 'repo-dirty', path: dirDirty });

    // Seed un observation HIGH y un run awaiting_pr
    db.createObservation({
      sourceKind: 'llm',
      repoId: repoDirty.id,
      kind: 'risk',
      title: 'test high obs',
      severity: 'high',
    });

    const run = db.createRun({
      kind: 'execute',
      repoId: repoDirty.id,
      prompt: 'test execution',
    });
    db.updateRun(run.id, { status: 'awaiting_pr', prUrl: 'https://github.com/example/repo/pull/1' });

    const ctx = makeCtx(db, config);
    const result = await buildWorkspaceStatus(ctx, 5000);

    assert.equal(result.repos.total, 2);
    assert.equal(result.repos.dirty.length, 1, `expected 1 dirty, got ${result.repos.dirty.length}`);
    assert.equal(result.repos.dirty[0].name, 'repo-dirty');
    assert.equal(result.repos.clean, 1);
    assert.equal(result.awaitingPrRuns.length, 1);
    assert.equal(result.awaitingPrRuns[0].repoId, repoDirty.id);
    assert.equal(result.openHighObservations.length, 1);
    assert.equal(result.openHighObservations[0].severity, 'high');
    // El campo `scannedAt` debe ser un ISO válido
    assert.ok(!Number.isNaN(Date.parse(result.scannedAt)));
    // El campo `repoClean` participó en el scan
    void repoClean;
  });

  it('handles a repo whose path no longer exists without throwing', async () => {
    const ghostId = db.createRepo({ name: 'ghost-repo', path: '/tmp/shadow-ghost-' + randomUUID() }).id;
    const ctx = makeCtx(db, config);
    const result = await buildWorkspaceStatus(ctx, 5000);
    const erroredEntry = result.repos.errored.find((r) => r.repoId === ghostId);
    assert.ok(erroredEntry, 'ghost repo should appear in errored bucket');
    assert.equal(erroredEntry.error, 'path-not-found');
    // El resto del scan debe seguir produciendo respuesta global válida
    assert.ok(result.scannedAt);
  });
});
