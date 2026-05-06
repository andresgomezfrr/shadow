import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { unlinkSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';

import { ConfigSchema } from '../config/schema.js';
import type { ShadowConfig } from '../config/schema.js';
import { ShadowDatabase } from '../storage/database.js';
import { createMcpResources, listResources, readResource } from './resources.js';
import { handleJsonRpcRequest } from './server.js';

function createTestDb(): { db: ShadowDatabase; cleanup: () => void } {
  const dbPath = join(tmpdir(), `shadow-resources-test-${randomUUID()}.db`);
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

describe('createMcpResources', () => {
  let db: ShadowDatabase;
  let cleanup: () => void;

  before(() => {
    ({ db, cleanup } = createTestDb());
    db.ensureProfile();
  });
  after(() => cleanup());

  it('returns six read-only resources with stable URIs', () => {
    const resources = createMcpResources(db);
    const uris = resources.map((r) => r.uri).sort();
    assert.deepEqual(uris, [
      'shadow://contacts',
      'shadow://digests/latest',
      'shadow://observations/open',
      'shadow://plans/active',
      'shadow://profile/soul',
      'shadow://session/last-known',
    ]);
    for (const r of resources) {
      assert.equal(r.mimeType, 'application/json');
      assert.ok(r.name, `resource ${r.uri} should have a name`);
      assert.ok(r.description, `resource ${r.uri} should have a description`);
      assert.ok(r.annotations?.audience?.includes('assistant'), `resource ${r.uri} should target assistant`);
    }
  });

  it('listResources omits the read() function', () => {
    const resources = createMcpResources(db);
    const list = listResources(resources);
    for (const item of list) {
      assert.equal((item as { read?: unknown }).read, undefined);
      assert.ok(item.uri && item.mimeType);
    }
  });

  it('readResource returns valid JSON contents for profile/soul', async () => {
    const resources = createMcpResources(db);
    const result = await readResource(resources, 'shadow://profile/soul');
    assert.equal(result.uri, 'shadow://profile/soul');
    assert.equal(result.mimeType, 'application/json');
    const parsed = JSON.parse(result.text);
    assert.ok('soul' in parsed);
    assert.ok('bondTier' in parsed);
    assert.ok('locale' in parsed);
  });

  it('readResource for observations/open returns count + items', async () => {
    const resources = createMcpResources(db);
    const result = await readResource(resources, 'shadow://observations/open');
    const parsed = JSON.parse(result.text);
    assert.equal(typeof parsed.count, 'number');
    assert.ok(Array.isArray(parsed.items));
  });

  it('readResource throws on unknown uri', async () => {
    const resources = createMcpResources(db);
    await assert.rejects(
      () => readResource(resources, 'shadow://does-not-exist'),
      /Resource not found/,
    );
  });

  it('session/last-known returns interaction snapshot + open counts', async () => {
    const resources = createMcpResources(db);
    const result = await readResource(resources, 'shadow://session/last-known');
    const parsed = JSON.parse(result.text);
    assert.ok('lastSeenAt' in parsed);
    assert.ok('lastMood' in parsed);
    assert.ok(Array.isArray(parsed.recentInteractions));
    assert.equal(typeof parsed.openObservationsCount, 'number');
    assert.equal(typeof parsed.openSuggestionsCount, 'number');
  });
});

describe('plans resource', () => {
  let db: ShadowDatabase;
  let cleanup: () => void;
  let plansDir: string;
  const originalEnv = process.env.SHADOW_PLANS_DIR;

  before(() => {
    ({ db, cleanup } = createTestDb());
    db.ensureProfile();
    plansDir = join(tmpdir(), `shadow-plans-test-${randomUUID()}`);
    mkdirSync(plansDir, { recursive: true });
    process.env.SHADOW_PLANS_DIR = plansDir;
  });
  after(() => {
    cleanup();
    try { rmSync(plansDir, { recursive: true, force: true }); } catch {}
    if (originalEnv === undefined) delete process.env.SHADOW_PLANS_DIR;
    else process.env.SHADOW_PLANS_DIR = originalEnv;
  });

  it('lists plan files with mtime, size and first heading', async () => {
    // El env var se evalúa al crear el resource; para que tome efecto creamos
    // los archivos PRIMERO y luego instanciamos.
    writeFileSync(join(plansDir, 'foo-plan.md'), '# Foo plan title\n\nSome content here.\n');
    writeFileSync(join(plansDir, 'bar-plan.md'), '# Bar plan title\n\nMás texto.\n');
    writeFileSync(join(plansDir, 'ignored.txt'), 'not markdown');

    // re-importa el módulo para que tome el env actualizado
    const mod = await import(`./resources.js?fresh=${Date.now()}`);
    const freshResources = (mod as typeof import('./resources.js')).createMcpResources(db);
    const result = await readResource(freshResources, 'shadow://plans/active');
    const parsed = JSON.parse(result.text) as { dir: string; count: number; plans: Array<{ filename: string; firstHeading: string | null }> };

    assert.equal(parsed.count, 2, `expected 2 plans, got ${parsed.count}`);
    const filenames = parsed.plans.map((p) => p.filename).sort();
    assert.deepEqual(filenames, ['bar-plan.md', 'foo-plan.md']);
    const fooHeading = parsed.plans.find((p) => p.filename === 'foo-plan.md')?.firstHeading;
    assert.equal(fooHeading, 'Foo plan title');
  });

  it('returns empty list when plans dir does not exist', async () => {
    const missingDir = join(tmpdir(), `shadow-plans-missing-${randomUUID()}`);
    process.env.SHADOW_PLANS_DIR = missingDir;
    const mod = await import(`./resources.js?fresh=${Date.now()}-b`);
    const freshResources = (mod as typeof import('./resources.js')).createMcpResources(db);
    const result = await readResource(freshResources, 'shadow://plans/active');
    const parsed = JSON.parse(result.text);
    assert.equal(parsed.count, 0);
    assert.deepEqual(parsed.plans, []);
    process.env.SHADOW_PLANS_DIR = plansDir;
  });
});

describe('handleJsonRpcRequest — resources', () => {
  let db: ShadowDatabase;
  let cleanup: () => void;

  before(() => {
    ({ db, cleanup } = createTestDb());
    db.ensureProfile();
  });
  after(() => cleanup());

  it('resources/list returns the registered resources without read()', async () => {
    const resources = createMcpResources(db);
    const response = await handleJsonRpcRequest([], { jsonrpc: '2.0', id: 1, method: 'resources/list' }, resources) as { result: { resources: Array<{ uri: string }> } };
    assert.equal(response.result.resources.length, 6);
    assert.ok(response.result.resources.every((r) => r.uri.startsWith('shadow://')));
  });

  it('resources/read returns contents for a valid uri', async () => {
    const resources = createMcpResources(db);
    const response = await handleJsonRpcRequest(
      [],
      { jsonrpc: '2.0', id: 2, method: 'resources/read', params: { uri: 'shadow://contacts' } },
      resources,
    ) as { result: { contents: Array<{ uri: string; text: string }> } };
    assert.equal(response.result.contents.length, 1);
    assert.equal(response.result.contents[0].uri, 'shadow://contacts');
    const parsed = JSON.parse(response.result.contents[0].text);
    assert.equal(typeof parsed.count, 'number');
  });

  it('resources/read returns -32602 for missing uri param', async () => {
    const resources = createMcpResources(db);
    const response = await handleJsonRpcRequest(
      [],
      { jsonrpc: '2.0', id: 3, method: 'resources/read', params: {} },
      resources,
    ) as { error: { code: number; message: string } };
    assert.equal(response.error.code, -32602);
    assert.match(response.error.message, /Missing uri/);
  });

  it('resources/read returns error for unknown uri', async () => {
    const resources = createMcpResources(db);
    const response = await handleJsonRpcRequest(
      [],
      { jsonrpc: '2.0', id: 4, method: 'resources/read', params: { uri: 'shadow://bogus' } },
      resources,
    ) as { error: { code: number; message: string } };
    assert.equal(response.error.code, -32602);
    assert.match(response.error.message, /Resource not found/);
  });
});
