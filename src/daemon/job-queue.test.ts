import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';

import { ConfigSchema } from '../config/schema.js';
import type { ShadowConfig } from '../config/schema.js';
import { ShadowDatabase } from '../storage/database.js';
import { EventBus } from '../web/event-bus.js';
import { JobQueue } from './job-queue.js';
import type { JobHandlerEntry, JobContext, DaemonSharedState } from './job-handlers.js';
import { isScheduleReady, nextScheduledAt } from './schedules.js';
import type { ClockSchedule } from './schedules.js';

// --- Test helpers ---

function createTestDb() {
  const dbPath = join(tmpdir(), `shadow-test-jq-${randomUUID()}.db`);
  const config: ShadowConfig = {
    ...ConfigSchema.parse({ env: 'test', maxConcurrentJobs: 2 }),
    resolvedDataDir: tmpdir(),
    resolvedDatabasePath: dbPath,
    resolvedArtifactsDir: join(tmpdir(), 'artifacts'),
  };
  const db = new ShadowDatabase(config);
  return {
    db,
    config,
    cleanup: () => {
      try { db.close(); } catch {}
      try { unlinkSync(dbPath); } catch {}
      try { unlinkSync(dbPath + '-wal'); } catch {}
      try { unlinkSync(dbPath + '-shm'); } catch {}
    },
  };
}

function createHandlers(): Map<string, JobHandlerEntry> {
  const handlers = new Map<string, JobHandlerEntry>();
  handlers.set('fast-llm', {
    category: 'llm',
    fn: async (ctx: JobContext) => {
      ctx.setPhase('working');
      return { llmCalls: 1, tokensUsed: 100, phases: ['working'], result: { ok: true } };
    },
  });
  handlers.set('slow-llm', {
    category: 'llm',
    fn: async (ctx: JobContext) => {
      await new Promise(r => setTimeout(r, 50));
      ctx.setPhase('done');
      return { llmCalls: 1, tokensUsed: 200, phases: ['done'], result: { ok: true } };
    },
  });
  handlers.set('another-llm', {
    category: 'llm',
    fn: async (ctx: JobContext) => {
      ctx.setPhase('processing');
      return { llmCalls: 2, tokensUsed: 300, phases: ['processing'], result: { ok: true } };
    },
  });
  handlers.set('third-llm', {
    category: 'llm',
    fn: async () => ({ llmCalls: 1, tokensUsed: 50, phases: ['fast'], result: { ok: true } }),
  });
  handlers.set('fast-io', {
    category: 'io',
    fn: async () => ({ llmCalls: 0, tokensUsed: 0, phases: ['synced'], result: { ok: true } }),
  });
  handlers.set('failing', {
    category: 'llm',
    fn: async () => { throw new Error('boom'); },
  });
  return handlers;
}

function createShared(): DaemonSharedState {
  return {
    draining: false,
    lastHeartbeatAt: null, nextHeartbeatAt: null, lastConsolidationAt: null,
    pendingGitEvents: [], pendingRemoteSyncResults: [], activeProjects: [],
    consecutiveIdleTicks: 0,
    consecutiveGhostJobs: 0,
    lastGhostHint: null,
  };
}

// --- Tests ---

