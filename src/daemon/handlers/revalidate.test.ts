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
import { EventBus } from '../../web/event-bus.js';
import { handleRevalidateStaleBatch } from './revalidate.js';
import type { JobContext, DaemonSharedState } from '../job-handlers.js';

function makeConfig(overrides: Partial<ShadowConfig> = {}): ShadowConfig {
  const parsed = ConfigSchema.parse({});
  return {
    ...parsed,
    resolvedDataDir: tmpdir(),
    resolvedDatabasePath: join(tmpdir(), `revalidate-test-${randomUUID()}.db`),
    resolvedArtifactsDir: join(tmpdir(), 'artifacts'),
    ...overrides,
  };
}

function createTestDb(config: ShadowConfig): { db: ShadowDatabase; cleanup: () => void } {
  const db = new ShadowDatabase(config);
  return {
    db,
    cleanup: () => {
      db.close();
      try { unlinkSync(config.resolvedDatabasePath); } catch {}
      try { unlinkSync(config.resolvedDatabasePath + '-wal'); } catch {}
      try { unlinkSync(config.resolvedDatabasePath + '-shm'); } catch {}
    },
  };
}

function gitInitRepoWithCommit(when?: Date): string {
  const dir = mkdtempSync(join(tmpdir(), 'shadow-revalidate-repo-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@shadow.test'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'shadow-test'], { cwd: dir });
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir });
  writeFileSync(join(dir, 'README.md'), 'initial\n');
  execFileSync('git', ['add', 'README.md'], { cwd: dir });
  const env: Record<string, string> = { ...process.env as Record<string, string> };
  if (when) {
    const iso = when.toISOString();
    env.GIT_AUTHOR_DATE = iso;
    env.GIT_COMMITTER_DATE = iso;
  }
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir, env });
  return dir;
}

