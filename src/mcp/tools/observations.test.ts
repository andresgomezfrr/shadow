import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestToolContext, callTool, setTrustLevel, assertTrustBlocked, assertNotFound, seedRepo, seedObservation } from './_test-helpers.js';
import { observationTools } from './observations.js';
import type { McpTool } from './types.js';

// ---------------------------------------------------------------------------
// shadow_observations (list)
// ---------------------------------------------------------------------------

describe('shadow_observations', () => {
  let tools: McpTool[];
  let db: ReturnType<typeof createTestToolContext>['db'];
  let repoId: string;
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 2 });
    tools = observationTools(env.ctx);
    db = env.db;
    const repo = seedRepo(db);
    repoId = repo.id;
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('returns empty for fresh DB', async () => {
    const result = await callTool(tools, 'shadow_observations', {}) as { items: unknown[]; total: number };
    assert.equal(result.items.length, 0);
    assert.equal(result.total, 0);
  });

  it('returns observations after seeding', async () => {
    seedObservation(db, repoId, { title: 'obs-A', kind: 'risk' });
    seedObservation(db, repoId, { title: 'obs-B', kind: 'improvement' });
    const result = await callTool(tools, 'shadow_observations', {}) as { items: any[]; total: number };
    assert.equal(result.items.length, 2);
    assert.equal(result.total, 2);
  });

  it('filters by status', async () => {
    const obs = seedObservation(db, repoId, { title: 'obs-done' });
    db.updateObservationStatus(obs.id, 'done');
    const open = await callTool(tools, 'shadow_observations', { status: 'open' }) as { items: any[]; total: number };
    assert.ok(open.items.every((o: any) => o.status === 'open'));
    const done = await callTool(tools, 'shadow_observations', { status: 'done' }) as { items: any[]; total: number };
    assert.ok(done.items.length >= 1);
    assert.ok(done.items.every((o: any) => o.status === 'done'));
  });

  it('filters by kind', async () => {
    const result = await callTool(tools, 'shadow_observations', { kind: 'risk' }) as { items: any[]; total: number };
    assert.ok(result.items.every((o: any) => o.kind === 'risk'));
  });

  it('pagination works', async () => {
    const page1 = await callTool(tools, 'shadow_observations', { limit: 1, offset: 0 }) as { items: any[]; total: number };
    assert.equal(page1.items.length, 1);
    assert.ok(page1.total >= 2);
    const page2 = await callTool(tools, 'shadow_observations', { limit: 1, offset: 1 }) as { items: any[]; total: number };
    assert.equal(page2.items.length, 1);
    assert.notEqual(page1.items[0].id, page2.items[0].id);
  });

  it('compact mode omits detail', async () => {
    const result = await callTool(tools, 'shadow_observations', { detail: false }) as { items: any[] };
    const item = result.items[0];
    assert.ok(item.id);
    assert.ok(item.title);
    assert.equal(item.bodyMd, undefined, 'compact should not include bodyMd');
    assert.equal(item.context, undefined, 'compact should not include context');
  });

  it('detail mode includes full fields', async () => {
    const result = await callTool(tools, 'shadow_observations', { detail: true }) as { items: any[] };
    const item = result.items[0];
    assert.ok(item.id);
    assert.ok(item.title);
    // detail mode returns the full record, which includes createdAt, updatedAt, etc.
    assert.ok(item.createdAt);
  });
});

// ---------------------------------------------------------------------------
// shadow_observe
// ---------------------------------------------------------------------------

describe('shadow_observe', () => {
  let tools: McpTool[];
  let db: ReturnType<typeof createTestToolContext>['db'];
  let repoId: string;
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 2 });
    tools = observationTools(env.ctx);
    db = env.db;
    const repo = seedRepo(db);
    repoId = repo.id;
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('blocks at trust level 1 (requires 2)', async () => {
    setTrustLevel(db, 1);
    const result = await callTool(tools, 'shadow_observe', {});
    assertTrustBlocked(result);
    setTrustLevel(db, 2);
  });

  it('observes specific repo', async () => {
    const result = await callTool(tools, 'shadow_observe', { repoId }) as Record<string, unknown>;
    assert.equal(result.triggered, true);
    assert.equal(result.repoId, repoId);
    const repo = db.getRepo(repoId)!;
    assert.ok(repo.lastObservedAt);
  });

  it('returns error for nonexistent repo', async () => {
    const result = await callTool(tools, 'shadow_observe', { repoId: 'nonexistent-id' }) as Record<string, unknown>;
    assert.equal(result.isError, true);
  });

  it('observes all repos without repoId', async () => {
    const result = await callTool(tools, 'shadow_observe', {}) as Record<string, unknown>;
    assert.equal(result.triggered, true);
    assert.ok((result.repoCount as number) >= 1);
  });
});

