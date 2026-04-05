import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { ConfigSchema } from '../config/schema.js';
import type { ShadowConfig } from '../config/schema.js';
import { ShadowDatabase } from './database.js';

function createTestDb(): { db: ShadowDatabase; cleanup: () => void } {
  const dbPath = join(tmpdir(), `shadow-test-${randomUUID()}.db`);
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
    cleanup: () => {
      db.close();
      try { unlinkSync(dbPath); } catch {}
      try { unlinkSync(dbPath + '-wal'); } catch {}
      try { unlinkSync(dbPath + '-shm'); } catch {}
    },
  };
}

// ---------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------

describe('migrations', () => {
  let db: ShadowDatabase;
  let cleanup: () => void;

  before(() => {
    ({ db, cleanup } = createTestDb());
  });
  after(() => cleanup());

  it('applies all migrations without error', () => {
    // If we get here, the constructor succeeded — migrations applied
    assert.ok(db);
  });

  it('key tables exist', () => {
    const tables = db.listTables();
    for (const name of ['repos', 'memories', 'observations', 'suggestions', 'jobs', 'projects', 'systems', 'contacts']) {
      assert.ok(tables.includes(name), `table "${name}" should exist, got: ${tables.join(', ')}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Repos CRUD
// ---------------------------------------------------------------------------

describe('repos CRUD', () => {
  let db: ShadowDatabase;
  let cleanup: () => void;

  before(() => {
    ({ db, cleanup } = createTestDb());
  });
  after(() => cleanup());

  it('createRepo + getRepo round trip', () => {
    const repo = db.createRepo({ name: 'shadow', path: '/Users/dev/workspace/shadow' });
    assert.ok(repo.id);
    assert.equal(repo.name, 'shadow');
    assert.equal(repo.path, '/Users/dev/workspace/shadow');
    assert.equal(repo.defaultBranch, 'main');

    const fetched = db.getRepo(repo.id);
    assert.ok(fetched);
    assert.equal(fetched.id, repo.id);
    assert.equal(fetched.name, 'shadow');
  });

  it('findRepoByPath works', () => {
    const found = db.findRepoByPath('/Users/dev/workspace/shadow');
    assert.ok(found);
    assert.equal(found.name, 'shadow');
  });

  it('listRepos returns all', () => {
    db.createRepo({ name: 'other-project', path: '/Users/dev/workspace/other-project' });
    const repos = db.listRepos();
    assert.ok(repos.length >= 2);
    const names = repos.map(r => r.name);
    assert.ok(names.includes('shadow'));
    assert.ok(names.includes('other-project'));
  });

  it('updateRepo mutates fields', () => {
    const repo = db.findRepoByPath('/Users/dev/workspace/shadow')!;
    db.updateRepo(repo.id, { languageHint: 'typescript', testCommand: 'npm test' });
    const updated = db.getRepo(repo.id)!;
    assert.equal(updated.languageHint, 'typescript');
    assert.equal(updated.testCommand, 'npm test');
  });

  it('deleteRepo removes it', () => {
    const repo = db.createRepo({ name: 'to-delete', path: '/tmp/to-delete' });
    db.deleteRepo(repo.id);
    assert.equal(db.getRepo(repo.id), null);
  });
});

// ---------------------------------------------------------------------------
// Memories CRUD + FTS5
// ---------------------------------------------------------------------------

describe('memories CRUD + FTS5', () => {
  let db: ShadowDatabase;
  let cleanup: () => void;

  before(() => {
    ({ db, cleanup } = createTestDb());
  });
  after(() => cleanup());

  it('createMemory + getMemory with minimal fields', () => {
    const mem = db.createMemory({
      layer: 'hot',
      scope: 'global',
      kind: 'insight',
      title: 'TypeScript strict mode is enabled',
      bodyMd: 'The shadow project uses TypeScript with strict: true in tsconfig.json',
      sourceType: 'heartbeat',
    });
    assert.ok(mem.id);
    assert.equal(mem.layer, 'hot');
    assert.equal(mem.scope, 'global');
    assert.equal(mem.kind, 'insight');
    assert.equal(mem.title, 'TypeScript strict mode is enabled');
    assert.equal(mem.accessCount, 0);

    const fetched = db.getMemory(mem.id);
    assert.ok(fetched);
    assert.equal(fetched.id, mem.id);
  });

  it('listMemories with layer filter', () => {
    db.createMemory({
      layer: 'core',
      scope: 'global',
      kind: 'convention',
      title: 'Use ESM imports everywhere',
      bodyMd: 'All imports use .js extension for ESM compatibility',
      sourceType: 'taught',
    });

    const hotOnly = db.listMemories({ layer: 'hot' });
    assert.ok(hotOnly.length >= 1);
    assert.ok(hotOnly.every(m => m.layer === 'hot'));

    const coreOnly = db.listMemories({ layer: 'core' });
    assert.ok(coreOnly.length >= 1);
    assert.ok(coreOnly.every(m => m.layer === 'core'));
  });

  it('updateMemory changes fields', () => {
    const mem = db.createMemory({
      layer: 'warm',
      scope: 'repo',
      kind: 'pattern',
      title: 'Database uses WAL mode',
      bodyMd: 'SQLite configured with WAL for concurrent reads',
      sourceType: 'heartbeat',
    });
    db.updateMemory(mem.id, { layer: 'hot', relevanceScore: 0.9 });
    const updated = db.getMemory(mem.id)!;
    assert.equal(updated.layer, 'hot');
    assert.equal(updated.relevanceScore, 0.9);
  });

  it('touchMemory increments access_count', () => {
    const mem = db.createMemory({
      layer: 'hot',
      scope: 'global',
      kind: 'fact',
      title: 'Port 3700 is the daemon port',
      bodyMd: 'Shadow daemon listens on localhost:3700',
      sourceType: 'heartbeat',
    });
    assert.equal(mem.accessCount, 0);

    db.touchMemory(mem.id);
    const after1 = db.getMemory(mem.id)!;
    assert.equal(after1.accessCount, 1);
    assert.ok(after1.lastAccessedAt);

    db.touchMemory(mem.id);
    const after2 = db.getMemory(mem.id)!;
    assert.equal(after2.accessCount, 2);
  });

  it('searchMemories finds by title', () => {
    const results = db.searchMemories('TypeScript strict');
    assert.ok(results.length >= 1);
    assert.ok(results.some(r => r.memory.title.includes('TypeScript')));
  });

  it('searchMemories finds by body content', () => {
    const results = db.searchMemories('WAL concurrent');
    assert.ok(results.length >= 1);
    assert.ok(results.some(r => r.memory.bodyMd.includes('WAL')));
  });

  it('searchMemories returns empty for no match', () => {
    const results = db.searchMemories('xyznonexistent99');
    assert.equal(results.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Observations CRUD + dedup
// ---------------------------------------------------------------------------

describe('observations CRUD + dedup', () => {
  let db: ShadowDatabase;
  let cleanup: () => void;
  let repoId: string;

  before(() => {
    ({ db, cleanup } = createTestDb());
    const repo = db.createRepo({ name: 'test-repo', path: '/tmp/test-repo-obs' });
    repoId = repo.id;
  });
  after(() => cleanup());

  it('createObservation round trip', () => {
    const obs = db.createObservation({
      repoId,
      kind: 'improvement',
      title: 'Missing error handling in API routes',
      detail: { file: 'server.ts', line: 42 },
      severity: 'warning',
    });
    assert.ok(obs.id);
    assert.equal(obs.repoId, repoId);
    assert.equal(obs.kind, 'improvement');
    assert.equal(obs.title, 'Missing error handling in API routes');
    assert.equal(obs.votes, 1);
    assert.equal(obs.status, 'active');
    assert.equal(obs.severity, 'warning');

    const fetched = db.getObservation(obs.id);
    assert.ok(fetched);
    assert.equal(fetched.id, obs.id);
  });

  it('duplicate (same repo+kind+title) increments votes', () => {
    const first = db.createObservation({
      repoId,
      kind: 'risk',
      title: 'No rate limiting on public endpoints',
    });
    assert.equal(first.votes, 1);
    const firstId = first.id;

    const second = db.createObservation({
      repoId,
      kind: 'risk',
      title: 'No rate limiting on public endpoints',
    });
    // Should return the same observation with incremented votes
    assert.equal(second.id, firstId);
    assert.equal(second.votes, 2);
  });

  it('listObservations with status filter', () => {
    const obs = db.createObservation({
      repoId,
      kind: 'pattern',
      title: 'Consistent use of async/await',
    });
    db.updateObservationStatus(obs.id, 'resolved');

    const active = db.listObservations({ status: 'active' });
    assert.ok(active.every(o => o.status === 'active'));

    const resolved = db.listObservations({ status: 'resolved' });
    assert.ok(resolved.length >= 1);
    assert.ok(resolved.every(o => o.status === 'resolved'));
  });
});

// ---------------------------------------------------------------------------
// Suggestions CRUD
// ---------------------------------------------------------------------------

describe('suggestions CRUD', () => {
  let db: ShadowDatabase;
  let cleanup: () => void;

  before(() => {
    ({ db, cleanup } = createTestDb());
  });
  after(() => cleanup());

  it('createSuggestion + getSuggestion', () => {
    const sug = db.createSuggestion({
      kind: 'refactor',
      title: 'Extract database mapper functions into separate module',
      summaryMd: 'The mapper functions at the bottom of database.ts could be a standalone module for clarity.',
      impactScore: 4,
      confidenceScore: 85,
      riskScore: 1,
    });
    assert.ok(sug.id);
    assert.equal(sug.kind, 'refactor');
    assert.equal(sug.title, 'Extract database mapper functions into separate module');
    assert.equal(sug.status, 'pending');
    assert.equal(sug.impactScore, 4);
    assert.equal(sug.confidenceScore, 85);
    assert.equal(sug.riskScore, 1);

    const fetched = db.getSuggestion(sug.id);
    assert.ok(fetched);
    assert.equal(fetched.id, sug.id);
    assert.equal(fetched.summaryMd, sug.summaryMd);
  });

  it('updateSuggestion changes status', () => {
    const sug = db.createSuggestion({
      kind: 'feature',
      title: 'Add FTS5 snippet highlighting to search results',
      summaryMd: 'Use FTS5 snippet() function for better search result previews.',
    });
    assert.equal(sug.status, 'pending');

    db.updateSuggestion(sug.id, { status: 'accepted' });
    const updated = db.getSuggestion(sug.id)!;
    assert.equal(updated.status, 'accepted');
  });

  it('countPendingSuggestions', () => {
    const before = db.countPendingSuggestions();
    db.createSuggestion({
      kind: 'test',
      title: 'Add unit tests for memory layer promotion',
      summaryMd: 'Memories should be tested for automatic layer promotion and demotion.',
    });
    const afterCreate = db.countPendingSuggestions();
    assert.equal(afterCreate, before + 1);
  });
});

// ---------------------------------------------------------------------------
// Jobs lifecycle
// ---------------------------------------------------------------------------

describe('jobs lifecycle', () => {
  let db: ShadowDatabase;
  let cleanup: () => void;

  before(() => {
    ({ db, cleanup } = createTestDb());
  });
  after(() => cleanup());

  it('enqueueJob creates queued job', () => {
    const job = db.enqueueJob('heartbeat', { priority: 5, triggerSource: 'schedule' });
    assert.ok(job.id);
    assert.equal(job.type, 'heartbeat');
    assert.equal(job.status, 'queued');
    assert.equal(job.priority, 5);
    assert.equal(job.triggerSource, 'schedule');
  });

  it('claimNextJob transitions to running', () => {
    const job = db.enqueueJob('suggest', { priority: 3 });
    const claimed = db.claimNextJob({ types: ['suggest'] });
    assert.ok(claimed);
    assert.equal(claimed.id, job.id);
    assert.equal(claimed.status, 'running');
  });

  it('claimNextJob returns null when empty', () => {
    const claimed = db.claimNextJob({ types: ['nonexistent-type'] });
    assert.equal(claimed, null);
  });

  it('claimNextJob respects priority (higher first)', () => {
    const lowPri = db.enqueueJob('consolidate', { priority: 1 });
    const highPri = db.enqueueJob('consolidate', { priority: 10 });

    const claimed = db.claimNextJob({ types: ['consolidate'] });
    assert.ok(claimed);
    assert.equal(claimed.id, highPri.id);
    assert.equal(claimed.priority, 10);

    // Claim again to get the lower priority one
    const claimedLow = db.claimNextJob({ types: ['consolidate'] });
    assert.ok(claimedLow);
    assert.equal(claimedLow.id, lowPri.id);
  });

  it('claimNextJob respects excludeTypes', () => {
    // Drain any leftover queued jobs first
    while (db.claimNextJob()) { /* drain */ }

    db.enqueueJob('reflect', { priority: 5 });
    db.enqueueJob('remote-sync', { priority: 5 });

    const claimed = db.claimNextJob({ excludeTypes: ['reflect'] });
    assert.ok(claimed);
    assert.equal(claimed.type, 'remote-sync');
  });

  it('hasQueuedOrRunning', () => {
    // heartbeat was enqueued earlier (first test) and never claimed with a type-specific claim
    // Let's create a fresh one to be sure
    db.enqueueJob('context-enrich', { priority: 3 });
    assert.equal(db.hasQueuedOrRunning('context-enrich'), true);
    assert.equal(db.hasQueuedOrRunning('digest-daily'), false);
  });
});

// ---------------------------------------------------------------------------
// Projects + entity cascade
// ---------------------------------------------------------------------------

describe('projects + entity cascade', () => {
  let db: ShadowDatabase;
  let cleanup: () => void;

  before(() => {
    ({ db, cleanup } = createTestDb());
  });
  after(() => cleanup());

  it('createProject + getProject', () => {
    const project = db.createProject({
      name: 'Shadow Core',
      kind: 'long-term',
      description: 'Main Shadow development project',
    });
    assert.ok(project.id);
    assert.equal(project.name, 'Shadow Core');
    assert.equal(project.kind, 'long-term');
    assert.equal(project.status, 'active');

    const fetched = db.getProject(project.id);
    assert.ok(fetched);
    assert.equal(fetched.id, project.id);
    assert.equal(fetched.description, 'Main Shadow development project');
  });

  it('deleteProject removes entity references from observations', () => {
    const project = db.createProject({ name: 'Temp Sprint' });
    const repo = db.createRepo({ name: 'cascade-repo', path: '/tmp/cascade-repo' });

    // Create an observation and manually set its entities_json to reference the project
    const obs = db.createObservation({
      repoId: repo.id,
      kind: 'improvement',
      title: 'Test entity cascade on delete',
    });

    // Set entities_json via rawDb to link observation to the project
    db.rawDb
      .prepare('UPDATE observations SET entities_json = ? WHERE id = ?')
      .run(JSON.stringify([{ type: 'project', id: project.id }]), obs.id);

    // Verify entity link is set
    const beforeDelete = db.getObservation(obs.id)!;
    assert.equal(beforeDelete.entities.length, 1);
    assert.equal(beforeDelete.entities[0].type, 'project');
    assert.equal(beforeDelete.entities[0].id, project.id);

    // Delete the project
    db.deleteProject(project.id);

    // Observation should still exist but entity reference should be removed
    const afterDelete = db.getObservation(obs.id)!;
    assert.ok(afterDelete);
    assert.equal(afterDelete.entities.length, 0);
  });
});

// ---------------------------------------------------------------------------
// toSqlValue via updateRun (boolean handling)
// ---------------------------------------------------------------------------

describe('toSqlValue via updateRun', () => {
  let db: ShadowDatabase;
  let cleanup: () => void;

  before(() => {
    ({ db, cleanup } = createTestDb());
  });
  after(() => cleanup());

  it('boolean true is stored and retrieved correctly', () => {
    const repo = db.createRepo({ name: 'run-repo', path: '/tmp/run-repo' });
    const run = db.createRun({
      repoId: repo.id,
      kind: 'execution',
      prompt: 'Add input validation to the API',
    });
    assert.equal(run.archived, false);

    db.updateRun(run.id, { archived: true });
    const updated = db.getRun(run.id)!;
    assert.equal(updated.archived, true);

    // And back to false
    db.updateRun(run.id, { archived: false });
    const reverted = db.getRun(run.id)!;
    assert.equal(reverted.archived, false);
  });
});
