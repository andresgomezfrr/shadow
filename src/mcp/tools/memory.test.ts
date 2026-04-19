import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestToolContext, callTool, assertNotFound, seedMemory, seedRepo } from './_test-helpers.js';
import { memoryTools } from './memory.js';
import type { McpTool } from './types.js';

// ---------------------------------------------------------------------------
// shadow_memory_search
// ---------------------------------------------------------------------------

describe('shadow_memory_search', () => {
  let tools: McpTool[];
  let db: ReturnType<typeof createTestToolContext>['db'];
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 1 });
    tools = memoryTools(env.ctx);
    db = env.db;
    seedMemory(db, { title: 'TypeScript strict mode', bodyMd: 'The project uses strict: true in tsconfig' });
    seedMemory(db, { title: 'WAL mode', bodyMd: 'SQLite configured with WAL for concurrent reads' });
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('finds by title', async () => {
    const result = await callTool(tools, 'shadow_memory_search', { query: 'TypeScript strict' }) as any;
    assert.ok(result.data.length >= 1);
  });

  it('finds by body', async () => {
    const result = await callTool(tools, 'shadow_memory_search', { query: 'WAL concurrent' }) as any;
    assert.ok(result.data.length >= 1);
  });

  it('returns empty for no match', async () => {
    const result = await callTool(tools, 'shadow_memory_search', { query: 'xyznonexistent99' }) as any;
    assert.equal(result.data.length, 0);
  });

  it('respects limit', async () => {
    const result = await callTool(tools, 'shadow_memory_search', { query: 'mode', limit: 1 }) as any;
    assert.ok(result.data.length <= 1);
  });
});

// ---------------------------------------------------------------------------
// shadow_memory_teach
// ---------------------------------------------------------------------------

describe('shadow_memory_teach', () => {
  let tools: McpTool[];
  let db: ReturnType<typeof createTestToolContext>['db'];
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 1 });
    tools = memoryTools(env.ctx);
    db = env.db;
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('creates memory with defaults', async () => {
    const result = await callTool(tools, 'shadow_memory_teach', {
      title: 'Port config', body: 'Shadow daemon runs on port 3700',
    }) as any;
    assert.ok(result.data.id);
    assert.equal(result.data.title, 'Port config');
    assert.equal(result.data.layer, 'working');
    assert.equal(result.data.scope, 'global');
    assert.equal(result.data.kind, 'taught');
  });

  it('creates memory with all fields', async () => {
    const result = await callTool(tools, 'shadow_memory_teach', {
      title: 'Custom memory', body: 'Detailed content',
      layer: 'hot', scope: 'repo', kind: 'design_decision', tags: ['arch'],
    }) as any;
    assert.equal(result.data.layer, 'hot');
    assert.equal(result.data.scope, 'repo');
    assert.equal(result.data.kind, 'design_decision');
  });

  it('links entity when entityType and entityId provided', async () => {
    const repo = seedRepo(db);
    const result = await callTool(tools, 'shadow_memory_teach', {
      title: 'Repo memory', body: 'Related to repo', entityType: 'repo', entityId: repo.id,
    }) as any;
    const mem = db.getMemory(result.data.id)!;
    assert.ok(mem.entities.length >= 1);
    assert.equal(mem.entities[0].type, 'repo');
    assert.equal(mem.entities[0].id, repo.id);
  });

  it('applies bond delta (depth axis grows with taught memories)', async () => {
    const profileBefore = db.getProfile('default')!;
    const depthBefore = profileBefore.bondAxes.depth;
    await callTool(tools, 'shadow_memory_teach', { title: 'Bond test', body: 'body' });
    const profileAfter = db.getProfile('default')!;
    assert.ok(
      profileAfter.bondAxes.depth >= depthBefore,
      'Depth axis should not decrease after teach',
    );
  });
});

// ---------------------------------------------------------------------------
// shadow_memory_forget
// ---------------------------------------------------------------------------

describe('shadow_memory_forget', () => {
  let tools: McpTool[];
  let db: ReturnType<typeof createTestToolContext>['db'];
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 1 });
    tools = memoryTools(env.ctx);
    db = env.db;
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('returns not-found', async () => {
    const result = await callTool(tools, 'shadow_memory_forget', { memoryId: 'nonexistent' });
    assertNotFound(result);
  });

  it('archives memory and creates feedback', async () => {
    const mem = seedMemory(db);
    const result = await callTool(tools, 'shadow_memory_forget', { memoryId: mem.id, reason: 'outdated' }) as any;
    assert.equal(result.ok, true);
    assert.equal(result.data.archived, mem.id);
    const updated = db.getMemory(mem.id)!;
    assert.ok(updated.archivedAt);
    const feedback = db.listFeedback('memory');
    assert.ok(feedback.some((f: any) => f.targetId === mem.id && f.action === 'archive'));
  });
});

// ---------------------------------------------------------------------------
// shadow_memory_update
// ---------------------------------------------------------------------------

