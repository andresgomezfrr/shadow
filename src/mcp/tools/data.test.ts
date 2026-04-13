import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createTestToolContext, callTool, assertNotFound, seedRepo, seedProject, seedMemory, seedObservation, seedSuggestion } from './_test-helpers.js';
import type { McpTool } from './types.js';

// ---------------------------------------------------------------------------
// Mocks — must be before importing dataTools
// ---------------------------------------------------------------------------

mock.module('../../memory/search.js', {
  namedExports: {
    vectorSearch: async () => [],
    hybridSearch: async () => [],
  },
});

mock.module('../../analysis/digests.js', {
  namedExports: {
    activityDailyDigest: async () => ({ contentMd: '# Daily\nTest digest', tokensUsed: 100 }),
    activityWeeklyDigest: async () => ({ contentMd: '# Weekly\nTest digest', tokensUsed: 200 }),
    activityBragDoc: async () => ({ contentMd: '# Brag\nTest doc', tokensUsed: 300 }),
  },
});

mock.module('../../observation/mcp-discovery.js', {
  namedExports: {
    discoverMcpServerNames: () => ['test-server-a', 'test-server-b'],
  },
});

mock.module('../../memory/dedup.js', {
  namedExports: {
    checkDuplicate: async () => ({ action: 'create' }),
    checkMemoryDuplicate: async () => ({ action: 'create' }),
    checkEnrichmentDuplicate: async () => ({ action: 'create' }),
  },
});

mock.module('../../memory/lifecycle.js', {
  namedExports: {
    generateAndStoreEmbedding: async () => {},
  },
});

const { dataTools } = await import('./data.js');

// ---------------------------------------------------------------------------
// shadow_events
// ---------------------------------------------------------------------------

describe('shadow_events', () => {
  let tools: McpTool[];
  let db: ReturnType<typeof createTestToolContext>['db'];
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 2 });
    tools = dataTools(env.ctx);
    db = env.db;
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('returns empty for fresh DB', async () => {
    const result = await callTool(tools, 'shadow_events', {}) as unknown[];
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 0);
  });

  it('returns pending events', async () => {
    db.createEvent({ kind: 'new_observation', priority: 5, payload: { message: 'test event' } });
    const result = await callTool(tools, 'shadow_events', {}) as any[];
    assert.ok(result.length >= 1);
  });
});

// ---------------------------------------------------------------------------
// shadow_events_ack
// ---------------------------------------------------------------------------

describe('shadow_events_ack', () => {
  let tools: McpTool[];
  let db: ReturnType<typeof createTestToolContext>['db'];
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 1 });
    tools = dataTools(env.ctx);
    db = env.db;
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('acknowledges all events', async () => {
    db.createEvent({ kind: 'new_suggestion', priority: 3, payload: { message: 'e1' } });
    db.createEvent({ kind: 'new_observation', priority: 5, payload: { message: 'e2' } });
    const result = await callTool(tools, 'shadow_events_ack', {}) as Record<string, unknown>;
    assert.equal(result.ok, true);
    assert.ok((result.acknowledged as number) >= 2);
    const remaining = db.listPendingEvents();
    assert.equal(remaining.length, 0);
  });
});

// ---------------------------------------------------------------------------
// shadow_search
// ---------------------------------------------------------------------------

describe('shadow_search', () => {
  let tools: McpTool[];
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 1 });
    tools = dataTools(env.ctx);
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('returns results array (mocked search returns empty)', async () => {
    const result = await callTool(tools, 'shadow_search', { query: 'test query' }) as unknown[];
    assert.ok(Array.isArray(result));
  });
});

// ---------------------------------------------------------------------------
// shadow_run_list
// ---------------------------------------------------------------------------

describe('shadow_run_list', () => {
  let tools: McpTool[];
  let db: ReturnType<typeof createTestToolContext>['db'];
  let repoId: string;
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 2 });
    tools = dataTools(env.ctx);
    db = env.db;
    repoId = seedRepo(db).id;
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('returns empty', async () => {
    const result = await callTool(tools, 'shadow_run_list', {}) as { items: unknown[]; total: number };
    assert.equal(result.items.length, 0);
  });

  it('returns runs with filters', async () => {
    db.createRun({ repoId, kind: 'task', prompt: 'test run 1' });
    db.createRun({ repoId, kind: 'task', prompt: 'test run 2' });
    const result = await callTool(tools, 'shadow_run_list', {}) as { items: any[]; total: number };
    assert.equal(result.items.length, 2);
    assert.equal(result.total, 2);
  });

  it('pagination works', async () => {
    const page1 = await callTool(tools, 'shadow_run_list', { limit: 1 }) as { items: any[]; total: number };
    assert.equal(page1.items.length, 1);
    assert.ok(page1.total >= 2);
  });
});

