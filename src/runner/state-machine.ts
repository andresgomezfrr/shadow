/**
 * Run state machine — defines valid status transitions and multi-child aggregation.
 *
 * Single source of truth for the run lifecycle. All status mutations
 * should go through assertTransition() to catch invalid transitions at write time.
 */

export type RunStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'executed'
  | 'executed_manual'
  | 'discarded'
  | 'failed';

export const TERMINAL_STATUSES: ReadonlySet<RunStatus> = new Set([
  'executed',
  'executed_manual',
  'discarded',
  'failed',
]);

/**
 * Directed graph of allowed transitions.
 * Each key maps to the set of statuses it can transition TO.
 */
const TRANSITIONS: Record<RunStatus, ReadonlySet<RunStatus>> = {
  queued:          new Set(['running', 'failed']),
  running:         new Set(['completed', 'executed', 'failed']),
  completed:       new Set(['executed', 'executed_manual', 'discarded']),
  executed:        new Set(),  // terminal
  executed_manual: new Set(),  // terminal
  discarded:       new Set(),  // terminal
  failed:          new Set(),  // terminal
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
 * - Children in 'discarded' are excluded from aggregation
 * - If ALL non-discarded children are terminal → parent = 'executed'
 * - If all children are 'discarded' (none left) → parent = 'discarded'
 * - Otherwise (some children still pending/running) → null (don't update yet)
 */
export function aggregateParentStatus(
  children: Array<{ status: string }>,
): RunStatus | null {
  if (children.length === 0) return null;

  const nonDiscarded = children.filter((c) => c.status !== 'discarded');

  // All children discarded → parent is discarded too
  if (nonDiscarded.length === 0) return 'discarded';

  // Any child failed → parent fails
  if (nonDiscarded.some((c) => c.status === 'failed')) return 'failed';

  // Check if all non-discarded children are terminal
  const allTerminal = nonDiscarded.every((c) =>
    TERMINAL_STATUSES.has(c.status as RunStatus),
  );

  if (allTerminal) return 'executed';

  // Some children still in progress
  return null;
}
