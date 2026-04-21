import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { ConfigSchema } from '../config/schema.js';
import type { ShadowConfig } from '../config/schema.js';

/**
 * Audit T-10: digests tests con mock LLM.
 *
 * Mockea `selectAdapter` del módulo `backend/index` para que cada digest
 * use un adapter sintético controlado (sin LLM real, sin red). Permite
 * testear:
 *   - Daily / weekly / brag paths cada uno llama al adapter
 *   - Tokens se registran en llm_usage
 *   - Digest row se crea (idempotente via getDigestByPeriod)
 *   - Brag doc valida `## ${quarter}` (P-01): output sin la section → skip
 *   - Budget skip: cuando daily token budget exhausted, digest returns
 *     skipped sin llamar al adapter
 */

type MockAdapterOutput = {
  status: 'success' | 'failure';
  output: string;
  inputTokens?: number;
  outputTokens?: number;
};

let currentMockOutput: MockAdapterOutput = { status: 'success', output: '## Default output', inputTokens: 100, outputTokens: 50 };
let adapterCalls = 0;
function setMockOutput(out: MockAdapterOutput) { currentMockOutput = out; }
function resetAdapterCalls() { adapterCalls = 0; }

mock.module('../backend/index.js', {
  namedExports: {
    selectAdapter: () => ({
      execute: async () => {
        adapterCalls++;
        return { ...currentMockOutput, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), exitCode: 0, summaryHint: null };
      },
    }),
  },
});

// Import AFTER mock is registered
const { ShadowDatabase } = await import('../storage/database.js');
const { activityDailyDigest, activityWeeklyDigest, activityBragDoc } = await import('./digests.js');

function createTestDb() {
  const dbPath = join(tmpdir(), `shadow-digests-${randomUUID()}.db`);
  const config: ShadowConfig = {
    ...ConfigSchema.parse({}),
    resolvedDataDir: tmpdir(),
    resolvedDatabasePath: dbPath,
    resolvedArtifactsDir: join(tmpdir(), 'artifacts'),
  };
  const db = new ShadowDatabase(config);
  return {
    db,
    config,
    cleanup: () => {
      try { db.close(); } catch { /* */ }
      try { unlinkSync(dbPath); } catch { /* */ }
      try { unlinkSync(dbPath + '-wal'); } catch { /* */ }
      try { unlinkSync(dbPath + '-shm'); } catch { /* */ }
    },
  };
}

describe('activityDailyDigest (audit T-10)', () => {
  let db: InstanceType<typeof ShadowDatabase>;
  let config: ShadowConfig;
  let cleanup: () => void;

  beforeEach(() => {
    ({ db, config, cleanup } = createTestDb());
    resetAdapterCalls();
  });
  afterEach(() => cleanup());

  it('calls LLM adapter once and persists digest row', async () => {
    setMockOutput({ status: 'success', output: '- Worked on feature X\n- Fixed bug Y', inputTokens: 150, outputTokens: 80 });
    const result = await activityDailyDigest(db, config);
    assert.equal(adapterCalls, 1, 'adapter should be called once');
    assert.ok(result.contentMd.length > 0);
    assert.equal(result.tokensUsed, 230);
    assert.equal(result.skipped, undefined);

    const today = new Date().toISOString().slice(0, 10);
    const digest = db.getDigestByPeriod('daily', today);
    assert.ok(digest, 'daily digest row should exist for today');
    assert.equal(digest.contentMd, '- Worked on feature X\n- Fixed bug Y');
  });

  it('upserts digest on second call for same day', async () => {
    setMockOutput({ status: 'success', output: 'first', inputTokens: 10, outputTokens: 10 });
    await activityDailyDigest(db, config);
    setMockOutput({ status: 'success', output: 'second', inputTokens: 20, outputTokens: 20 });
    await activityDailyDigest(db, config);

    const today = new Date().toISOString().slice(0, 10);
    const all = db.listDigests({ kind: 'daily', limit: 10 }).filter(d => d.periodStart === today);
    assert.equal(all.length, 1, 'should upsert, not create two rows');
    assert.equal(all[0].contentMd, 'second');
  });

  it('records llm_usage for daily', async () => {
    setMockOutput({ status: 'success', output: 'x', inputTokens: 100, outputTokens: 200 });
    await activityDailyDigest(db, config);
    const usage = db.rawDb.prepare('SELECT * FROM llm_usage WHERE source = ?').all('digest_daily') as Array<{ input_tokens: number; output_tokens: number }>;
    assert.equal(usage.length, 1);
    assert.equal(usage[0].input_tokens, 100);
    assert.equal(usage[0].output_tokens, 200);
  });
});

