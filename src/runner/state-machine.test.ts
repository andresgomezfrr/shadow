import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  TERMINAL_STATUSES,
  RunTransitionError,
  assertTransition,
  aggregateParentStatus,
  type RunStatus,
} from './state-machine.js';

describe('TERMINAL_STATUSES', () => {
  it('includes done, dismissed, failed', () => {
    assert.equal(TERMINAL_STATUSES.has('done'), true);
    assert.equal(TERMINAL_STATUSES.has('dismissed'), true);
    assert.equal(TERMINAL_STATUSES.has('failed'), true);
  });

  it('excludes non-terminal states', () => {
    for (const s of ['queued', 'running', 'planned', 'awaiting_pr'] as RunStatus[]) {
      assert.equal(TERMINAL_STATUSES.has(s), false, `expected ${s} to be non-terminal`);
    }
  });
});

describe('assertTransition', () => {
  // Exhaustive table of every (from → to) pair documented in the state machine.
  const VALID: Array<[RunStatus, RunStatus]> = [
    ['queued', 'running'],
    ['queued', 'failed'],
    ['running', 'planned'],
    ['running', 'done'],
    ['running', 'failed'],
    ['planned', 'done'],
    ['planned', 'dismissed'],
    ['planned', 'failed'],
    ['planned', 'awaiting_pr'],
    ['awaiting_pr', 'done'],
    ['awaiting_pr', 'dismissed'],
    ['awaiting_pr', 'failed'],
    ['done', 'awaiting_pr'],  // reopen-for-draft-PR path
  ];

  for (const [from, to] of VALID) {
    it(`allows ${from} → ${to}`, () => {
      assert.doesNotThrow(() => assertTransition(from, to));
    });
  }

  // Selected invalid transitions — high-value guards.
  const INVALID: Array<[string, RunStatus]> = [
    ['done', 'running'],
    ['done', 'planned'],
    ['dismissed', 'running'],
    ['dismissed', 'done'],
    ['failed', 'running'],
    ['failed', 'done'],
    ['running', 'awaiting_pr'],   // must transition via planned first
    ['queued', 'done'],            // must go through running
    ['queued', 'planned'],
  ];

  for (const [from, to] of INVALID) {
    it(`rejects ${from} → ${to}`, () => {
      assert.throws(() => assertTransition(from, to), RunTransitionError);
    });
  }

  it('rejects transitions from unknown status', () => {
    assert.throws(() => assertTransition('archived', 'done'), RunTransitionError);
    assert.throws(() => assertTransition('', 'done'), RunTransitionError);
  });

  it('RunTransitionError carries from/to fields', () => {
    try {
      assertTransition('done', 'running');
      assert.fail('should have thrown');
    } catch (e) {
      assert.ok(e instanceof RunTransitionError);
      assert.equal(e.from, 'done');
      assert.equal(e.to, 'running');
      assert.match(e.message, /Invalid run transition: done → running/);
    }
  });
});

describe('aggregateParentStatus', () => {
  it('returns null for empty children array', () => {
    assert.equal(aggregateParentStatus([]), null);
  });

  it('returns dismissed when all children are dismissed', () => {
    const children = [{ status: 'dismissed' }, { status: 'dismissed' }];
    assert.equal(aggregateParentStatus(children), 'dismissed');
  });

  it('returns failed when any non-dismissed child failed (failed wins)', () => {
    const children = [{ status: 'done' }, { status: 'failed' }, { status: 'done' }];
    assert.equal(aggregateParentStatus(children), 'failed');
  });

  it('returns failed even with a mix of failed and dismissed', () => {
    const children = [{ status: 'dismissed' }, { status: 'failed' }];
    assert.equal(aggregateParentStatus(children), 'failed');
  });

  it('returns done when all non-dismissed children are terminal non-failed', () => {
    const children = [{ status: 'done' }, { status: 'dismissed' }, { status: 'done' }];
    assert.equal(aggregateParentStatus(children), 'done');
  });

  it('returns null when any non-dismissed child is still pending/running', () => {
    const children = [{ status: 'done' }, { status: 'running' }];
    assert.equal(aggregateParentStatus(children), null);
  });

  it('returns null when a child is queued', () => {
    const children = [{ status: 'done' }, { status: 'queued' }];
    assert.equal(aggregateParentStatus(children), null);
  });

  it('returns null when a child is planned (non-terminal)', () => {
    const children = [{ status: 'planned' }];
    assert.equal(aggregateParentStatus(children), null);
  });

  it('returns null when a child is awaiting_pr (non-terminal)', () => {
    const children = [{ status: 'done' }, { status: 'awaiting_pr' }];
    assert.equal(aggregateParentStatus(children), null);
  });

  it('treats done as terminal for aggregation', () => {
    assert.equal(aggregateParentStatus([{ status: 'done' }]), 'done');
  });

  it('single failed child propagates to parent', () => {
    assert.equal(aggregateParentStatus([{ status: 'failed' }]), 'failed');
  });

  it('single dismissed child bubbles to dismissed parent', () => {
    assert.equal(aggregateParentStatus([{ status: 'dismissed' }]), 'dismissed');
  });
});
