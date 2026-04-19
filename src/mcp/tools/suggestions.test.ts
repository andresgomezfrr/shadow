import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createTestToolContext, callTool, assertNotFound, seedSuggestion } from './_test-helpers.js';
import type { McpTool } from './types.js';

// Mock the suggestion engine — must be before importing suggestionTools
mock.module('../../suggestion/engine.js', {
  namedExports: {
    acceptSuggestion: (_db: unknown, _id: string, _cat?: string) => ({ ok: true, runCreated: undefined, taskCreated: undefined }),
    dismissSuggestion: async (_db: unknown, _id: string, _note?: string, _cat?: string) => ({ ok: true }),
    snoozeSuggestion: (_db: unknown, _id: string, _until: string) => ({ ok: true }),
  },
});

const { suggestionTools } = await import('./suggestions.js');

// ---------------------------------------------------------------------------
// shadow_suggestions (list)
// ---------------------------------------------------------------------------

describe('shadow_suggestions', () => {
  let tools: McpTool[];
  let db: ReturnType<typeof createTestToolContext>['db'];
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 1 });
    tools = suggestionTools(env.ctx);
    db = env.db;
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('returns empty for fresh DB', async () => {
    const result = await callTool(tools, 'shadow_suggestions', {}) as { data: { items: unknown[]; total: number } };
    assert.equal(result.data.items.length, 0);
    assert.equal(result.data.total, 0);
  });

  it('returns suggestions after seeding', async () => {
    seedSuggestion(db);
    seedSuggestion(db, { kind: 'feature' });
    const result = await callTool(tools, 'shadow_suggestions', {}) as { data: { items: any[]; total: number } };
    assert.equal(result.data.items.length, 2);
    assert.equal(result.data.total, 2);
  });

  it('filters by status', async () => {
    const sug = seedSuggestion(db);
    db.updateSuggestion(sug.id, { status: 'dismissed' });
    const open = await callTool(tools, 'shadow_suggestions', { status: 'open' }) as { data: { items: any[] } };
    assert.ok(open.data.items.every((s: any) => s.status === 'open'));
    const dismissed = await callTool(tools, 'shadow_suggestions', { status: 'dismissed' }) as { data: { items: any[] } };
    assert.ok(dismissed.data.items.length >= 1);
  });

  it('pagination works', async () => {
    const page1 = await callTool(tools, 'shadow_suggestions', { limit: 1, offset: 0 }) as { data: { items: any[]; total: number } };
    assert.equal(page1.data.items.length, 1);
    assert.ok(page1.data.total >= 2);
    const page2 = await callTool(tools, 'shadow_suggestions', { limit: 1, offset: 1 }) as { data: { items: any[] } };
    assert.equal(page2.data.items.length, 1);
    assert.notEqual(page1.data.items[0].id, page2.data.items[0].id);
  });

  it('compact mode omits body fields', async () => {
    const result = await callTool(tools, 'shadow_suggestions', { detail: false }) as { data: { items: any[] } };
    const item = result.data.items[0];
    assert.ok(item.id);
    assert.ok(item.title);
    assert.equal(item.summaryMd, undefined);
    assert.equal(item.reasoningMd, undefined);
  });

  it('detail mode includes full fields', async () => {
    const result = await callTool(tools, 'shadow_suggestions', { detail: true }) as { data: { items: any[] } };
    const item = result.data.items[0];
    assert.ok('summaryMd' in item);
  });
});

// ---------------------------------------------------------------------------
// shadow_suggest_accept
// ---------------------------------------------------------------------------

describe('shadow_suggest_accept', () => {
  let tools: McpTool[];
  let db: ReturnType<typeof createTestToolContext>['db'];
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 1 });
    tools = suggestionTools(env.ctx);
    db = env.db;
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('returns not-found for nonexistent suggestion', async () => {
    const result = await callTool(tools, 'shadow_suggest_accept', { suggestionId: 'nonexistent' });
    assertNotFound(result);
  });

  it('accepts suggestion via engine', async () => {
    const sug = seedSuggestion(db);
    const result = await callTool(tools, 'shadow_suggest_accept', { suggestionId: sug.id }) as any;
    assert.equal(result.data.accepted, true);
    assert.equal(result.data.suggestionId, sug.id);
  });
});

// ---------------------------------------------------------------------------
// shadow_suggest_dismiss
// ---------------------------------------------------------------------------

describe('shadow_suggest_dismiss', () => {
  let tools: McpTool[];
  let db: ReturnType<typeof createTestToolContext>['db'];
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 1 });
    tools = suggestionTools(env.ctx);
    db = env.db;
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('returns not-found for nonexistent suggestion', async () => {
    const result = await callTool(tools, 'shadow_suggest_dismiss', { suggestionId: 'nonexistent' });
    assertNotFound(result);
  });

  it('dismisses suggestion with note and category', async () => {
    const sug = seedSuggestion(db);
    const result = await callTool(tools, 'shadow_suggest_dismiss', {
      suggestionId: sug.id, note: 'not relevant', category: 'not_relevant',
    }) as any;
    assert.equal(result.data.dismissed, true);
    assert.equal(result.data.suggestionId, sug.id);
  });
});

// ---------------------------------------------------------------------------
// shadow_suggest_snooze
// ---------------------------------------------------------------------------

describe('shadow_suggest_snooze', () => {
  let tools: McpTool[];
  let db: ReturnType<typeof createTestToolContext>['db'];
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 1 });
    tools = suggestionTools(env.ctx);
    db = env.db;
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('returns not-found for nonexistent suggestion', async () => {
    const result = await callTool(tools, 'shadow_suggest_snooze', { suggestionId: 'nonexistent' });
    assertNotFound(result);
  });

  it('snoozes with default 72h', async () => {
    const sug = seedSuggestion(db);
    const before = Date.now();
    const result = await callTool(tools, 'shadow_suggest_snooze', { suggestionId: sug.id }) as any;
    assert.equal(result.data.snoozed, true);
    const untilDate = new Date(result.data.until as string).getTime();
    const expected72h = before + 72 * 3600_000;
    assert.ok(Math.abs(untilDate - expected72h) < 5000, 'until should be ~72h from now');
  });

  it('snoozes with custom hours', async () => {
    const sug = seedSuggestion(db);
    const before = Date.now();
    const result = await callTool(tools, 'shadow_suggest_snooze', { suggestionId: sug.id, hours: 24 }) as any;
    assert.equal(result.data.snoozed, true);
    const untilDate = new Date(result.data.until as string).getTime();
    const expected24h = before + 24 * 3600_000;
    assert.ok(Math.abs(untilDate - expected24h) < 5000, 'until should be ~24h from now');
  });
});
