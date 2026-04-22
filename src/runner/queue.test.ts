import { describe, it, before, after, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// Mock the runner service before importing queue — we don't want real processRun
// spinning up adapters, writing artifacts, or blocking on promises. The queue's
// contract is *scheduling* logic; LLM execution is out of scope for this file.
const processRunSpy: { calls: string[]; resolvers: Map<string, () => void> } = {
  calls: [],
  resolvers: new Map(),
};

mock.module('./service.js', {
  namedExports: {
    RunnerService: class {
      async processRun(runId: string): Promise<void> {
        processRunSpy.calls.push(runId);
        // Resolve when the test tells us to — lets us assert on "in-flight" state.
        return new Promise<void>((resolve) => {
          processRunSpy.resolvers.set(runId, resolve);
        });
      }
    },
  },
});

// Mock killAllActiveChildren — queue delegates here now (post R-01).
const killAllSpy = { count: 0 };
mock.module('../backend/claude-cli.js', {
  namedExports: {
    killAllActiveChildren: () => { killAllSpy.count++; },
    ClaudeCliAdapter: class {},
  },
});

// Import AFTER mocks
const { RunQueue } = await import('./queue.js');
const { createTestRunnerContext } = await import('./_test-helpers.js');

function resolveAll() {
  for (const resolve of processRunSpy.resolvers.values()) resolve();
  processRunSpy.resolvers.clear();
}

describe('RunQueue.canStart', () => {
  let env: ReturnType<typeof createTestRunnerContext>;
  let queue: InstanceType<typeof RunQueue>;

  beforeEach(() => {
    env = createTestRunnerContext({ maxConcurrentRuns: 2 });
    queue = new RunQueue(env.config, env.db, env.eventBus);
    processRunSpy.calls = [];
    processRunSpy.resolvers.clear();
    killAllSpy.count = 0;
  });

  afterEach(() => {
    resolveAll();
    env.cleanup();
  });

  it('allows a top-level run with no parent', () => {
    const run = env.db.createRun({ repoId: env.repo.id, kind: 'plan', prompt: 'x' });
    // @ts-expect-error accessing private for coverage; canStart is the contract we care about
    assert.equal(queue.canStart(env.db.getRun(run.id)!), true);
  });

  it('allows a child when parent is terminal', () => {
    const parent = env.db.createRun({ repoId: env.repo.id, kind: 'plan', prompt: 'p' });
    env.db.transitionRun(parent.id, 'running');
    env.db.transitionRun(parent.id, 'done');
    const child = env.db.createRun({ repoId: env.repo.id, kind: 'execution', prompt: 'c', parentRunId: parent.id });
    // @ts-expect-error private
    assert.equal(queue.canStart(env.db.getRun(child.id)!), true);
  });

  it('allows a child when parent is planned', () => {
    const parent = env.db.createRun({ repoId: env.repo.id, kind: 'plan', prompt: 'p' });
    env.db.transitionRun(parent.id, 'running');
    env.db.transitionRun(parent.id, 'planned');
    const child = env.db.createRun({ repoId: env.repo.id, kind: 'execution', prompt: 'c', parentRunId: parent.id });
    // @ts-expect-error private
    assert.equal(queue.canStart(env.db.getRun(child.id)!), true);
  });

  it('rejects a child when parent is still queued', () => {
    const parent = env.db.createRun({ repoId: env.repo.id, kind: 'plan', prompt: 'p' });
    const child = env.db.createRun({ repoId: env.repo.id, kind: 'execution', prompt: 'c', parentRunId: parent.id });
    // @ts-expect-error private
    assert.equal(queue.canStart(env.db.getRun(child.id)!), false);
  });

  it('rejects a child when parent is running', () => {
    const parent = env.db.createRun({ repoId: env.repo.id, kind: 'plan', prompt: 'p' });
    env.db.transitionRun(parent.id, 'running');
    const child = env.db.createRun({ repoId: env.repo.id, kind: 'execution', prompt: 'c', parentRunId: parent.id });
    // @ts-expect-error private
    assert.equal(queue.canStart(env.db.getRun(child.id)!), false);
  });

  it('rejects a child when a sibling is already running', () => {
    const parent = env.db.createRun({ repoId: env.repo.id, kind: 'plan', prompt: 'p' });
    env.db.transitionRun(parent.id, 'running');
    env.db.transitionRun(parent.id, 'planned');
    const sibling = env.db.createRun({ repoId: env.repo.id, kind: 'execution', prompt: 's', parentRunId: parent.id });
    env.db.transitionRun(sibling.id, 'running');
    const child = env.db.createRun({ repoId: env.repo.id, kind: 'execution', prompt: 'c', parentRunId: parent.id });
    // @ts-expect-error private
    assert.equal(queue.canStart(env.db.getRun(child.id)!), false);
  });

  it('allows a child when a sibling is dismissed (no active conflict)', () => {
    const parent = env.db.createRun({ repoId: env.repo.id, kind: 'plan', prompt: 'p' });
    env.db.transitionRun(parent.id, 'running');
    env.db.transitionRun(parent.id, 'planned');
    const sibling = env.db.createRun({ repoId: env.repo.id, kind: 'execution', prompt: 's', parentRunId: parent.id });
    env.db.transitionRun(sibling.id, 'failed');  // terminal — no longer active
    env.db.updateRun(sibling.id, { archived: true });
    const child = env.db.createRun({ repoId: env.repo.id, kind: 'execution', prompt: 'c', parentRunId: parent.id });
    // @ts-expect-error private
    assert.equal(queue.canStart(env.db.getRun(child.id)!), true);
  });
});

describe('RunQueue.tick', () => {
  let env: ReturnType<typeof createTestRunnerContext>;
  let queue: InstanceType<typeof RunQueue>;

  beforeEach(() => {
    env = createTestRunnerContext({ maxConcurrentRuns: 2 });
    queue = new RunQueue(env.config, env.db, env.eventBus);
    processRunSpy.calls = [];
    processRunSpy.resolvers.clear();
    killAllSpy.count = 0;
  });

  afterEach(() => {
    resolveAll();
    env.cleanup();
  });

  it('picks up queued runs up to maxConcurrentRuns', async () => {
    for (let i = 0; i < 5; i++) {
      const r = env.db.createRun({ repoId: env.repo.id, kind: 'plan', prompt: `r${i}` });
    }

    const hasActive = await queue.tick();
    assert.equal(hasActive, true);
    assert.equal(queue.activeCount, 2);
    assert.equal(processRunSpy.calls.length, 2);
  });

  it('cleans terminal runs out of the active map on next tick', async () => {
    const run = env.db.createRun({ repoId: env.repo.id, kind: 'plan', prompt: 'x' });
    await queue.tick();
    assert.equal(queue.activeCount, 1);
    assert.equal(queue.isActive(run.id), true);

    // Simulate run finishing: flip DB status to a terminal, then tick again.
    env.db.transitionRun(run.id, 'failed');
    await queue.tick();
    assert.equal(queue.activeCount, 0);
    assert.equal(queue.isActive(run.id), false);
  });

  it('does not double-start a run already in the active map', async () => {
    const run = env.db.createRun({ repoId: env.repo.id, kind: 'plan', prompt: 'x' });
    await queue.tick();
    await queue.tick();  // second tick shouldn't re-start
    assert.equal(processRunSpy.calls.length, 1);
  });

  it('returns true when active runs exist without starting new ones', async () => {
    const run = env.db.createRun({ repoId: env.repo.id, kind: 'plan', prompt: 'x' });
    await queue.tick();
    // Saturate capacity: no queued run, but active map is non-empty
    assert.equal(await queue.tick(), true);
  });

  it('returns false when neither active nor queued', async () => {
    assert.equal(await queue.tick(), false);
  });
});

describe('RunQueue.drainAll', () => {
  let env: ReturnType<typeof createTestRunnerContext>;
  let queue: InstanceType<typeof RunQueue>;

  beforeEach(() => {
    env = createTestRunnerContext({ maxConcurrentRuns: 2 });
    queue = new RunQueue(env.config, env.db, env.eventBus);
    processRunSpy.calls = [];
    processRunSpy.resolvers.clear();
  });

  afterEach(() => {
    resolveAll();
    env.cleanup();
  });

  it('resolves immediately when there are no active runs', async () => {
    const started = Date.now();
    await queue.drainAll(5_000);
    assert.ok(Date.now() - started < 100, 'drainAll with 0 active should be immediate');
  });

  it('waits until all active promises resolve', async () => {
    const run = env.db.createRun({ repoId: env.repo.id, kind: 'plan', prompt: 'x' });
    await queue.tick();

    // Schedule the resolve 50ms in the future
    setTimeout(() => resolveAll(), 50);
    const started = Date.now();
    await queue.drainAll(5_000);
    const elapsed = Date.now() - started;
    assert.ok(elapsed >= 40 && elapsed < 500, `drain should wait ~50ms, got ${elapsed}ms`);
  });

  it('respects timeout when runs don’t resolve', async () => {
    const run = env.db.createRun({ repoId: env.repo.id, kind: 'plan', prompt: 'x' });
    await queue.tick();

    const started = Date.now();
    await queue.drainAll(200);
    const elapsed = Date.now() - started;
    // Lower bound 180 (not 200) — Node timers have ±few-ms drift, CI saw 199ms.
    assert.ok(elapsed >= 180 && elapsed < 400, `should respect ~200ms timeout, got ${elapsed}ms`);
  });
});

describe('RunQueue.killAll', () => {
  it('delegates to killAllActiveChildren from the backend registry', async () => {
    const env = createTestRunnerContext({ maxConcurrentRuns: 1 });
    const queue = new RunQueue(env.config, env.db, env.eventBus);
    killAllSpy.count = 0;

    const run = env.db.createRun({ repoId: env.repo.id, kind: 'plan', prompt: 'x' });
    await queue.tick();
    assert.equal(queue.activeCount, 1);

    queue.killAll();
    assert.equal(killAllSpy.count, 1, 'killAllActiveChildren should be invoked once');
    assert.equal(queue.activeCount, 0, 'active map should be cleared');

    resolveAll();
    env.cleanup();
  });
});
