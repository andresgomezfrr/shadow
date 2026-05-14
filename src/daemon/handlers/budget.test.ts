import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';

import { ConfigSchema } from '../../config/schema.js';
import type { ShadowConfig } from '../../config/schema.js';
import { ShadowDatabase } from '../../storage/database.js';
import { EventBus } from '../../web/event-bus.js';
import { handleProgrammaticBudgetCheck, type BudgetCheckResult } from './budget.js';
import type { JobContext, DaemonSharedState } from '../job-handlers.js';

function makeConfig(overrides: Partial<ShadowConfig> = {}): ShadowConfig {
  const parsed = ConfigSchema.parse({});
  return {
    ...parsed,
    resolvedDataDir: tmpdir(),
    resolvedDatabasePath: join(tmpdir(), `budget-test-${randomUUID()}.db`),
    resolvedArtifactsDir: join(tmpdir(), 'artifacts'),
    ...overrides,
  };
}

function createDb(config: ShadowConfig): { db: ShadowDatabase; cleanup: () => void } {
  const db = new ShadowDatabase(config);
  return {
    db,
    cleanup: () => {
      db.close();
      try { unlinkSync(config.resolvedDatabasePath); } catch {}
      try { unlinkSync(config.resolvedDatabasePath + '-wal'); } catch {}
      try { unlinkSync(config.resolvedDatabasePath + '-shm'); } catch {}
    },
  };
}

function makeCtx(db: ShadowDatabase, config: ShadowConfig): JobContext {
  return {
    jobId: 'budget-job-' + randomUUID(),
    config,
    db,
    eventBus: new EventBus(),
    setPhase: () => undefined,
    signal: new AbortController().signal,
  };
}

const shared: DaemonSharedState = {
  draining: false,
  lastHeartbeatAt: null,
  nextHeartbeatAt: null,
  lastConsolidationAt: null,
  pendingGitEvents: [],
  pendingRemoteSyncResults: [],
  activeProjects: [],
  consecutiveIdleTicks: 0,
  consecutiveGhostJobs: 0,
  lastGhostHint: null,
  lastGhostCode: null,
  networkAvailable: true,
  systemAwake: true,
};

// 1M opus input + 1M opus output = $90. Use as a building block.
function seedOpusCall(db: ShadowDatabase, inputTokens: number, outputTokens: number): void {
  db.recordLlmUsage({ source: 'test', sourceId: null, model: 'opus', inputTokens, outputTokens });
}

describe('handleProgrammaticBudgetCheck', () => {
  it('returns level=ok when usage is well below budget', async () => {
    const config = makeConfig({ programmaticBudgetUsd: 200 });
    const { db, cleanup } = createDb(config);
    try {
      db.ensureProfile();
      // 100K input + 100K output @ opus → 100K * 15/1M + 100K * 75/1M = 1.5 + 7.5 = $9
      seedOpusCall(db, 100_000, 100_000);

      const result = await handleProgrammaticBudgetCheck(makeCtx(db, config), shared);
      const r = result.result as unknown as BudgetCheckResult;
      assert.equal(r.level, 'ok');
      assert.ok(r.monthlyUsd < 100);
      assert.equal(r.budgetUsd, 200);
    } finally {
      cleanup();
    }
  });

  it('returns level=warning_70 at 75% of budget', async () => {
    const config = makeConfig({ programmaticBudgetUsd: 100 });
    const { db, cleanup } = createDb(config);
    try {
      db.ensureProfile();
      // Need ~$75 → 1M opus input ($15) + ~800K opus output ($60) = $75
      seedOpusCall(db, 1_000_000, 800_000);

      const result = await handleProgrammaticBudgetCheck(makeCtx(db, config), shared);
      const r = result.result as unknown as BudgetCheckResult;
      assert.equal(r.level, 'warning_70');
      assert.ok(r.pct >= 70 && r.pct < 90);
    } finally {
      cleanup();
    }
  });

  it('returns level=warning_90 at 95% of budget', async () => {
    const config = makeConfig({ programmaticBudgetUsd: 100 });
    const { db, cleanup } = createDb(config);
    try {
      db.ensureProfile();
      // ~$95 → 1M opus input ($15) + ~1.07M opus output ($80) ≈ $95
      seedOpusCall(db, 1_000_000, 1_067_000);

      const result = await handleProgrammaticBudgetCheck(makeCtx(db, config), shared);
      const r = result.result as unknown as BudgetCheckResult;
      assert.equal(r.level, 'warning_90');
      assert.ok(r.pct >= 90 && r.pct < 100);
    } finally {
      cleanup();
    }
  });

  it('returns level=over_100 when budget exceeded', async () => {
    const config = makeConfig({ programmaticBudgetUsd: 50 });
    const { db, cleanup } = createDb(config);
    try {
      db.ensureProfile();
      // 1M opus input + 1M opus output = $90 > $50
      seedOpusCall(db, 1_000_000, 1_000_000);

      const result = await handleProgrammaticBudgetCheck(makeCtx(db, config), shared);
      const r = result.result as unknown as BudgetCheckResult;
      assert.equal(r.level, 'over_100');
      assert.ok(r.pct >= 100);
    } finally {
      cleanup();
    }
  });

  it('byModel breakdown includes called models only', async () => {
    const config = makeConfig({ programmaticBudgetUsd: 200 });
    const { db, cleanup } = createDb(config);
    try {
      db.ensureProfile();
      db.recordLlmUsage({ source: 'a', sourceId: null, model: 'sonnet', inputTokens: 100_000, outputTokens: 50_000 });
      db.recordLlmUsage({ source: 'b', sourceId: null, model: 'haiku', inputTokens: 100_000, outputTokens: 50_000 });

      const result = await handleProgrammaticBudgetCheck(makeCtx(db, config), shared);
      const r = result.result as unknown as BudgetCheckResult;
      assert.ok(r.byModel.sonnet);
      assert.ok(r.byModel.haiku);
      assert.equal(r.byModel.opus, undefined);
    } finally {
      cleanup();
    }
  });
});