// ---------------------------------------------------------------------------
// shadow_run_view
// ---------------------------------------------------------------------------

describe('shadow_run_view', () => {
  let tools: McpTool[];
  let db: ReturnType<typeof createTestToolContext>['db'];
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 1 });
    tools = dataTools(env.ctx);
    db = env.db;
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('returns not-found', async () => {
    const result = await callTool(tools, 'shadow_run_view', { runId: 'nonexistent' });
    assertNotFound(result);
  });

  it('returns run details', async () => {
    const repo = seedRepo(db);
    const run = db.createRun({ repoId: repo.id, kind: 'task', prompt: 'implement X' });
    const result = await callTool(tools, 'shadow_run_view', { runId: run.id }) as any;
    assert.equal(result.id, run.id);
    assert.equal(result.prompt, 'implement X');
  });
});

// ---------------------------------------------------------------------------
// shadow_run_create
// ---------------------------------------------------------------------------

describe('shadow_run_create', () => {
  let tools: McpTool[];
  let db: ReturnType<typeof createTestToolContext>['db'];
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 2 });
    tools = dataTools(env.ctx);
    db = env.db;
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('returns not-found for nonexistent repo', async () => {
    const result = await callTool(tools, 'shadow_run_create', { repoId: 'nonexistent', prompt: 'test' });
    assertNotFound(result);
  });

  it('creates run', async () => {
    const repo = seedRepo(db);
    const result = await callTool(tools, 'shadow_run_create', { repoId: repo.id, prompt: 'add feature X' }) as Record<string, unknown>;
    assert.equal(result.ok, true);
    assert.ok(result.runId);
    const run = db.getRun(result.runId as string)!;
    assert.equal(run.repoId, repo.id);
  });
});

// ---------------------------------------------------------------------------
// shadow_run_archive
// ---------------------------------------------------------------------------

describe('shadow_run_archive', () => {
  let tools: McpTool[];
  let db: ReturnType<typeof createTestToolContext>['db'];
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 1 });
    tools = dataTools(env.ctx);
    db = env.db;
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('returns not-found', async () => {
    const result = await callTool(tools, 'shadow_run_archive', { runId: 'nonexistent' });
    assertNotFound(result);
  });

  it('archives run', async () => {
    const repo = seedRepo(db);
    const run = db.createRun({ repoId: repo.id, kind: 'task', prompt: 'test' });
    const result = await callTool(tools, 'shadow_run_archive', { runId: run.id }) as Record<string, unknown>;
    assert.equal(result.ok, true);
    assert.equal(result.archived, true);
    const updated = db.getRun(run.id)!;
    assert.equal(updated.archived, true);
  });
});

// ---------------------------------------------------------------------------
// shadow_usage
// ---------------------------------------------------------------------------

describe('shadow_usage', () => {
  let tools: McpTool[];
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 1 });
    tools = dataTools(env.ctx);
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('returns usage for day', async () => {
    const result = await callTool(tools, 'shadow_usage', {}) as Record<string, unknown>;
    assert.equal(typeof result.totalInputTokens, 'number');
    assert.equal(typeof result.totalOutputTokens, 'number');
    assert.equal(typeof result.totalCalls, 'number');
  });

  it('accepts period parameter', async () => {
    const result = await callTool(tools, 'shadow_usage', { period: 'week' }) as Record<string, unknown>;
    assert.ok('totalCalls' in result);
  });
});

// ---------------------------------------------------------------------------
// shadow_daily_summary
// ---------------------------------------------------------------------------

describe('shadow_daily_summary', () => {
  let tools: McpTool[];
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 1 });
    tools = dataTools(env.ctx);
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('returns summary structure', async () => {
    const result = await callTool(tools, 'shadow_daily_summary', {}) as Record<string, unknown>;
    assert.ok(result.date);
    assert.ok(result.activity);
    assert.ok(result.tokens);
    assert.ok('bondTier' in result);
  });
});

