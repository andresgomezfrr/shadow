/**
 * Run state machine — defines valid status transitions and multi-child aggregation.
 *
 * Single source of truth for the run lifecycle. All status mutations
 * should go through assertTransition() to catch invalid transitions at write time.
 */

export type RunStatus =
  | 'queued'
  | 'running'
  | 'planned'
  | 'awaiting_pr'
  | 'done'
  | 'dismissed'
  | 'failed';

export const TERMINAL_STATUSES: ReadonlySet<RunStatus> = new Set([
  'done',
  'dismissed',
  'failed',
]);

/**
 * Directed graph of allowed transitions.
 * Each key maps to the set of statuses it can transition TO.
 */
const TRANSITIONS: Record<RunStatus, ReadonlySet<RunStatus>> = {
  queued:      new Set(['running', 'failed']),
  running:     new Set(['planned', 'done', 'failed']),
  planned:     new Set(['done', 'dismissed', 'failed', 'awaiting_pr']),
  awaiting_pr: new Set(['done', 'dismissed', 'failed']),
  // `done → awaiting_pr` allows reopening a parent run when the user creates a
  // draft PR manually after execution already finalized the parent as done/executed.
  done:        new Set(['awaiting_pr']),
  dismissed:   new Set(),  // terminal
  failed:      new Set(),  // terminal
};

export class RunTransitionError extends Error {
  constructor(
    public readonly from: string,
    public readonly to: string,
  ) {
    super(`Invalid run transition: ${from} → ${to}`);
    this.name = 'RunTransitionError';
  }
}

/**
 * Throws RunTransitionError if the transition is not allowed.
 */
export function assertTransition(from: string, to: RunStatus): void {
  const allowed = TRANSITIONS[from as RunStatus];
  if (!allowed || !allowed.has(to)) {
    throw new RunTransitionError(from, to);
  }
}

/**
 * Aggregate parent status from its children.
 *
 * Rules:
 * - If ANY child is 'failed' → parent = 'failed'
 * - Children in 'dismissed' are excluded from aggregation
 * - If ALL non-dismissed children are terminal → parent = 'done'
 * - If all children are 'dismissed' (none left) → parent = 'dismissed'
 * - Otherwise (some children still pending/running) → null (don't update yet)
 */
export function aggregateParentStatus(
  children: Array<{ status: string }>,
): RunStatus | null {
  if (children.length === 0) return null;

  const nonDismissed = children.filter((c) => c.status !== 'dismissed');

  // All children dismissed → parent is dismissed too
  if (nonDismissed.length === 0) return 'dismissed';

  // Any child failed → parent fails
  if (nonDismissed.some((c) => c.status === 'failed')) return 'failed';

  // Check if all non-dismissed children are terminal
  const allTerminal = nonDismissed.every((c) =>
    TERMINAL_STATUSES.has(c.status as RunStatus),
  );

  if (allTerminal) return 'done';

  // Some children still in progress
  return null;
}
