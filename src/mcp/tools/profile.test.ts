import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestToolContext, callTool, seedMemory } from './_test-helpers.js';
import { profileTools } from './profile.js';
import type { McpTool } from './types.js';

// ---------------------------------------------------------------------------
// shadow_profile
// ---------------------------------------------------------------------------

describe('shadow_profile', () => {
  let tools: McpTool[];
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 1 });
    tools = profileTools(env.ctx);
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('returns default profile', async () => {
    const result = await callTool(tools, 'shadow_profile') as Record<string, unknown>;
    assert.ok(result.id);
    assert.equal(result.trustLevel, 1);
    assert.ok(result.proactivityLevel);
  });
});

// ---------------------------------------------------------------------------
// shadow_profile_set
// ---------------------------------------------------------------------------

describe('shadow_profile_set', () => {
  let tools: McpTool[];
  let db: ReturnType<typeof createTestToolContext>['db'];
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 1 });
    tools = profileTools(env.ctx);
    db = env.db;
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('sets displayName', async () => {
    const result = await callTool(tools, 'shadow_profile_set', { key: 'displayName', value: 'TestUser' }) as Record<string, unknown>;
    assert.equal(result.ok, true);
    assert.equal(result.set, 'displayName');
    assert.equal(result.value, 'TestUser');
    const profile = db.getProfile('default')!;
    assert.equal(profile.displayName, 'TestUser');
  });

  it('sets proactivityLevel', async () => {
    const result = await callTool(tools, 'shadow_profile_set', { key: 'proactivityLevel', value: '7' }) as Record<string, unknown>;
    assert.equal(result.ok, true);
    assert.equal(result.value, 7);
  });

  it('rejects invalid proactivityLevel value', async () => {
    const result = await callTool(tools, 'shadow_profile_set', { key: 'proactivityLevel', value: '99' }) as Record<string, unknown>;
    assert.equal(result.isError, true);
  });
});

// ---------------------------------------------------------------------------
// shadow_focus
// ---------------------------------------------------------------------------

describe('shadow_focus', () => {
  let tools: McpTool[];
  let db: ReturnType<typeof createTestToolContext>['db'];
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 1 });
    tools = profileTools(env.ctx);
    db = env.db;
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('sets indefinite focus mode', async () => {
    const result = await callTool(tools, 'shadow_focus', {}) as Record<string, unknown>;
    assert.equal(result.ok, true);
    assert.equal(result.mode, 'focus');
    assert.ok(typeof result.until === 'string');
    const profile = db.getProfile('default')!;
    assert.equal(profile.focusMode, 'focus');
  });

  it('sets focus mode with 2h duration', async () => {
    const result = await callTool(tools, 'shadow_focus', { duration: '2h' }) as Record<string, unknown>;
    assert.equal(result.ok, true);
    assert.ok(typeof result.until === 'string');
    assert.ok((result.until as string).includes('T'), 'Expected ISO date string for until');
  });

  it('sets focus mode with 30m duration', async () => {
    const result = await callTool(tools, 'shadow_focus', { duration: '30m' }) as Record<string, unknown>;
    assert.equal(result.ok, true);
    assert.ok(typeof result.until === 'string');
  });
});

// ---------------------------------------------------------------------------
// shadow_feedback
// ---------------------------------------------------------------------------

describe('shadow_feedback', () => {
  let tools: McpTool[];
  let db: ReturnType<typeof createTestToolContext>['db'];
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 1 });
    tools = profileTools(env.ctx);
    db = env.db;
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('returns empty for fresh DB', async () => {
    const result = await callTool(tools, 'shadow_feedback', {}) as unknown[];
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 0);
  });

  it('returns feedback after creation', async () => {
    db.createFeedback({ targetKind: 'observation', targetId: 'obs-1', action: 'resolve', note: 'fixed' });
    db.createFeedback({ targetKind: 'suggestion', targetId: 'sug-1', action: 'dismiss', note: 'not relevant' });
    const result = await callTool(tools, 'shadow_feedback', {}) as unknown[];
    assert.equal(result.length, 2);
  });

  it('filters by targetKind', async () => {
    const result = await callTool(tools, 'shadow_feedback', { targetKind: 'observation' }) as unknown[];
    assert.ok(result.length >= 1);
    assert.ok(result.every((f: any) => f.targetKind === 'observation'));
  });

  it('respects limit', async () => {
    const result = await callTool(tools, 'shadow_feedback', { limit: 1 }) as unknown[];
    assert.equal(result.length, 1);
  });
});

// ---------------------------------------------------------------------------
// shadow_soul
// ---------------------------------------------------------------------------

describe('shadow_soul', () => {
  let tools: McpTool[];
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 1 });
    tools = profileTools(env.ctx);
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('returns exists=false when no soul', async () => {
    const result = await callTool(tools, 'shadow_soul') as Record<string, unknown>;
    assert.equal(result.exists, false);
    assert.equal(result.body, null);
  });
});

// ---------------------------------------------------------------------------
// shadow_soul_update
// ---------------------------------------------------------------------------

describe('shadow_soul_update', () => {
  let tools: McpTool[];
  let db: ReturnType<typeof createTestToolContext>['db'];
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 1 });
    tools = profileTools(env.ctx);
    db = env.db;
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('creates soul on first call', async () => {
    const result = await callTool(tools, 'shadow_soul_update', { body: 'My soul reflection content' }) as Record<string, unknown>;
    assert.equal(result.ok, true);
    assert.equal(result.action, 'created');
    assert.ok(result.memoryId);
  });

  it('updates soul on second call', async () => {
    const result = await callTool(tools, 'shadow_soul_update', { body: 'Updated soul content' }) as Record<string, unknown>;
    assert.equal(result.ok, true);
    assert.equal(result.action, 'updated');
  });

  it('soul_read returns updated content', async () => {
    const result = await callTool(tools, 'shadow_soul') as Record<string, unknown>;
    assert.equal(result.exists, true);
    assert.equal(result.body, 'Updated soul content');
  });
});
