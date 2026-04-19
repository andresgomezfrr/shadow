import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { createTestRunnerContext, makeMockAdapter, seedPlanRun, seedExecutionRun, seedParentWithChildren, makeRepoChange, type MockAdapter, type TestRunnerEnv } from './_test-helpers.js';

// ---------------------------------------------------------------------------
// Module mocks — must register BEFORE importing RunnerService
// ---------------------------------------------------------------------------

// The mock adapter is swapped per-test via setMockAdapter().
let currentAdapter: MockAdapter = makeMockAdapter();
function setMockAdapter(adapter: MockAdapter): void {
  currentAdapter = adapter;
}

mock.module('../backend/index.js', {
  namedExports: {
    selectAdapter: () => currentAdapter,
  },
});

// Silence bond delta — tests don't verify deltas; bond.test.ts already covers axes.
const bondDeltaCalls: Array<'run_success' | 'run_failed'> = [];
mock.module('../profile/bond.js', {
  namedExports: {
    applyBondDelta: (_db: unknown, delta: 'run_success' | 'run_failed') => {
      bondDeltaCalls.push(delta);
    },
  },
});

// Silence chronicle milestone hooks — fire-and-forget and not under test here.
mock.module('../analysis/chronicle.js', {
  namedExports: {
    triggerChronicleMilestone: async () => {},
    chronicleMilestone: async () => {},
  },
});

// Plan capture reads ~/.claude/plans/... which doesn't exist in tests.
// Default: return null so processRun falls back to result.output. Individual tests
// can override via setPlanCaptureImpl() to simulate a real JSONL session.
type PlanCaptureFn = (sessionId: string, cwd: string) => { content: string | null; brief: string | null; filePath: string | null };
const NULL_CAPTURE: ReturnType<PlanCaptureFn> = { content: null, brief: null, filePath: null };
let planCaptureImpl: PlanCaptureFn = () => NULL_CAPTURE;
function setPlanCaptureImpl(fn: PlanCaptureFn | null): void {
  planCaptureImpl = fn ?? (() => NULL_CAPTURE);
}

mock.module('./plan-capture.js', {
  namedExports: {
    capturePlanFromSession: (sessionId: string, cwd: string) => planCaptureImpl(sessionId, cwd),
  },
});

// ---------------------------------------------------------------------------
// Import the module under test AFTER mocks are in place
// ---------------------------------------------------------------------------

const { RunnerService } = await import('./service.js');

// ---------------------------------------------------------------------------
// Per-test setup
// ---------------------------------------------------------------------------

let env: TestRunnerEnv;

beforeEach(() => {
  env = createTestRunnerContext({ maxConcurrentRuns: 1, runnerTimeoutMs: 10_000 });
  bondDeltaCalls.length = 0;
});

afterEach(() => {
  env.cleanup();
});

// Helper: seed a parent plan run in 'planned' state so we can attach an execution child.
function seedPlannedParent(repoId: string) {
  const parent = env.db.createRun({ repoId, kind: 'plan', prompt: 'parent plan' });
  env.db.transitionRun(parent.id, 'running');
  env.db.transitionRun(parent.id, 'planned');
  return env.db.getRun(parent.id)!;
}

// ---------------------------------------------------------------------------
// The 9 integration tests
// ---------------------------------------------------------------------------

