import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createTestToolContext, callTool, seedRepo, seedObservation, seedProject } from './_test-helpers.js';
import { statusTools } from './status.js';
import type { McpTool } from './types.js';

// ---------------------------------------------------------------------------
// Helper: write daemon.json to control getDaemonState
// ---------------------------------------------------------------------------

function writeDaemonState(dataDir: string, state: Record<string, unknown>): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(resolve(dataDir, 'daemon.json'), JSON.stringify(state), 'utf-8');
}

// ---------------------------------------------------------------------------
// shadow_check_in
// ---------------------------------------------------------------------------

describe('shadow_check_in', () => {
  let tools: McpTool[];
  let db: ReturnType<typeof createTestToolContext>['db'];
  let config: ReturnType<typeof createTestToolContext>['config'];
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 5 });
    tools = statusTools(env.ctx);
    db = env.db;
    config = env.config;
    mkdirSync(config.resolvedDataDir, { recursive: true });
    writeDaemonState(config.resolvedDataDir, { alerts: [], updateAvailable: null });
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('returns profile, mood, greeting for fresh DB', async () => {
    const result = await callTool(tools, 'shadow_check_in', {}) as Record<string, unknown>;
    assert.ok(result.trustLevel);
    assert.equal(result.mood, 'neutral');
    assert.equal(result.greeting, 'first_session_ever');
    assert.ok(Array.isArray(result.pendingEvents));
    assert.equal(typeof result.pendingSuggestions, 'number');
    assert.ok('todayTokens' in result);
    assert.ok('todayLlmCalls' in result);
  });

  it('returns context when repoPath matches a tracked repo', async () => {
    const repo = seedRepo(db, { name: 'ctx-repo', path: '/tmp/ctx-repo-test' });
    const project = seedProject(db, { repoIds: [repo.id] });
    seedObservation(db, repo.id, { title: 'ctx obs' });
    const result = await callTool(tools, 'shadow_check_in', { repoPath: '/tmp/ctx-repo-test' }) as Record<string, unknown>;
    assert.equal(result.contextRepo, repo.id);
    assert.ok(Array.isArray(result.contextProjects));
    assert.ok((result.contextProjects as string[]).includes(project.id));
  });

  it('applies trust delta on check_in', async () => {
    const profileBefore = db.getProfile('default')!;
    const scoreBefore = profileBefore.trustScore;
    await callTool(tools, 'shadow_check_in', {});
    const profileAfter = db.getProfile('default')!;
    assert.ok(profileAfter.trustScore > scoreBefore);
  });

  it('includes update notification when available', async () => {
    writeDaemonState(config.resolvedDataDir, { alerts: [], updateAvailable: '1.2.3' });
    const result = await callTool(tools, 'shadow_check_in', {}) as Record<string, unknown>;
    assert.equal(result.updateAvailable, '1.2.3');
  });

  it('includes active alerts', async () => {
    writeDaemonState(config.resolvedDataDir, {
      alerts: [{ id: 'test_alert', message: 'Test alert', severity: 'warning', since: new Date().toISOString() }],
      updateAvailable: null,
    });
    const result = await callTool(tools, 'shadow_check_in', {}) as Record<string, unknown>;
    const alerts = result.activeAlerts as any[];
    assert.ok(alerts.length >= 1);
    assert.equal(alerts[0].id, 'test_alert');
  });
});

// ---------------------------------------------------------------------------
// shadow_status
// ---------------------------------------------------------------------------

describe('shadow_status', () => {
  let tools: McpTool[];
  let db: ReturnType<typeof createTestToolContext>['db'];
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 3 });
    tools = statusTools(env.ctx);
    db = env.db;
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('returns correct counts for fresh DB', async () => {
    const result = await callTool(tools, 'shadow_status', {}) as Record<string, unknown>;
    assert.equal(result.trustLevel, 3);
    assert.equal(result.repoCount, 0);
    assert.equal(typeof result.pendingSuggestions, 'number');
    assert.equal(typeof result.pendingEvents, 'number');
    assert.ok(result.usageToday);
  });

  it('returns updated counts after seeding', async () => {
    seedRepo(db);
    seedRepo(db);
    const result = await callTool(tools, 'shadow_status', {}) as Record<string, unknown>;
    assert.equal(result.repoCount, 2);
  });
});

// ---------------------------------------------------------------------------
// shadow_available
// ---------------------------------------------------------------------------