describe('shadow_memory_update', () => {
  let tools: McpTool[];
  let db: ReturnType<typeof createTestToolContext>['db'];
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 1 });
    tools = memoryTools(env.ctx);
    db = env.db;
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('returns not-found', async () => {
    const result = await callTool(tools, 'shadow_memory_update', { memoryId: 'nonexistent', layer: 'hot' });
    assertNotFound(result);
  });

  it('rejects no updates', async () => {
    const mem = seedMemory(db);
    const result = await callTool(tools, 'shadow_memory_update', { memoryId: mem.id }) as any;
    assert.equal(result.ok, false);
    assert.ok((result.error as string).includes('No updates'));
  });

  it('updates layer', async () => {
    const mem = seedMemory(db, { layer: 'warm' });
    const result = await callTool(tools, 'shadow_memory_update', { memoryId: mem.id, layer: 'core' }) as any;
    assert.equal(result.ok, true);
    const updated = db.getMemory(mem.id)!;
    assert.equal(updated.layer, 'core');
  });

  it('updates body and creates feedback', async () => {
    const mem = seedMemory(db);
    const result = await callTool(tools, 'shadow_memory_update', { memoryId: mem.id, body: 'Updated body content' }) as any;
    assert.equal(result.ok, true);
    const updated = db.getMemory(mem.id)!;
    assert.equal(updated.bodyMd, 'Updated body content');
    const feedback = db.listFeedback('memory');
    assert.ok(feedback.some((f: any) => f.targetId === mem.id && f.action === 'modify'));
  });
});

// ---------------------------------------------------------------------------
// shadow_memory_list
// ---------------------------------------------------------------------------

describe('shadow_memory_list', () => {
  let tools: McpTool[];
  let db: ReturnType<typeof createTestToolContext>['db'];
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 1 });
    tools = memoryTools(env.ctx);
    db = env.db;
    seedMemory(db, { layer: 'hot', title: 'Hot memory', bodyMd: 'Hot body' });
    seedMemory(db, { layer: 'core', title: 'Core memory', bodyMd: 'Core body' });
    seedMemory(db, { layer: 'hot', title: 'Another hot', bodyMd: 'Body two' });
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('returns all memories with pagination', async () => {
    const result = await callTool(tools, 'shadow_memory_list', {}) as { data: { items: any[]; total: number } };
    assert.equal(result.data.items.length, 3);
    assert.equal(result.data.total, 3);
  });

  it('filters by layer', async () => {
    const result = await callTool(tools, 'shadow_memory_list', { layer: 'core' }) as { data: { items: any[]; total: number } };
    assert.ok(result.data.items.every((m: any) => m.layer === 'core'));
    assert.equal(result.data.total, 1);
  });

  it('compact mode omits bodyMd', async () => {
    const result = await callTool(tools, 'shadow_memory_list', { detail: false }) as { data: { items: any[] } };
    const item = result.data.items[0];
    assert.ok(item.id);
    assert.ok(item.title);
    assert.equal(item.bodyMd, undefined, 'compact should not include bodyMd');
  });

  it('detail mode includes bodyMd', async () => {
    const result = await callTool(tools, 'shadow_memory_list', { detail: true }) as { data: { items: any[] } };
    const item = result.data.items[0];
    assert.ok(item.bodyMd);
  });

  it('pagination works', async () => {
    const page1 = await callTool(tools, 'shadow_memory_list', { limit: 1, offset: 0 }) as { data: { items: any[]; total: number } };
    assert.equal(page1.data.items.length, 1);
    assert.equal(page1.data.total, 3);
    const page2 = await callTool(tools, 'shadow_memory_list', { limit: 1, offset: 1 }) as { data: { items: any[] } };
    assert.equal(page2.data.items.length, 1);
    assert.notEqual(page1.data.items[0].id, page2.data.items[0].id);
  });
});

// ---------------------------------------------------------------------------
// shadow_correct
// ---------------------------------------------------------------------------

describe('shadow_correct', () => {
  let tools: McpTool[];
  let db: ReturnType<typeof createTestToolContext>['db'];
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 1 });
    tools = memoryTools(env.ctx);
    db = env.db;
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('creates core-layer correction memory', async () => {
    const result = await callTool(tools, 'shadow_correct', {
      title: 'Fix wrong info', body: 'The correct information is X', scope: 'repo',
    }) as any;
    assert.equal(result.ok, true);
    const correction = result.data.correction as any;
    assert.equal(correction.kind, 'correction');
    assert.equal(correction.layer, 'core');
    const mem = db.getMemory(correction.id)!;
    assert.equal(mem.bodyMd, 'The correct information is X');
    assert.equal(mem.confidenceScore, 100);
  });

  it('links entity when provided', async () => {
    const repo = seedRepo(db);
    const result = await callTool(tools, 'shadow_correct', {
      body: 'Corrected info for repo', scope: 'repo', entityType: 'repo', entityId: repo.id,
    }) as any;
    assert.equal(result.ok, true);
    const correction = result.data.correction as any;
    // Check the entity was linked via raw DB (entities_json)
    const row = db.rawDb.prepare('SELECT entities_json FROM memories WHERE id = ?').get(correction.id) as any;
    const entities = JSON.parse(row.entities_json);
    assert.ok(entities.some((e: any) => e.type === 'repo' && e.id === repo.id));
  });
});