describe('activityWeeklyDigest (audit T-10)', () => {
  let db: InstanceType<typeof ShadowDatabase>;
  let config: ShadowConfig;
  let cleanup: () => void;

  beforeEach(() => {
    ({ db, config, cleanup } = createTestDb());
    resetAdapterCalls();
  });
  afterEach(() => cleanup());

  it('calls adapter once and persists weekly digest', async () => {
    setMockOutput({ status: 'success', output: '### Week summary\n- Shipped A, B, C', inputTokens: 300, outputTokens: 150 });
    const result = await activityWeeklyDigest(db, config);
    assert.equal(adapterCalls, 1);
    assert.equal(result.tokensUsed, 450);

    const latest = db.listDigests({ kind: 'weekly', limit: 1 })[0];
    assert.ok(latest);
    assert.equal(latest.contentMd, '### Week summary\n- Shipped A, B, C');
  });
});

describe('activityBragDoc (audit T-10 + P-01 validation)', () => {
  let db: InstanceType<typeof ShadowDatabase>;
  let config: ShadowConfig;
  let cleanup: () => void;

  beforeEach(() => {
    ({ db, config, cleanup } = createTestDb());
    resetAdapterCalls();
  });
  afterEach(() => cleanup());

  it('persists brag doc when output contains current quarter section', async () => {
    const q = `Q${Math.floor(new Date().getMonth() / 3) + 1}`;
    setMockOutput({ status: 'success', output: `# Brag Doc — ${new Date().getFullYear()}\n\n## ${q}\n### High Impact\n- Shipped X`, inputTokens: 500, outputTokens: 200 });
    const result = await activityBragDoc(db, config);
    assert.equal(adapterCalls, 1);
    assert.equal(result.skipped, undefined);
    assert.ok(result.contentMd.includes(`## ${q}`));

    const latest = db.listDigests({ kind: 'brag', limit: 1 })[0];
    assert.ok(latest);
  });

  it('skips + keeps existing when output is missing quarter section (P-01 guard)', async () => {
    // Seed an existing brag doc
    const q = `Q${Math.floor(new Date().getMonth() / 3) + 1}`;
    const existing = `# Brag Doc — ${new Date().getFullYear()}\n\n## ${q}\n### High Impact\n- Original content`;
    db.createDigest({
      kind: 'brag',
      periodStart: `${new Date().getFullYear()}-01-01`,
      periodEnd: new Date().toISOString().slice(0, 10),
      contentMd: existing,
      model: 'opus',
      tokensUsed: 100,
    });

    // LLM returns garbage (no ## Q section)
    setMockOutput({ status: 'success', output: 'I could not generate the brag doc this time.', inputTokens: 50, outputTokens: 20 });
    const result = await activityBragDoc(db, config);
    assert.equal(result.skipped, true);
    assert.ok(result.reason?.includes('missing'));
    // Existing content preserved
    assert.equal(result.contentMd, existing);
    const latest = db.listDigests({ kind: 'brag', limit: 1 })[0];
    assert.equal(latest.contentMd, existing, 'existing brag doc not overwritten');
  });

  it('skips when output is empty (P-01 guard)', async () => {
    setMockOutput({ status: 'success', output: '', inputTokens: 50, outputTokens: 0 });
    const result = await activityBragDoc(db, config);
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'empty output');
  });
});

describe('digest budget skip (audit A-10)', () => {
  let db: InstanceType<typeof ShadowDatabase>;
  let config: ShadowConfig;
  let cleanup: () => void;

  beforeEach(() => {
    ({ db, config, cleanup } = createTestDb());
    resetAdapterCalls();
  });
  afterEach(() => cleanup());

  it('returns skipped without calling adapter when dailyTokenBudget is exhausted', async () => {
    // Ensure profile exists before updating (updateProfile assumes the row is there)
    db.ensureProfile();
    db.updateProfile('default', {
      preferencesJson: { dailyTokenBudget: 100 },
    } as Record<string, unknown>);
    // Sanity check: budget actually landed in the profile
    const profile = db.ensureProfile();
    assert.equal((profile.preferences as Record<string, unknown>).dailyTokenBudget, 100);

    db.recordLlmUsage({ source: 'whatever', sourceId: null, model: 'opus', inputTokens: 500, outputTokens: 500 });

    setMockOutput({ status: 'success', output: 'should-not-run', inputTokens: 10, outputTokens: 10 });
    const result = await activityDailyDigest(db, config);
    assert.equal(result.skipped, true);
    assert.ok(result.reason);
    assert.equal(adapterCalls, 0, 'adapter not called when budget exhausted');
  });
});