// ---------------------------------------------------------------------------
// shadow_digest
// ---------------------------------------------------------------------------

describe('shadow_digest', () => {
  let tools: McpTool[];
  let db: ReturnType<typeof createTestToolContext>['db'];
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 1 });
    tools = dataTools(env.ctx);
    db = env.db;
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('generates daily digest', async () => {
    const result = await callTool(tools, 'shadow_digest', { kind: 'daily' }) as Record<string, unknown>;
    assert.equal(result.ok, true);
    assert.equal(result.kind, 'daily');
    assert.ok(result.contentMd);
  });

  it('generates weekly digest', async () => {
    const result = await callTool(tools, 'shadow_digest', { kind: 'weekly' }) as Record<string, unknown>;
    assert.equal(result.ok, true);
    assert.equal(result.kind, 'weekly');
  });

  it('generates brag doc', async () => {
    const result = await callTool(tools, 'shadow_digest', { kind: 'brag' }) as Record<string, unknown>;
    assert.equal(result.ok, true);
    assert.equal(result.kind, 'brag');
  });
});

// ---------------------------------------------------------------------------
// shadow_digests (list)
// ---------------------------------------------------------------------------

describe('shadow_digests', () => {
  let tools: McpTool[];
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 1 });
    tools = dataTools(env.ctx);
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('returns empty for fresh DB', async () => {
    const result = await callTool(tools, 'shadow_digests', {}) as unknown[];
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 0);
  });
});

// ---------------------------------------------------------------------------
// shadow_enrichment_config
// ---------------------------------------------------------------------------

describe('shadow_enrichment_config', () => {
  let tools: McpTool[];
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 1 });
    tools = dataTools(env.ctx);
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('returns config with discovered servers', async () => {
    const result = await callTool(tools, 'shadow_enrichment_config', {}) as Record<string, unknown>;
    assert.ok('enabled' in result);
    assert.ok('availableMcpServers' in result);
    const servers = result.availableMcpServers as any[];
    assert.equal(servers.length, 2);
    assert.equal(servers[0].name, 'test-server-a');
  });
});

// ---------------------------------------------------------------------------
// shadow_enrichment_query
// ---------------------------------------------------------------------------

describe('shadow_enrichment_query', () => {
  let tools: McpTool[];
  let db: ReturnType<typeof createTestToolContext>['db'];
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 1 });
    tools = dataTools(env.ctx);
    db = env.db;
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('returns empty for fresh DB', async () => {
    const result = await callTool(tools, 'shadow_enrichment_query', {}) as { items: unknown[]; total: number };
    assert.equal(result.items.length, 0);
    assert.equal(result.total, 0);
  });

  it('returns entries after seeding', async () => {
    const project = seedProject(db);
    db.upsertEnrichment({
      source: 'test-server',
      entityType: 'project',
      entityId: project.id,
      entityName: project.name,
      summary: 'Test enrichment finding',
      contentHash: 'abc123',
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
    const result = await callTool(tools, 'shadow_enrichment_query', {}) as { items: any[]; total: number };
    assert.ok(result.items.length >= 1);
  });

  it('filters by source', async () => {
    const result = await callTool(tools, 'shadow_enrichment_query', { source: 'test-server' }) as { items: any[] };
    assert.ok(result.items.every((e: any) => e.source === 'test-server'));
  });
});

// ---------------------------------------------------------------------------
// shadow_enrichment_write
// ---------------------------------------------------------------------------

describe('shadow_enrichment_write', () => {
  let tools: McpTool[];
  let db: ReturnType<typeof createTestToolContext>['db'];
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 1 });
    tools = dataTools(env.ctx);
    db = env.db;
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('returns error for nonexistent project', async () => {
    const result = await callTool(tools, 'shadow_enrichment_write', {
      projectId: 'nonexistent', source: 'test', summary: 'test',
    }) as Record<string, unknown>;
    assert.equal(result.ok, false);
  });

  it('creates enrichment entry', async () => {
    const project = seedProject(db);
    const result = await callTool(tools, 'shadow_enrichment_write', {
      projectId: project.id, source: 'test-mcp', summary: 'Found important finding',
    }) as Record<string, unknown>;
    assert.equal(result.ok, true);
    assert.equal(result.action, 'created');
    assert.ok(result.ttl);
  });
});