// ---------------------------------------------------------------------------
// shadow_observation_ack
// ---------------------------------------------------------------------------

describe('shadow_observation_ack', () => {
  let tools: McpTool[];
  let db: ReturnType<typeof createTestToolContext>['db'];
  let repoId: string;
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 1 });
    tools = observationTools(env.ctx);
    db = env.db;
    const repo = seedRepo(db);
    repoId = repo.id;
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('blocks at trust level 0', async () => {
    setTrustLevel(db, 0);
    const result = await callTool(tools, 'shadow_observation_ack', { observationId: 'x' });
    assertTrustBlocked(result);
    setTrustLevel(db, 1);
  });

  it('returns error for nonexistent observation', async () => {
    const result = await callTool(tools, 'shadow_observation_ack', { observationId: 'nonexistent' });
    assertNotFound(result);
  });

  it('acknowledges open observation', async () => {
    const obs = seedObservation(db, repoId);
    const result = await callTool(tools, 'shadow_observation_ack', { observationId: obs.id }) as Record<string, unknown>;
    assert.equal(result.ok, true);
    assert.equal(result.status, 'acknowledged');
    const updated = db.getObservation(obs.id)!;
    assert.equal(updated.status, 'acknowledged');
  });

  it('rejects ack on non-open observation', async () => {
    const obs = seedObservation(db, repoId);
    db.updateObservationStatus(obs.id, 'acknowledged');
    const result = await callTool(tools, 'shadow_observation_ack', { observationId: obs.id }) as Record<string, unknown>;
    assert.equal(result.isError, true);
  });
});

// ---------------------------------------------------------------------------
// shadow_observation_resolve
// ---------------------------------------------------------------------------

describe('shadow_observation_resolve', () => {
  let tools: McpTool[];
  let db: ReturnType<typeof createTestToolContext>['db'];
  let repoId: string;
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 1 });
    tools = observationTools(env.ctx);
    db = env.db;
    const repo = seedRepo(db);
    repoId = repo.id;
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('returns error for nonexistent observation', async () => {
    const result = await callTool(tools, 'shadow_observation_resolve', { observationId: 'nonexistent' });
    assertNotFound(result);
  });

  it('resolves observation and creates feedback', async () => {
    const obs = seedObservation(db, repoId);
    const result = await callTool(tools, 'shadow_observation_resolve', { observationId: obs.id, reason: 'fixed it' }) as Record<string, unknown>;
    assert.equal(result.ok, true);
    assert.equal(result.status, 'done');
    const updated = db.getObservation(obs.id)!;
    assert.equal(updated.status, 'done');
    const feedback = db.listFeedback('observation');
    assert.ok(feedback.some((f: any) => f.targetId === obs.id && f.action === 'resolve'));
  });

  it('rejects resolve on already-done observation', async () => {
    const obs = seedObservation(db, repoId);
    db.updateObservationStatus(obs.id, 'done');
    const result = await callTool(tools, 'shadow_observation_resolve', { observationId: obs.id }) as Record<string, unknown>;
    assert.equal(result.isError, true);
  });
});

// ---------------------------------------------------------------------------
// shadow_observation_reopen
// ---------------------------------------------------------------------------

describe('shadow_observation_reopen', () => {
  let tools: McpTool[];
  let db: ReturnType<typeof createTestToolContext>['db'];
  let repoId: string;
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 1 });
    tools = observationTools(env.ctx);
    db = env.db;
    const repo = seedRepo(db);
    repoId = repo.id;
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('returns error for nonexistent observation', async () => {
    const result = await callTool(tools, 'shadow_observation_reopen', { observationId: 'nonexistent' });
    assertNotFound(result);
  });

  it('reopens done observation', async () => {
    const obs = seedObservation(db, repoId);
    db.updateObservationStatus(obs.id, 'done');
    const result = await callTool(tools, 'shadow_observation_reopen', { observationId: obs.id }) as Record<string, unknown>;
    assert.equal(result.ok, true);
    assert.equal(result.status, 'open');
    const updated = db.getObservation(obs.id)!;
    assert.equal(updated.status, 'open');
  });

  it('rejects reopen on already-open observation', async () => {
    const obs = seedObservation(db, repoId);
    const result = await callTool(tools, 'shadow_observation_reopen', { observationId: obs.id }) as Record<string, unknown>;
    assert.equal(result.isError, true);
  });
});