function addCommit(dir: string, file: string): void {
  writeFileSync(join(dir, file), `content ${randomUUID()}\n`);
  execFileSync('git', ['add', file], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', `add ${file}`], { cwd: dir });
}

function makeCtx(db: ShadowDatabase, config: ShadowConfig): JobContext {
  return {
    jobId: 'test-job-' + randomUUID(),
    config,
    db,
    eventBus: new EventBus(),
    setPhase: () => undefined,
    signal: new AbortController().signal,
  };
}

const sharedNoop: DaemonSharedState = {
  draining: false,
  lastHeartbeatAt: null,
  nextHeartbeatAt: null,
  lastConsolidationAt: null,
  pendingGitEvents: [],
  pendingRemoteSyncResults: [],
  activeProjects: [],
  consecutiveIdleTicks: 0,
  consecutiveGhostJobs: 0,
  lastGhostHint: null,
  lastGhostCode: null,
  networkAvailable: true,
  systemAwake: true,
};

// Seed a suggestion via the public createSuggestion API, then backdate
// `created_at` / `last_revalidated_at` via raw UPDATE.
function seedSuggestionWithCreatedAt(db: ShadowDatabase, opts: { repoId: string | null; createdAt: string; lastRevalidatedAt?: string | null }): string {
  const sug = db.createSuggestion({
    repoId: opts.repoId ?? null,
    kind: 'improvement',
    title: 'test suggestion ' + randomUUID().slice(0, 6),
    summaryMd: 'auth.ts could be simplified',
    reasoningMd: 'reasoning here',
    impactScore: 3,
    confidenceScore: 70,
    riskScore: 2,
  });
  db.rawDb.prepare(
    'UPDATE suggestions SET status = ?, created_at = ?, last_revalidated_at = ? WHERE id = ?',
  ).run('open', opts.createdAt, opts.lastRevalidatedAt ?? null, sug.id);
  return sug.id;
}

describe('handleRevalidateStaleBatch', () => {
  let config: ShadowConfig;
  let db: ShadowDatabase;
  let cleanupDb: () => void;
  const tmpDirs: string[] = [];

  before(() => {
    config = makeConfig({
      revalidateStaleAgeThresholdMs: 4 * 60 * 60 * 1000, // 4h
      revalidateStaleCooldownMs: 24 * 60 * 60 * 1000, // 24h
      revalidateStaleMaxPerBatch: 5,
      revalidateStaleGitTimeoutMs: 3000,
    });
    ({ db, cleanup: cleanupDb } = createTestDb(config));
    db.ensureProfile();
  });
  after(() => {
    for (const d of tmpDirs) {
      try { rmSync(d, { recursive: true, force: true }); } catch {}
    }
    cleanupDb();
  });

  it('schedules revalidation for old suggestion in repo with new commits', async () => {
    const oldDate = new Date(Date.now() - 8 * 60 * 60 * 1000); // 8h ago
    const repoPath = gitInitRepoWithCommit(oldDate);
    tmpDirs.push(repoPath);
    const repo = db.createRepo({ name: 'active-repo-' + randomUUID().slice(0, 6), path: repoPath });
    // Suggestion older than threshold
    const sugId = seedSuggestionWithCreatedAt(db, { repoId: repo.id, createdAt: oldDate.toISOString() });
    // New commit AFTER suggestion creation
    addCommit(repoPath, 'change.txt');

    const result = await handleRevalidateStaleBatch(makeCtx(db, config), sharedNoop);
    const stats = result.result as { scheduled: number; scheduledIds: string[] };
    assert.equal(stats.scheduled, 1);
    assert.ok(stats.scheduledIds.includes(sugId));

    // Confirm a revalidate-suggestion job was enqueued with the right param.
    assert.equal(db.hasQueuedOrRunningWithParams('revalidate-suggestion', 'suggestionId', sugId), true);
  });

  it('skips suggestion younger than age threshold', async () => {
    const recentDate = new Date(Date.now() - 1 * 60 * 60 * 1000); // 1h ago
    const repoPath = gitInitRepoWithCommit(recentDate);
    tmpDirs.push(repoPath);
    const repo = db.createRepo({ name: 'young-repo-' + randomUUID().slice(0, 6), path: repoPath });
    const sugId = seedSuggestionWithCreatedAt(db, { repoId: repo.id, createdAt: recentDate.toISOString() });
    addCommit(repoPath, 'change.txt');

    const result = await handleRevalidateStaleBatch(makeCtx(db, config), sharedNoop);
    const stats = result.result as { scheduledIds: string[] };
    assert.ok(!stats.scheduledIds.includes(sugId), 'young suggestion should NOT be scheduled');
  });

  it('skips suggestion within cooldown window', async () => {
    const oldDate = new Date(Date.now() - 8 * 60 * 60 * 1000);
    const recentRevalidation = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(); // 1h ago, well within 24h cooldown
    const repoPath = gitInitRepoWithCommit(oldDate);
    tmpDirs.push(repoPath);
    const repo = db.createRepo({ name: 'cooldown-repo-' + randomUUID().slice(0, 6), path: repoPath });
    const sugId = seedSuggestionWithCreatedAt(db, { repoId: repo.id, createdAt: oldDate.toISOString(), lastRevalidatedAt: recentRevalidation });
    addCommit(repoPath, 'change.txt');

    const result = await handleRevalidateStaleBatch(makeCtx(db, config), sharedNoop);
    const stats = result.result as { scheduledIds: string[] };
    assert.ok(!stats.scheduledIds.includes(sugId), 'cooldown suggestion should NOT be scheduled');
  });

  it('skips suggestion with no repoId', async () => {
    const oldDate = new Date(Date.now() - 8 * 60 * 60 * 1000);
    const sugId = seedSuggestionWithCreatedAt(db, { repoId: null, createdAt: oldDate.toISOString() });

    const result = await handleRevalidateStaleBatch(makeCtx(db, config), sharedNoop);
    const stats = result.result as { scheduledIds: string[]; skippedNoRepo: number };
    assert.ok(!stats.scheduledIds.includes(sugId));
    assert.ok(stats.skippedNoRepo >= 1);
  });

  it('skips suggestion whose repo had no commits since creation', async () => {
    const oldDate = new Date(Date.now() - 8 * 60 * 60 * 1000);
    // Commit BEFORE the suggestion was created; no new commits after createdAt
    const veryOldCommit = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const repoPath = gitInitRepoWithCommit(veryOldCommit);
    tmpDirs.push(repoPath);
    const repo = db.createRepo({ name: 'stale-repo-' + randomUUID().slice(0, 6), path: repoPath });
    const sugId = seedSuggestionWithCreatedAt(db, { repoId: repo.id, createdAt: oldDate.toISOString() });
    // NOTE: no addCommit after — repo is quiet since suggestion creation

    const result = await handleRevalidateStaleBatch(makeCtx(db, config), sharedNoop);
    const stats = result.result as { scheduledIds: string[]; skippedNoCommitsSinceCreation: number };
    assert.ok(!stats.scheduledIds.includes(sugId), 'quiet-repo suggestion should NOT be scheduled');
    assert.ok(stats.skippedNoCommitsSinceCreation >= 1);
  });

  it('idempotent: skips suggestion that already has revalidate-suggestion queued', async () => {
    const oldDate = new Date(Date.now() - 8 * 60 * 60 * 1000);
    const repoPath = gitInitRepoWithCommit(oldDate);
    tmpDirs.push(repoPath);
    const repo = db.createRepo({ name: 'idem-repo-' + randomUUID().slice(0, 6), path: repoPath });
    const sugId = seedSuggestionWithCreatedAt(db, { repoId: repo.id, createdAt: oldDate.toISOString() });
    addCommit(repoPath, 'change.txt');

    // Pre-enqueue manually (simulates UI-triggered revalidation)
    db.enqueueJob('revalidate-suggestion', { params: { suggestionId: sugId } });

    const result = await handleRevalidateStaleBatch(makeCtx(db, config), sharedNoop);
    const stats = result.result as { scheduledIds: string[]; skippedAlreadyQueued: number };
    assert.ok(!stats.scheduledIds.includes(sugId), 'should not double-enqueue');
    assert.ok(stats.skippedAlreadyQueued >= 1);
  });

  it('respects maxPerBatch', async () => {
    const oldDate = new Date(Date.now() - 8 * 60 * 60 * 1000);
    const ctxConfig = { ...config, revalidateStaleMaxPerBatch: 2 };
    // Seed 4 valid candidates
    for (let i = 0; i < 4; i++) {
      const repoPath = gitInitRepoWithCommit(oldDate);
      tmpDirs.push(repoPath);
      const repo = db.createRepo({ name: `batch-repo-${i}-${randomUUID().slice(0, 6)}`, path: repoPath });
      seedSuggestionWithCreatedAt(db, { repoId: repo.id, createdAt: oldDate.toISOString() });
      addCommit(repoPath, 'change.txt');
    }
    const result = await handleRevalidateStaleBatch(makeCtx(db, ctxConfig), sharedNoop);
    const stats = result.result as { scheduled: number };
    assert.equal(stats.scheduled, 2, 'should cap at maxPerBatch=2');
  });
});