describe('RunnerService.processRun — integration', () => {
  it('1. plan mode success → status=planned, resultSummaryMd persisted', async () => {
    const adapter = makeMockAdapter({
      scripted: { plan: { output: '# My Plan\n\n## Steps\n1. Do the thing' } },
    });
    setMockAdapter(adapter);

    const run = seedPlanRun(env.db, { repoId: env.repo.id });
    const service = new RunnerService(env.config, env.db, env.eventBus);
    const result = await service.processRun(run.id);

    assert.equal(result.processed, true);
    const updated = env.db.getRun(run.id)!;
    assert.equal(updated.status, 'planned');
    assert.ok(updated.resultSummaryMd?.includes('My Plan'), 'plan body must be persisted');
    assert.equal(adapter.callCount >= 1, true, 'adapter.execute was called');
    // Confidence eval may or may not have happened; if so, stored:
    // (lenient check — the mock returns high/0 doubts by default)
  });

  it('2. execute mode success with changes → done/executed, parent transitions', async () => {
    const parent = seedPlannedParent(env.repo.id);
    const child = seedExecutionRun(env.db, { repoId: env.repo.id, parentRunId: parent.id });

    const adapter = makeMockAdapter({
      onExecute: (pack) => {
        // Only dirty the worktree for the actual execution call, not confidence evals
        if (pack.permissionMode !== 'plan' && !/confidence|evaluate/i.test(pack.title)) {
          const worktreeCwd = pack.repos[0]?.path;
          if (worktreeCwd) makeRepoChange(worktreeCwd, 'new-file.txt', 'hello\n');
        }
      },
    });
    setMockAdapter(adapter);

    const service = new RunnerService(env.config, env.db, env.eventBus);
    await service.processRun(child.id);

    const updatedChild = env.db.getRun(child.id)!;
    assert.equal(updatedChild.status, 'done');
    assert.ok(updatedChild.diffStat && updatedChild.diffStat.trim().length > 0, 'diffStat should capture changes');

    const updatedParent = env.db.getRun(parent.id)!;
    assert.equal(updatedParent.status, 'done', 'parent aggregates to done');
    assert.equal(updatedParent.outcome, 'executed');
  });

  it('3. execute mode success with NO changes → done/no_changes + closedNote', async () => {
    const parent = seedPlannedParent(env.repo.id);
    const child = seedExecutionRun(env.db, { repoId: env.repo.id, parentRunId: parent.id });

    const adapter = makeMockAdapter({
      // Carefully no modificatory verbs (modif/add/remov/fix/refactor/implement/creat/delet/updat/writ/renam)
      scripted: { execution: { output: 'Looked at the code. Everything already aligned with the goal. No action required.' } },
    });
    setMockAdapter(adapter);

    const service = new RunnerService(env.config, env.db, env.eventBus);
    await service.processRun(child.id);

    const updatedChild = env.db.getRun(child.id)!;
    assert.equal(updatedChild.status, 'done');

    const updatedParent = env.db.getRun(parent.id)!;
    assert.equal(updatedParent.status, 'done');
    assert.equal(updatedParent.outcome, 'no_changes', 'parent outcome must be no_changes');
    assert.ok(updatedParent.closedNote && updatedParent.closedNote.length > 0, 'closedNote must carry the child summary');
  });

  it('4. summary-diff mismatch (R-03) → verified=needs_review, event, parent not propagated', async () => {
    const parent = seedPlannedParent(env.repo.id);
    const child = seedExecutionRun(env.db, { repoId: env.repo.id, parentRunId: parent.id });

    // Adapter claims work via modificatory verbs but leaves the worktree untouched.
    const adapter = makeMockAdapter({
      scripted: { execution: { output: 'I modified the auth module and added 3 tests. Refactored the error handling.' } },
    });
    setMockAdapter(adapter);

    const service = new RunnerService(env.config, env.db, env.eventBus);
    await service.processRun(child.id);

    const updatedChild = env.db.getRun(child.id)!;
    assert.equal(updatedChild.verified, 'needs_review', 'mismatch flags verified as needs_review');
    assert.ok(updatedChild.closedNote?.includes('Summary claims changes but diff is empty'), 'closedNote explains the reason');

    const pending = env.db.listPendingEvents();
    assert.ok(
      pending.some(e => e.kind === 'plan_needs_review' && (e.payload as Record<string, unknown>)?.reason === 'summary_mismatch'),
      'plan_needs_review event should be emitted with reason=summary_mismatch',
    );

    const updatedParent = env.db.getRun(parent.id)!;
    assert.equal(updatedParent.status, 'planned', 'parent must stay planned — user decides');
  });

  it('5. empty plan → status=failed + run_failed event + bond delta negative', async () => {
    const adapter = makeMockAdapter({
      scripted: { plan: { output: '' } },
    });
    setMockAdapter(adapter);

    const run = seedPlanRun(env.db, { repoId: env.repo.id });
    const service = new RunnerService(env.config, env.db, env.eventBus);
    await service.processRun(run.id);

    const updated = env.db.getRun(run.id)!;
    assert.equal(updated.status, 'failed');
    assert.match(updated.errorSummary ?? '', /empty|no plan/i);

    assert.ok(bondDeltaCalls.includes('run_failed'), 'bond delta run_failed must be applied');

    const pending = env.db.listPendingEvents();
    assert.ok(pending.some(e => e.kind === 'run_failed'), 'run_failed event emitted');
  });

  it('6. adapter throws → status=failed, bond delta negative, catch path clean', async () => {
    const adapter = makeMockAdapter({ throwOnExecute: true });
    setMockAdapter(adapter);

    const run = seedPlanRun(env.db, { repoId: env.repo.id });
    const service = new RunnerService(env.config, env.db, env.eventBus);
    await service.processRun(run.id);

    const updated = env.db.getRun(run.id)!;
    assert.equal(updated.status, 'failed');
    assert.ok(updated.errorSummary && updated.errorSummary.length > 0, 'errorSummary set on exception');
    assert.ok(bondDeltaCalls.includes('run_failed'), 'bond delta run_failed applied on catch path');
  });

  it('7. parent aggregation · 3 siblings · 1 failed → parent failed (failed wins)', async () => {
    const { parent } = seedParentWithChildren(env.db, {
      repoId: env.repo.id,
      childStatuses: ['done', 'done'],  // seed 2 already-done children
    });

    // Third child will process now, and fail via adapter throw.
    const thirdChild = seedExecutionRun(env.db, { repoId: env.repo.id, parentRunId: parent.id });
    const adapter = makeMockAdapter({ throwOnExecute: true });
    setMockAdapter(adapter);

    const service = new RunnerService(env.config, env.db, env.eventBus);
    await service.processRun(thirdChild.id);

    const updatedParent = env.db.getRun(parent.id)!;
    assert.equal(updatedParent.status, 'failed', 'one failed child propagates failure');
  });

  it('8. verification fail → verified=needs_review (independent of summary-diff)', async () => {
    const parent = seedPlannedParent(env.repo.id);
    const child = seedExecutionRun(env.db, { repoId: env.repo.id, parentRunId: parent.id });

    // Configure the repo with a test command that always fails.
    env.db.updateRepo(env.repo.id, { testCommand: 'false' });

    const adapter = makeMockAdapter({
      onExecute: (pack) => {
        if (pack.permissionMode !== 'plan' && !/confidence|evaluate/i.test(pack.title)) {
          const worktreeCwd = pack.repos[0]?.path;
          if (worktreeCwd) makeRepoChange(worktreeCwd, 'changed.txt', 'legit change\n');
        }
      },
      // Output has no modificatory verbs from our regex → doesn't trigger R-03 mismatch
      scripted: { execution: { output: 'Completed the work described in the plan.' } },
    });
    setMockAdapter(adapter);

    const service = new RunnerService(env.config, env.db, env.eventBus);
    await service.processRun(child.id);

    const updatedChild = env.db.getRun(child.id)!;
    assert.equal(updatedChild.verified, 'needs_review', 'verification fail → needs_review');
    // closedNote should NOT mention summary-diff mismatch — this is a verification failure
    if (updatedChild.closedNote) {
      assert.ok(!updatedChild.closedNote.includes('Summary claims changes'), 'should not be flagged as summary-diff mismatch');
    }
  });

  it('9. worktree cleaned up after failure', async () => {
    const parent = seedPlannedParent(env.repo.id);
    const child = seedExecutionRun(env.db, { repoId: env.repo.id, parentRunId: parent.id });

    const adapter = makeMockAdapter({ throwOnExecute: true });
    setMockAdapter(adapter);

    const service = new RunnerService(env.config, env.db, env.eventBus);
    await service.processRun(child.id);

    const updatedChild = env.db.getRun(child.id)!;
    assert.equal(updatedChild.status, 'failed');

    // Verify the git worktree was removed from the filesystem.
    // The path is stored on the run record by startRun; if cleanup ran, git worktree list won't include it.
    const worktreesOut = execFileSync('git', ['worktree', 'list'], { cwd: env.repoPath, encoding: 'utf-8' });
    // The main repo path always shows up; the test worktree should be gone.
    const lines = worktreesOut.split('\n').filter(Boolean);
    assert.equal(lines.length, 1, `expected only main repo worktree, got:\n${worktreesOut}`);
  });

  it('11. plan capture returns content from session JSONL [T-01c]', async () => {
    const planContent = '# Captured Plan\n\n## Steps\n1. Captured from the JSONL session transcript, not from result.output';
    setPlanCaptureImpl(() => ({ content: planContent, brief: 'Plan ready for review', filePath: '/tmp/captured-plan.md' }));

    try {
      // Empty output forces processRun to rely on capturePlanFromSession to fill effectivePlan
      const adapter = makeMockAdapter({
        scripted: { plan: { output: '', sessionId: 'test-session-fixture-01' } },
      });
      setMockAdapter(adapter);

      const run = seedPlanRun(env.db, { repoId: env.repo.id });
      const service = new RunnerService(env.config, env.db, env.eventBus);
      await service.processRun(run.id);

      const updated = env.db.getRun(run.id)!;
      assert.equal(updated.status, 'planned', 'plan captured from JSONL fixture → planned status');
      assert.ok(updated.resultSummaryMd?.includes('Captured Plan'), 'resultSummaryMd sources content from the session stub');
      assert.ok(updated.resultSummaryMd?.includes('Captured from the JSONL session transcript'), 'full plan body persisted');
    } finally {
      setPlanCaptureImpl(null);
    }
  });

  it('10. confidence eval returns low → plan persisted with doubts [T-01b]', async () => {
    const adapter = makeMockAdapter({
      scripted: {
        plan: { output: '# Plan\n\n## Steps\n1. Risky change under-specified' },
        confidence: { output: JSON.stringify({ confidence: 'low', doubts: ['Not sure about X', 'Y is ambiguous'] }) },
      },
    });
    setMockAdapter(adapter);

    const run = seedPlanRun(env.db, { repoId: env.repo.id });
    const service = new RunnerService(env.config, env.db, env.eventBus);
    await service.processRun(run.id);

    const updated = env.db.getRun(run.id)!;
    assert.equal(updated.status, 'planned', 'plan run finishes as planned even with low confidence');
    assert.equal(updated.confidence, 'low', 'confidence value persisted');
    assert.deepEqual(updated.doubts, ['Not sure about X', 'Y is ambiguous'], 'doubts array persisted');
  });

  it('12. autonomous chain: plan → execute → parent done [T-01d]', async () => {
    // Phase 1: plan run with high confidence
    const adapter = makeMockAdapter({
      scripted: {
        plan: { output: '# Plan\n\n## Steps\n1. Edit foo.ts' },
        confidence: { output: JSON.stringify({ confidence: 'high', doubts: [] }) },
        execution: { output: 'Completed the work as planned.' },
      },
      onExecute: (pack) => {
        // Dirty the worktree only for the actual execution call
        if (pack.permissionMode !== 'plan' && !/confidence|evaluate/i.test(pack.title)) {
          const worktreeCwd = pack.repos[0]?.path;
          if (worktreeCwd) makeRepoChange(worktreeCwd, 'foo.ts', 'modified\n');
        }
      },
    });
    setMockAdapter(adapter);

    const planRun = seedPlanRun(env.db, { repoId: env.repo.id });
    const service = new RunnerService(env.config, env.db, env.eventBus);

    await service.processRun(planRun.id);
    const planned = env.db.getRun(planRun.id)!;
    assert.equal(planned.status, 'planned', 'plan phase completes as planned');
    assert.equal(planned.confidence, 'high', 'plan has high confidence');

    // Phase 2: execution child (simulates auto-execute enqueuing the child)
    const execRun = seedExecutionRun(env.db, { repoId: env.repo.id, parentRunId: planRun.id });
    await service.processRun(execRun.id);

    const executed = env.db.getRun(execRun.id)!;
    const parent = env.db.getRun(planRun.id)!;

    assert.equal(executed.status, 'done', 'execution child transitions to done');
    assert.ok(executed.diffStat && executed.diffStat.length > 0, 'execution produced a diff');
    assert.equal(parent.status, 'done', 'parent aggregates to done after child executed');
    assert.equal(parent.outcome, 'executed', 'parent outcome is executed (not no_changes or merged)');
  });
});

// Suppress "unused" from helpers we might enable later without blocking TS strict
void writeFileSync;
void join;
