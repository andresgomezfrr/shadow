import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';

import { ConfigSchema } from '../config/schema.js';
import type { ShadowConfig } from '../config/schema.js';
import { ShadowDatabase } from '../storage/database.js';
import { createMcpPrompts, listPrompts, getPrompt } from './prompts.js';
import { handleJsonRpcRequest } from './server.js';

function createTestDb(): { db: ShadowDatabase; config: ShadowConfig; cleanup: () => void } {
  const dbPath = join(tmpdir(), `shadow-prompts-test-${randomUUID()}.db`);
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
    config,
    cleanup: () => {
      db.close();
      try { unlinkSync(dbPath); } catch {}
      try { unlinkSync(dbPath + '-wal'); } catch {}
      try { unlinkSync(dbPath + '-shm'); } catch {}
    },
  };
}

describe('createMcpPrompts', () => {
  let db: ShadowDatabase;
  let config: ShadowConfig;
  let cleanup: () => void;

  before(() => {
    ({ db, config, cleanup } = createTestDb());
    db.ensureProfile();
  });
  after(() => cleanup());

  it('returns the 4 expected prompts with stable names', () => {
    const prompts = createMcpPrompts(db, config);
    const names = prompts.map((p) => p.name).sort();
    assert.deepEqual(names, [
      'shadow_audit_block',
      'shadow_morning_brief',
      'shadow_naming_vote',
      'shadow_scope_check',
    ]);
  });

  it('listPrompts omits the render function', () => {
    const prompts = createMcpPrompts(db, config);
    const list = listPrompts(prompts);
    for (const p of list) {
      assert.equal((p as { render?: unknown }).render, undefined);
      assert.ok(p.name);
      assert.ok(p.description);
    }
  });

  it('morning_brief renders without required args and includes counts', async () => {
    const prompts = createMcpPrompts(db, config);
    const result = await getPrompt(prompts, 'shadow_morning_brief', {});
    assert.equal(result.messages.length, 1);
    assert.equal(result.messages[0].role, 'user');
    const text = result.messages[0].content.text;
    assert.match(text, /Snapshot Shadow/);
    assert.match(text, /Observations HIGH abiertas/);
    assert.match(text, /Suggestions abiertas/);
    assert.match(text, /Plans activos/);
  });

  it('scope_check requires the task argument', async () => {
    const prompts = createMcpPrompts(db, config);
    await assert.rejects(
      () => getPrompt(prompts, 'shadow_scope_check', {}),
      /Missing required argument: task/,
    );
  });

  it('scope_check echoes the task in the rendered prompt', async () => {
    const prompts = createMcpPrompts(db, config);
    const result = await getPrompt(prompts, 'shadow_scope_check', { task: 'refactor migrations split' });
    const text = result.messages[0].content.text;
    assert.match(text, /refactor migrations split/);
    assert.match(text, /Foco actual/);
  });

  it('audit_block requires summary and includes trailer guidance', async () => {
    const prompts = createMcpPrompts(db, config);
    await assert.rejects(
      () => getPrompt(prompts, 'shadow_audit_block', {}),
      /Missing required argument: summary/,
    );
    const result = await getPrompt(prompts, 'shadow_audit_block', { summary: 'shipped F1-F5 features' });
    const text = result.messages[0].content.text;
    assert.match(text, /shipped F1-F5 features/);
    assert.match(text, /\[obs <id-prefix>\]/);
    assert.match(text, /NO Co-Authored-By/);
  });

  it('naming_vote requires domain and respects custom count', async () => {
    const prompts = createMcpPrompts(db, config);
    await assert.rejects(
      () => getPrompt(prompts, 'shadow_naming_vote', {}),
      /Missing required argument: domain/,
    );
    const result = await getPrompt(prompts, 'shadow_naming_vote', { domain: 'companion creature helper', count: 7 });
    const text = result.messages[0].content.text;
    assert.match(text, /companion creature helper/);
    assert.match(text, /Propón 7 candidatos/);
  });

  it('naming_vote clamps count to [1, 10]', async () => {
    const prompts = createMcpPrompts(db, config);
    const high = await getPrompt(prompts, 'shadow_naming_vote', { domain: 'x', count: 999 });
    assert.match(high.messages[0].content.text, /Propón 10 candidatos/);
    const low = await getPrompt(prompts, 'shadow_naming_vote', { domain: 'x', count: 0 });
    assert.match(low.messages[0].content.text, /Propón 1 candidatos/);
  });

  it('getPrompt throws for unknown name', async () => {
    const prompts = createMcpPrompts(db, config);
    await assert.rejects(
      () => getPrompt(prompts, 'shadow_does_not_exist', {}),
      /Prompt not found/,
    );
  });
});

describe('handleJsonRpcRequest — prompts', () => {
  let db: ShadowDatabase;
  let config: ShadowConfig;
  let cleanup: () => void;

  before(() => {
    ({ db, config, cleanup } = createTestDb());
    db.ensureProfile();
  });
  after(() => cleanup());

  it('prompts/list returns 4 entries with arguments metadata', async () => {
    const prompts = createMcpPrompts(db, config);
    const response = await handleJsonRpcRequest([], { jsonrpc: '2.0', id: 1, method: 'prompts/list' }, [], prompts) as { result: { prompts: Array<{ name: string; arguments?: unknown[] }> } };
    assert.equal(response.result.prompts.length, 4);
    const scopeCheck = response.result.prompts.find((p) => p.name === 'shadow_scope_check');
    assert.ok(scopeCheck);
    assert.equal(scopeCheck.arguments?.length, 1);
  });

  it('prompts/get with valid name returns messages', async () => {
    const prompts = createMcpPrompts(db, config);
    const response = await handleJsonRpcRequest(
      [],
      { jsonrpc: '2.0', id: 2, method: 'prompts/get', params: { name: 'shadow_morning_brief', arguments: {} } },
      [],
      prompts,
    ) as { result: { messages: Array<{ role: string; content: { type: string; text: string } }> } };
    assert.equal(response.result.messages[0].role, 'user');
    assert.equal(response.result.messages[0].content.type, 'text');
  });

  it('prompts/get with missing required arg returns -32602', async () => {
    const prompts = createMcpPrompts(db, config);
    const response = await handleJsonRpcRequest(
      [],
      { jsonrpc: '2.0', id: 3, method: 'prompts/get', params: { name: 'shadow_naming_vote', arguments: {} } },
      [],
      prompts,
    ) as { error: { code: number; message: string } };
    assert.equal(response.error.code, -32602);
    assert.match(response.error.message, /Missing required argument: domain/);
  });

  it('prompts/get with unknown name returns -32602', async () => {
    const prompts = createMcpPrompts(db, config);
    const response = await handleJsonRpcRequest(
      [],
      { jsonrpc: '2.0', id: 4, method: 'prompts/get', params: { name: 'bogus', arguments: {} } },
      [],
      prompts,
    ) as { error: { code: number; message: string } };
    assert.equal(response.error.code, -32602);
    assert.match(response.error.message, /Prompt not found/);
  });

  it('prompts/get without name param returns -32602', async () => {
    const response = await handleJsonRpcRequest(
      [],
      { jsonrpc: '2.0', id: 5, method: 'prompts/get', params: {} },
      [],
      [],
    ) as { error: { code: number; message: string } };
    assert.equal(response.error.code, -32602);
    assert.match(response.error.message, /Missing prompt name/);
  });
});
