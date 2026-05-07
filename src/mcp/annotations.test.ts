import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';

import { ConfigSchema } from '../config/schema.js';
import type { ShadowConfig } from '../config/schema.js';
import { ShadowDatabase } from '../storage/database.js';
import {
  createMcpTools,
  handleJsonRpcRequest,
  inferAnnotations,
  type McpTool,
  type McpToolAnnotations,
} from './server.js';

function createTestDb(): { db: ShadowDatabase; cleanup: () => void; config: ShadowConfig } {
  const dbPath = join(tmpdir(), `shadow-annot-test-${randomUUID()}.db`);
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

describe('inferAnnotations — sufijos', () => {
  it('classifies _list/_view/_search/_get as readOnly + idempotent', () => {
    for (const name of ['shadow_memory_list', 'shadow_run_view', 'shadow_memory_search', 'shadow_repo_get']) {
      const a = inferAnnotations(name);
      assert.equal(a.readOnlyHint, true, `${name} should be readOnly`);
      assert.equal(a.idempotentHint, true, `${name} should be idempotent`);
      assert.notEqual(a.destructiveHint, true);
    }
  });

  it('classifies _remove/_archive/_close/_forget/_ack as destructive', () => {
    for (const name of ['shadow_task_remove', 'shadow_run_archive', 'shadow_task_close', 'shadow_memory_forget', 'shadow_alert_ack', 'shadow_observation_resolve']) {
      const a = inferAnnotations(name);
      assert.equal(a.destructiveHint, true, `${name} should be destructive`);
      assert.equal(a.idempotentHint, false, `${name} should not be idempotent`);
    }
  });

  it('classifies _create/_add/_update/_teach/_observe as mutating non-readOnly', () => {
    for (const name of ['shadow_task_create', 'shadow_repo_add', 'shadow_memory_update', 'shadow_memory_teach', 'shadow_observe', 'shadow_correct']) {
      const a = inferAnnotations(name);
      assert.equal(a.readOnlyHint, false, `${name} should not be readOnly`);
      assert.equal(a.idempotentHint, false, `${name} should not be idempotent`);
    }
  });

  it('classifies bare-name read tools (digest, profile, soul, usage, events)', () => {
    for (const name of ['shadow_profile', 'shadow_soul', 'shadow_usage', 'shadow_events', 'shadow_digest', 'shadow_daily_summary', 'shadow_active_projects', 'shadow_project_detail', 'shadow_enrichment_config']) {
      const a = inferAnnotations(name);
      assert.equal(a.readOnlyHint, true, `${name} should be readOnly`);
    }
  });

  it('unknown name falls through to empty (no hints)', () => {
    const a = inferAnnotations('shadow_fictitious_xyz');
    assert.deepEqual(a, {});
  });
});

describe('inferAnnotations — coverage of real tool surface', () => {
  let db: ShadowDatabase;
  let config: ShadowConfig;
  let cleanup: () => void;

  before(() => {
    ({ db, config, cleanup } = createTestDb());
    db.ensureProfile();
  });
  after(() => cleanup());

  it('every registered tool gets at least one hint inferred (≤3 unclassified allowed)', () => {
    const tools = createMcpTools(db, config);
    const unclassified = tools
      .map((t) => ({ name: t.name, hints: inferAnnotations(t.name) }))
      .filter(({ hints }) => Object.keys(hints).length === 0)
      .map((x) => x.name);

    assert.ok(
      unclassified.length <= 3,
      `expected ≤3 unclassified tools, got ${unclassified.length}: ${unclassified.join(', ')}`,
    );
  });
});

describe('tools/list — annotations emission', () => {
  let db: ShadowDatabase;
  let config: ShadowConfig;
  let cleanup: () => void;

  before(() => {
    ({ db, config, cleanup } = createTestDb());
    db.ensureProfile();
  });
  after(() => cleanup());

  it('emits annotations object only when at least one hint is present', async () => {
    const tools = createMcpTools(db, config);
    const response = await handleJsonRpcRequest(tools, { jsonrpc: '2.0', id: 1, method: 'tools/list' }) as { result: { tools: Array<{ name: string; annotations?: McpToolAnnotations }> } };

    const sample = response.result.tools.find((t) => t.name === 'shadow_memory_list');
    assert.ok(sample, 'shadow_memory_list should be in tools list');
    assert.ok(sample.annotations, 'shadow_memory_list should have annotations');
    assert.equal(sample.annotations.readOnlyHint, true);
    assert.equal(sample.annotations.idempotentHint, true);

    const mutating = response.result.tools.find((t) => t.name === 'shadow_task_create');
    assert.ok(mutating?.annotations);
    assert.equal(mutating.annotations.readOnlyHint, false);

    const destructive = response.result.tools.find((t) => t.name === 'shadow_task_remove');
    assert.ok(destructive?.annotations);
    assert.equal(destructive.annotations.destructiveHint, true);
  });

  it('explicit annotations on tool override the inferred defaults', async () => {
    // Inyectamos un tool sintético que sobrescribe el inferido.
    const overridden: McpTool = {
      name: 'shadow_memory_list', // inferido readOnly:true
      description: 'override test',
      inputSchema: {},
      handler: async () => ({ ok: true }),
      annotations: { readOnlyHint: false, openWorldHint: true },
    };
    const response = await handleJsonRpcRequest([overridden], { jsonrpc: '2.0', id: 2, method: 'tools/list' }) as { result: { tools: Array<{ annotations?: McpToolAnnotations }> } };
    const out = response.result.tools[0].annotations;
    assert.equal(out?.readOnlyHint, false, 'explicit override should win');
    assert.equal(out?.openWorldHint, true, 'openWorldHint should pass through');
    // El idempotentHint inferido sigue presente porque el override solo
    // declaró readOnlyHint y openWorldHint.
    assert.equal(out?.idempotentHint, true);
  });

  it('does not emit annotations when name does not match any pattern', async () => {
    const noHint: McpTool = {
      name: 'shadow_xyz_no_pattern_match_at_all',
      description: 'fictional',
      inputSchema: {},
      handler: async () => ({ ok: true }),
    };
    const response = await handleJsonRpcRequest([noHint], { jsonrpc: '2.0', id: 3, method: 'tools/list' }) as { result: { tools: Array<{ name: string; annotations?: McpToolAnnotations }> } };
    assert.equal(response.result.tools[0].annotations, undefined);
  });
});