describe('JobQueue', () => {
  // Each test gets its own db to avoid contamination between tests.
  // All handlers finish fast (<50ms) so drainAll is sufficient.

  it('returns false when no jobs are queued', async () => {
    const { db, config, cleanup } = createTestDb();
    const q = new JobQueue(config, db, new EventBus(), createHandlers(), createShared());
    try {
      assert.equal(await q.tick(), false);
    } finally { cleanup(); }
  });

  it('claims a queued job and completes it', async () => {
    const { db, config, cleanup } = createTestDb();
    const q = new JobQueue(config, db, new EventBus(), createHandlers(), createShared());
    try {
      db.enqueueJob('fast-llm');
      assert.equal(await q.tick(), true);
      await q.drainAll(2000);
      const job = db.listJobs({ type: 'fast-llm' })[0];
      assert.equal(job.status, 'completed');
      assert.deepEqual(job.result, { ok: true });
      assert.equal(job.llmCalls, 1);
      assert.equal(job.tokensUsed, 100);
      assert.deepEqual(job.phases, ['working']);
      assert.ok(job.durationMs !== null);
      assert.ok(job.finishedAt !== null);
    } finally { cleanup(); }
  });

  it('respects maxConcurrentJobs for LLM jobs', async () => {
    const { db, config, cleanup } = createTestDb();
    const q = new JobQueue(config, db, new EventBus(), createHandlers(), createShared());
    try {
      // config has maxConcurrentJobs = 2, enqueue 3 different LLM types
      db.enqueueJob('slow-llm');
      db.enqueueJob('another-llm');
      db.enqueueJob('third-llm');
      await q.tick();
      // At most 2 should have been claimed
      const queued = db.listJobs({ status: 'queued' });
      assert.ok(queued.length >= 1, `Expected at least 1 still queued, got ${queued.length}`);
      await q.drainAll(2000);
      // Second tick picks up the remaining
      await q.tick();
      await q.drainAll(2000);
      assert.equal(db.listJobs({ status: 'completed' }).length, 3);
    } finally { cleanup(); }
  });

  it('same-type exclusion prevents concurrent same-type jobs', async () => {
    const { db, config, cleanup } = createTestDb();
    const q = new JobQueue(config, db, new EventBus(), createHandlers(), createShared());
    try {
      db.enqueueJob('slow-llm');
      db.enqueueJob('slow-llm');
      await q.tick();
      // Only 1 should be running (same-type exclusion)
      assert.equal(q.activeCount, 1);
      await q.drainAll(2000);
      // Second tick picks up the other
      await q.tick();
      await q.drainAll(2000);
      assert.equal(db.listJobs({ status: 'completed' }).length, 2);
    } finally { cleanup(); }
  });

  it('allows different types to run concurrently', async () => {
    const { db, config, cleanup } = createTestDb();
    const q = new JobQueue(config, db, new EventBus(), createHandlers(), createShared());
    try {
      db.enqueueJob('fast-llm');
      db.enqueueJob('another-llm');
      await q.tick();
      await q.drainAll(2000);
      assert.equal(db.listJobs({ status: 'completed' }).length, 2);
    } finally { cleanup(); }
  });

  it('IO jobs do not consume LLM capacity', async () => {
    const { db, config, cleanup } = createTestDb();
    const q = new JobQueue(config, db, new EventBus(), createHandlers(), createShared());
    try {
      db.enqueueJob('fast-io');
      db.enqueueJob('fast-llm');
      db.enqueueJob('another-llm');
      await q.tick();
      await q.drainAll(2000);
      // All 3 should complete: IO doesn't count against LLM limit
      assert.equal(db.listJobs({ status: 'completed' }).length, 3);
    } finally { cleanup(); }
  });

  it('failing job has status=failed with error', async () => {
    const { db, config, cleanup } = createTestDb();
    const q = new JobQueue(config, db, new EventBus(), createHandlers(), createShared());
    try {
      db.enqueueJob('failing');
      await q.tick();
      await q.drainAll(2000);
      const job = db.listJobs({ type: 'failing' })[0];
      assert.equal(job.status, 'failed');
      assert.equal((job.result as Record<string, unknown>).error, 'boom');
    } finally { cleanup(); }
  });

  it('marks unknown job type as failed immediately', async () => {
    const { db, config, cleanup } = createTestDb();
    const q = new JobQueue(config, db, new EventBus(), createHandlers(), createShared());
    try {
      db.enqueueJob('nonexistent');
      await q.tick();
      const job = db.listJobs({ type: 'nonexistent' })[0];
      assert.equal(job.status, 'failed');
      assert.match(String((job.result as Record<string, unknown>).error), /unknown job type/);
    } finally { cleanup(); }
  });

  it('subsequent ticks pick up remaining queued jobs', async () => {
    const { db, config, cleanup } = createTestDb();
    const q = new JobQueue(config, db, new EventBus(), createHandlers(), createShared());
    try {
      db.enqueueJob('fast-llm');
      db.enqueueJob('another-llm');
      db.enqueueJob('third-llm');
      // First tick claims up to maxConcurrentJobs (2)
      await q.tick();
      await q.drainAll(2000);
      // Second tick picks up the rest
      await q.tick();
      await q.drainAll(2000);
      assert.equal(db.listJobs({ status: 'completed' }).length, 3);
      assert.equal(db.listJobs({ status: 'queued' }).length, 0);
    } finally { cleanup(); }
  });

  it('claims higher priority jobs first', async () => {
    const { db, config, cleanup } = createTestDb();
    try {
      db.enqueueJob('fast-llm', { priority: 3 });
      db.enqueueJob('another-llm', { priority: 9 });
      const claimed = db.claimNextJob();
      assert.ok(claimed !== null);
      assert.equal(claimed!.type, 'another-llm');
    } finally { cleanup(); }
  });

  it('drainAll resolves immediately with no active jobs', async () => {
    const { db, config, cleanup } = createTestDb();
    const q = new JobQueue(config, db, new EventBus(), createHandlers(), createShared());
    try {
      const start = Date.now();
      await q.drainAll(5000);
      assert.ok(Date.now() - start < 100);
    } finally { cleanup(); }
  });

  it('slow job completes after drain', async () => {
    const { db, config, cleanup } = createTestDb();
    const q = new JobQueue(config, db, new EventBus(), createHandlers(), createShared());
    try {
      db.enqueueJob('slow-llm');
      await q.tick();
      assert.equal(q.activeCount, 1);
      await q.drainAll(5000);
      assert.equal(q.activeCount, 0);
      assert.equal(db.listJobs({ type: 'slow-llm' })[0].status, 'completed');
    } finally { cleanup(); }
  });
});

