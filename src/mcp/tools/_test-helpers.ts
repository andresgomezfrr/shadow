import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';

import { ConfigSchema } from '../../config/schema.js';
import type { ShadowConfig } from '../../config/schema.js';
import { ShadowDatabase } from '../../storage/database.js';
import type { McpTool, ToolContext } from './types.js';
import type { UserProfileRecord } from '../../storage/models.js';

// ---------------------------------------------------------------------------
// Test DB + ToolContext factory
// ---------------------------------------------------------------------------

type TestToolEnv = {
  ctx: ToolContext;
  tools: McpTool[];
  db: ShadowDatabase;
  config: ShadowConfig;
  cleanup: () => void;
};

/**
 * Create a real ToolContext backed by a tmpdir SQLite database.
 * Mirrors the context-building logic in createMcpTools() (server.ts:22-68).
 */
export function createTestToolContext(opts?: { trustLevel?: number }): TestToolEnv {
  const dbPath = join(tmpdir(), `shadow-mcp-test-${randomUUID()}.db`);
  const dataDir = join(tmpdir(), `shadow-mcp-data-${randomUUID()}`);
  const parsed = ConfigSchema.parse({});
  const config: ShadowConfig = {
    ...parsed,
    resolvedDataDir: dataDir,
    resolvedDatabasePath: dbPath,
    resolvedArtifactsDir: join(dataDir, 'artifacts'),
  };
  const db = new ShadowDatabase(config);

  // Ensure profile exists and set trust level if requested
  db.ensureProfile('default');
  if (opts?.trustLevel !== undefined) {
    setTrustLevel(db, opts.trustLevel);
  }

  // Build ToolContext — same logic as server.ts
  function getTrustLevel(): number {
    const profile = db.getProfile('default');
    return profile?.trustLevel ?? 0;
  }

  function deriveMood(): string {
    const recent = db.listRecentInteractions(10);
    if (recent.length === 0) return 'neutral';
    const sentiments = recent.map(i => i.sentiment).filter(Boolean);
    const positive = sentiments.filter(s => s === 'positive').length;
    const negative = sentiments.filter(s => s === 'negative').length;
    if (positive > negative + 2) return 'positive';
    if (negative > positive + 2) return 'concerned';
    return 'neutral';
  }

  function deriveGreeting(profile: UserProfileRecord): string {
    if (profile.focusMode === 'focus') return 'focus_mode_active';
    const lastInteraction = db.listRecentInteractions(1)[0];
    if (!lastInteraction) return 'first_session_ever';
    const hoursSince = (Date.now() - new Date(lastInteraction.createdAt).getTime()) / (1000 * 60 * 60);
    if (hoursSince > 24) return `back_after_${Math.round(hoursSince)}h`;
    if (hoursSince > 8) return 'new_day';
    if (hoursSince > 2) return `back_after_${Math.round(hoursSince)}h`;
    return 'continuing_session';
  }

  const trustNames: Record<number, string> = {
    1: 'observer', 2: 'advisor', 3: 'assistant', 4: 'partner', 5: 'shadow',
  };

  const ctx: ToolContext = { db, config, getTrustLevel, deriveMood, deriveGreeting, trustNames };

  // Lazy tool assembly — tools are created on first access to allow mocks to register first
  let _tools: McpTool[] | null = null;

  const cleanup = () => {
    db.close();
    try { unlinkSync(dbPath); } catch {}
    try { unlinkSync(dbPath + '-wal'); } catch {}
    try { unlinkSync(dbPath + '-shm'); } catch {}
  };

  return {
    ctx,
    get tools() {
      if (!_tools) {
        // Dynamic import avoided — tests build tools from individual modules
        _tools = [];
      }
      return _tools;
    },
    set tools(t: McpTool[]) { _tools = t; },
    db,
    config,
    cleanup,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Set trust level directly on the DB profile. */
export function setTrustLevel(db: ShadowDatabase, level: number): void {
  // Map level to minimum score for that level (from trust.ts thresholds)
  const scoreMap: Record<number, number> = { 1: 0, 2: 15, 3: 35, 4: 60, 5: 85 };
  const score = scoreMap[level] ?? 0;
  db.updateProfile('default', { trustLevel: level, trustScore: score });
}

/** Find a tool by name and call its handler. */
export async function callTool(tools: McpTool[], name: string, params: Record<string, unknown> = {}): Promise<unknown> {
  const tool = tools.find(t => t.name === name);
  if (!tool) throw new Error(`Tool not found: ${name}. Available: ${tools.map(t => t.name).join(', ')}`);
  return tool.handler(params);
}

/** Assert that a result is a not-found error. */
export function assertNotFound(result: unknown, substring?: string): void {
  const r = result as { isError?: boolean; message?: string; error?: string };
  const msg = r.message ?? r.error ?? '';
  assert.ok(r.isError === true || msg.toLowerCase().includes('not found'), `Expected not-found error, got: ${JSON.stringify(r)}`);
  if (substring) assert.ok(msg.includes(substring), `Expected message to contain "${substring}", got: ${msg}`);
}

// ---------------------------------------------------------------------------
// Seed helpers — create entities with minimal defaults
// ---------------------------------------------------------------------------

export function seedRepo(db: ShadowDatabase, overrides?: Partial<Parameters<typeof db.createRepo>[0]>) {
  return db.createRepo({ name: `test-repo-${randomUUID().slice(0, 8)}`, path: `/tmp/test-repo-${randomUUID()}`, ...overrides });
}

export function seedProject(db: ShadowDatabase, overrides?: Partial<Parameters<typeof db.createProject>[0]>) {
  return db.createProject({ name: `test-project-${randomUUID().slice(0, 8)}`, ...overrides });
}

export function seedObservation(db: ShadowDatabase, repoId: string, overrides?: Partial<Parameters<typeof db.createObservation>[0]>) {
  return db.createObservation({ repoId, kind: 'improvement', title: `obs-${randomUUID().slice(0, 8)}`, ...overrides });
}

export function seedSuggestion(db: ShadowDatabase, overrides?: Partial<Parameters<typeof db.createSuggestion>[0]>) {
  return db.createSuggestion({ kind: 'refactor', title: `sug-${randomUUID().slice(0, 8)}`, summaryMd: 'Test suggestion body.', ...overrides });
}

export function seedMemory(db: ShadowDatabase, overrides?: Partial<Parameters<typeof db.createMemory>[0]>) {
  return db.createMemory({
    layer: 'hot', scope: 'global', kind: 'insight',
    title: `mem-${randomUUID().slice(0, 8)}`,
    bodyMd: 'Test memory body content.',
    sourceType: 'heartbeat',
    ...overrides,
  });
}

export function seedTask(db: ShadowDatabase, repoIds?: string[], overrides?: Record<string, unknown>) {
  return db.createTask({ title: `task-${randomUUID().slice(0, 8)}`, repoIds, ...overrides });
}

export function seedContact(db: ShadowDatabase, overrides?: Partial<Parameters<typeof db.createContact>[0]>) {
  return db.createContact({ name: `contact-${randomUUID().slice(0, 8)}`, ...overrides });
}

export function seedSystem(db: ShadowDatabase, overrides?: Partial<Parameters<typeof db.createSystem>[0]>) {
  return db.createSystem({ name: `system-${randomUUID().slice(0, 8)}`, kind: 'service', ...overrides });
}