describe('shadow_available', () => {
  let tools: McpTool[];
  let db: ReturnType<typeof createTestToolContext>['db'];
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 1 });
    tools = statusTools(env.ctx);
    db = env.db;
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('clears focus mode', async () => {
    db.updateProfile('default', { focusMode: 'focus', focusUntil: new Date().toISOString() });
    const result = await callTool(tools, 'shadow_available', {}) as Record<string, unknown>;
    assert.equal(result.ok, true);
    assert.equal(result.mode, 'available');
    const profile = db.getProfile('default')!;
    assert.equal(profile.focusMode, null);
    assert.equal(profile.focusUntil, null);
  });
});

// ---------------------------------------------------------------------------
// shadow_alerts
// ---------------------------------------------------------------------------

describe('shadow_alerts', () => {
  let tools: McpTool[];
  let config: ReturnType<typeof createTestToolContext>['config'];
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 1 });
    tools = statusTools(env.ctx);
    config = env.config;
    mkdirSync(config.resolvedDataDir, { recursive: true });
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('returns empty alerts when no daemon state', async () => {
    const result = await callTool(tools, 'shadow_alerts', {}) as { alerts: unknown[]; count: number };
    assert.ok(Array.isArray(result.alerts));
    assert.equal(result.count, 0);
  });

  it('returns alerts from daemon state', async () => {
    writeDaemonState(config.resolvedDataDir, {
      alerts: [{ id: 'health_check', message: 'Backend unhealthy', severity: 'error', since: '2026-01-01T00:00:00Z' }],
    });
    const result = await callTool(tools, 'shadow_alerts', {}) as { alerts: any[]; count: number };
    assert.equal(result.count, 1);
    assert.equal(result.alerts[0].id, 'health_check');
  });
});

// ---------------------------------------------------------------------------
// shadow_alert_ack
// ---------------------------------------------------------------------------

describe('shadow_alert_ack', () => {
  let tools: McpTool[];
  let db: ReturnType<typeof createTestToolContext>['db'];
  let config: ReturnType<typeof createTestToolContext>['config'];
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 1 });
    tools = statusTools(env.ctx);
    db = env.db;
    config = env.config;
    mkdirSync(config.resolvedDataDir, { recursive: true });
    writeDaemonState(config.resolvedDataDir, {
      alerts: [{ id: 'test_ack', message: 'Ack me', severity: 'warning', since: '2026-01-01T00:00:00Z' }],
    });
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('returns error for nonexistent alert', async () => {
    const result = await callTool(tools, 'shadow_alert_ack', { id: 'nonexistent' }) as Record<string, unknown>;
    assert.equal(result.ok, false);
  });

  it('writes ack to alert-actions.jsonl', async () => {
    const result = await callTool(tools, 'shadow_alert_ack', { id: 'test_ack' }) as Record<string, unknown>;
    assert.equal(result.ok, true);
    assert.equal(result.action, 'acked');
    const actionsPath = resolve(config.resolvedDataDir, 'alert-actions.jsonl');
    assert.ok(existsSync(actionsPath));
    const content = readFileSync(actionsPath, 'utf-8');
    const action = JSON.parse(content.trim().split('\n').pop()!);
    assert.equal(action.action, 'ack');
    assert.equal(action.id, 'test_ack');
  });
});

// ---------------------------------------------------------------------------
// shadow_alert_resolve
// ---------------------------------------------------------------------------

describe('shadow_alert_resolve', () => {
  let tools: McpTool[];
  let db: ReturnType<typeof createTestToolContext>['db'];
  let config: ReturnType<typeof createTestToolContext>['config'];
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 1 });
    tools = statusTools(env.ctx);
    db = env.db;
    config = env.config;
    mkdirSync(config.resolvedDataDir, { recursive: true });
    writeDaemonState(config.resolvedDataDir, {
      alerts: [{ id: 'test_resolve', message: 'Resolve me', severity: 'error', since: '2026-01-01T00:00:00Z' }],
    });
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('returns error for nonexistent alert', async () => {
    const result = await callTool(tools, 'shadow_alert_resolve', { id: 'nonexistent' }) as Record<string, unknown>;
    assert.equal(result.ok, false);
  });

  it('writes resolve to alert-actions.jsonl', async () => {
    const result = await callTool(tools, 'shadow_alert_resolve', { id: 'test_resolve' }) as Record<string, unknown>;
    assert.equal(result.ok, true);
    assert.equal(result.action, 'resolved');
    const actionsPath = resolve(config.resolvedDataDir, 'alert-actions.jsonl');
    const content = readFileSync(actionsPath, 'utf-8');
    const lines = content.trim().split('\n');
    const last = JSON.parse(lines[lines.length - 1]);
    assert.equal(last.action, 'resolve');
    assert.equal(last.id, 'test_resolve');
  });
});
