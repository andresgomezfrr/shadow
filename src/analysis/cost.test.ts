import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';

import { ConfigSchema } from '../config/schema.js';
import type { ShadowConfig } from '../config/schema.js';
import { ShadowDatabase } from '../storage/database.js';
import { estimateCallCostUsd, normalizeModelKey, monthlyProgrammaticCostUsd, MODEL_PRICING_USD } from './cost.js';

function createTestDb(): { db: ShadowDatabase; cleanup: () => void } {
  const dbPath = join(tmpdir(), `shadow-cost-test-${randomUUID()}.db`);
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

describe('normalizeModelKey', () => {
  it('maps short aliases', () => {
    assert.equal(normalizeModelKey('opus'), 'opus');
    assert.equal(normalizeModelKey('sonnet'), 'sonnet');
    assert.equal(normalizeModelKey('haiku'), 'haiku');
  });

  it('maps fully-qualified Anthropic ids', () => {
    assert.equal(normalizeModelKey('claude-opus-4-7'), 'opus');
    assert.equal(normalizeModelKey('claude-sonnet-4-6'), 'sonnet');
    assert.equal(normalizeModelKey('claude-haiku-4-5-20251001'), 'haiku');
  });

  it('is case-insensitive', () => {
    assert.equal(normalizeModelKey('OPUS'), 'opus');
    assert.equal(normalizeModelKey('Claude-Sonnet-4-6'), 'sonnet');
  });

  it('returns null for unknown model', () => {
    assert.equal(normalizeModelKey('gpt-4'), null);
    assert.equal(normalizeModelKey('llama-3'), null);
  });
});

describe('estimateCallCostUsd', () => {
  it('opus 1M input + 1M output = $15 + $75 = $90', () => {
    const usd = estimateCallCostUsd({ model: 'opus', inputTokens: 1_000_000, outputTokens: 1_000_000 });
    const expected = MODEL_PRICING_USD.opus.inputPerMillion + MODEL_PRICING_USD.opus.outputPerMillion;
    assert.equal(usd, expected);
  });

  it('proportional sub-million', () => {
    const usd = estimateCallCostUsd({ model: 'sonnet', inputTokens: 10_000, outputTokens: 5_000 });
    const expected = (10_000 / 1_000_000) * MODEL_PRICING_USD.sonnet.inputPerMillion
      + (5_000 / 1_000_000) * MODEL_PRICING_USD.sonnet.outputPerMillion;
    assert.equal(usd.toFixed(6), expected.toFixed(6));
  });

  it('haiku is the cheapest tier', () => {
    const opusUsd = estimateCallCostUsd({ model: 'opus', inputTokens: 100_000, outputTokens: 100_000 });
    const sonnetUsd = estimateCallCostUsd({ model: 'sonnet', inputTokens: 100_000, outputTokens: 100_000 });
    const haikuUsd = estimateCallCostUsd({ model: 'haiku', inputTokens: 100_000, outputTokens: 100_000 });
    assert.ok(haikuUsd < sonnetUsd && sonnetUsd < opusUsd);
  });

  it('unknown model = 0 (under-estimate over panic)', () => {
    const usd = estimateCallCostUsd({ model: 'gpt-4', inputTokens: 1_000_000, outputTokens: 1_000_000 });
    assert.equal(usd, 0);
  });
});

describe('monthlyProgrammaticCostUsd', () => {
  let db: ShadowDatabase;
  let cleanup: () => void;

  before(() => {
    ({ db, cleanup } = createTestDb());
    db.ensureProfile();
  });
  after(() => cleanup());

  it('returns zero totals when llm_usage is empty', () => {
    const summary = monthlyProgrammaticCostUsd(db);
    assert.equal(summary.totalUsd, 0);
    assert.equal(summary.totalCalls, 0);
    assert.deepEqual(summary.byModel, {});
    assert.deepEqual(summary.bySource, {});
  });

  it('aggregates by model and source', () => {
    db.recordLlmUsage({ source: 'heartbeat_summarize', sourceId: null, model: 'opus', inputTokens: 100_000, outputTokens: 50_000 });
    db.recordLlmUsage({ source: 'heartbeat_summarize', sourceId: null, model: 'opus', inputTokens: 200_000, outputTokens: 100_000 });
    db.recordLlmUsage({ source: 'suggest_generate', sourceId: null, model: 'sonnet', inputTokens: 50_000, outputTokens: 25_000 });

    const summary = monthlyProgrammaticCostUsd(db);
    assert.equal(summary.totalCalls, 3);
    assert.equal(summary.totalInputTokens, 350_000);
    assert.equal(summary.totalOutputTokens, 175_000);
    assert.ok(summary.byModel.opus);
    assert.equal(summary.byModel.opus.calls, 2);
    assert.equal(summary.bySource.heartbeat_summarize.calls, 2);
    assert.equal(summary.bySource.suggest_generate.calls, 1);
  });

  it('filters by month prefix', () => {
    // Inject a row dated last month directly
    db.rawDb.prepare(
      `INSERT INTO llm_usage (id, source, source_id, model, input_tokens, output_tokens, created_at)
       VALUES (?, 'old_source', NULL, 'opus', 999999, 999999, '2026-01-15T10:00:00Z')`,
    ).run(randomUUID());

    // Default month query should NOT include January row
    const current = monthlyProgrammaticCostUsd(db);
    assert.equal(current.bySource.old_source, undefined);

    // Explicit January query should
    const jan = monthlyProgrammaticCostUsd(db, '2026-01');
    assert.ok(jan.bySource.old_source);
  });
});