// --- Schedules ---

describe('isScheduleReady', () => {
  it('returns true when past scheduled time and no previous run', () => {
    const schedule: ClockSchedule = { hour: 0, minute: 0, label: 'daily 00:00' };
    assert.equal(isScheduleReady(schedule, 'UTC'), true);
  });

  it('returns false when already run today after scheduled time', () => {
    const schedule: ClockSchedule = { hour: 0, minute: 0, label: 'daily 00:00' };
    assert.equal(isScheduleReady(schedule, 'UTC', new Date().toISOString()), false);
  });

  it('returns true when last run was yesterday', () => {
    const schedule: ClockSchedule = { hour: 0, minute: 0, label: 'daily 00:00' };
    const yesterday = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    assert.equal(isScheduleReady(schedule, 'UTC', yesterday), true);
  });

  it('returns false on wrong day of week', () => {
    const today = new Date().getDay();
    const wrongDay = (today + 3) % 7;
    const schedule: ClockSchedule = { hour: 0, minute: 0, dayOfWeek: wrongDay, label: 'test' };
    assert.equal(isScheduleReady(schedule, 'UTC'), false);
  });
});

describe('nextScheduledAt', () => {
  it('returns a valid ISO date string', () => {
    const next = nextScheduledAt({ hour: 8, minute: 0, label: 'test' }, 'UTC');
    assert.ok(!isNaN(new Date(next).getTime()));
  });

  it('returns a future date', () => {
    const next = nextScheduledAt({ hour: 0, minute: 0, label: 'test' }, 'UTC');
    assert.ok(new Date(next).getTime() > Date.now() - 60_000);
  });

  it('weekly schedule is within 7 days', () => {
    const next = nextScheduledAt({ hour: 12, minute: 0, dayOfWeek: 0, label: 'test' }, 'UTC');
    const diffDays = (new Date(next).getTime() - Date.now()) / (86400000);
    assert.ok(diffDays <= 7.1);
  });
});
