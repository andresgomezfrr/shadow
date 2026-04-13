import type { ShadowConfig } from '../config/schema.js';
import type { ShadowDatabase } from '../storage/database.js';
import type { RunRecord } from '../storage/models.js';
import type { EventBus } from '../web/event-bus.js';
import { ClaudeCliAdapter } from '../backend/claude-cli.js';
import { RunnerService } from './service.js';

type ActiveRun = {
  runId: string;
  repoId: string;
  adapter: ClaudeCliAdapter;
  promise: Promise<void>;
};

const TERMINAL_STATUSES = new Set(['done', 'failed', 'dismissed']);

export class RunQueue {
  private active = new Map<string, ActiveRun>();

  constructor(
    private readonly config: ShadowConfig,
    private readonly db: ShadowDatabase,
    private readonly eventBus?: EventBus,
  ) {}

  /**
   * Called each daemon tick. Starts eligible queued runs up to capacity.
   * Returns true if any runs are active (started or still running).
   */
  async tick(): Promise<boolean> {
    // Cleanup completed runs from active map
    for (const [runId, entry] of this.active) {
      const run = this.db.getRun(runId);
      if (!run || TERMINAL_STATUSES.has(run.status)) {
        entry.adapter.dispose();
        this.active.delete(runId);
      }
    }

    // Check capacity
    if (this.active.size >= this.config.maxConcurrentRuns) {
      return true;
    }

    // Find eligible queued runs
    const queued = this.db.listRuns({ status: 'queued' });
    for (const run of queued) {
      if (this.active.size >= this.config.maxConcurrentRuns) break;
      if (!this.canStart(run)) continue;
      this.startRun(run);
    }

    return this.active.size > 0;
  }

  private canStart(run: RunRecord): boolean {
    // Already in active map
    if (this.active.has(run.id)) return false;

    // Parent-child dependency: child may start when parent is terminal OR 'planned'
    // (planned = plan generated, ready for execution delegation).
    // No concurrent siblings: only one execution child runs at a time per parent.
    if (run.parentRunId) {
      const parent = this.db.getRun(run.parentRunId);
      const parentOk = parent && (
        TERMINAL_STATUSES.has(parent.status) || parent.status === 'planned'
      );
      if (!parentOk) return false;

      const siblings = this.db.listRuns({ parentRunId: run.parentRunId });
      const hasActiveSibling = siblings.some((s) =>
        s.id !== run.id && (s.status === 'running' || this.active.has(s.id))
      );
      if (hasActiveSibling) return false;
    }

    // Repo concurrency: only allow multiple runs on same repo if execution (worktree)
    const sameRepoActive = [...this.active.values()].filter((a) => a.repoId === run.repoId);
    if (sameRepoActive.length > 0 && run.kind !== 'execution') {
      return false;
    }

    return true;
  }

  private startRun(run: RunRecord): void {
    const adapter = new ClaudeCliAdapter(this.config);
    const runner = new RunnerService(this.config, this.db, this.eventBus);

    const promise = runner.processRun(run.id).then(() => {}).catch((err) => {
      console.error(`[run-queue] Run ${run.id.slice(0, 8)} error:`, err instanceof Error ? err.message : err);
    }).finally(() => {
      adapter.dispose();
      this.active.delete(run.id);
    });

    this.active.set(run.id, { runId: run.id, repoId: run.repoId, adapter, promise });
  }

  async drainAll(timeoutMs = 60_000): Promise<void> {
    if (this.active.size === 0) return;
    console.error(`[run-queue] Draining ${this.active.size} active runs (max ${Math.round(timeoutMs / 1000)}s)...`);
    const promises = [...this.active.values()].map((a) => a.promise);
    await Promise.race([
      Promise.allSettled(promises),
      new Promise<void>((r) => setTimeout(r, timeoutMs)),
    ]);
  }

  killAll(): void {
    for (const entry of this.active.values()) {
      entry.adapter.kill();
    }
    this.active.clear();
  }

  get activeCount(): number {
    return this.active.size;
  }
}
