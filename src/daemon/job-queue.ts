import type { ShadowConfig } from '../config/schema.js';
import type { ShadowDatabase } from '../storage/database.js';
import type { JobRecord } from '../storage/models.js';
import type { EventBus } from '../web/event-bus.js';
import type { JobHandlerEntry, JobContext, DaemonSharedState, JobHandlerResult } from './job-handlers.js';
import { runInJobScope, killJobAdapters } from '../backend/claude-cli.js';

const JOB_TIMEOUT_MS = 8 * 60 * 1000; // 8min (< 10min stale threshold)

type ActiveJob = {
  jobId: string;
  type: string;
  category: 'llm' | 'io';
  phase: string | null;
  promise: Promise<void>;
};

export class JobQueue {
  private active = new Map<string, ActiveJob>();

  constructor(
    private readonly config: ShadowConfig,
    private readonly db: ShadowDatabase,
    private readonly eventBus: EventBus,
    private readonly handlers: Map<string, JobHandlerEntry>,
    private readonly shared: DaemonSharedState,
  ) {}

  /**
   * Called each daemon tick. Claims eligible queued jobs up to capacity and starts them.
   * Returns true if any jobs are active (started or still running).
   */
  async tick(): Promise<boolean> {
    // Cleanup: remove completed/failed from active map
    for (const [jobId] of this.active) {
      const job = this.db.getJob(jobId);
      if (!job || job.status !== 'running') {
        this.active.delete(jobId);
      }
    }

    // Compute types to exclude (same-type mutual exclusion)
    const excludeTypes = [...new Set([...this.active.values()].map(a => a.type))];

    // Claim loop
    while (this.active.size < this.config.maxConcurrentJobs + this.ioActiveCount()) {
      // LLM capacity check
      const currentLlm = [...this.active.values()].filter(a => a.category === 'llm').length;
      if (currentLlm >= this.config.maxConcurrentJobs) break;

      const claimed = this.db.claimNextJob(
        excludeTypes.length > 0 ? { excludeTypes } : undefined,
      );
      if (!claimed) break;

      const entry = this.handlers.get(claimed.type);
      if (!entry) {
        // Unknown job type — mark as failed
        this.db.updateJob(claimed.id, {
          status: 'failed',
          result: { error: `unknown job type: ${claimed.type}` },
          finishedAt: new Date().toISOString(),
        });
        continue;
      }

      // IO jobs bypass LLM capacity limit but still respect same-type exclusion
      if (entry.category === 'llm' && currentLlm >= this.config.maxConcurrentJobs) break;

      this.startJob(claimed, entry);
      excludeTypes.push(claimed.type); // prevent claiming another of same type
    }

    return this.active.size > 0;
  }

  private startJob(job: JobRecord, entry: JobHandlerEntry): void {
    const startMs = Date.now();
    let cancelled = false;

    // Save original params before handler overwrites result (needed for retry)
    const originalParams: Record<string, unknown> = { ...(job.result as Record<string, unknown>) };
    delete originalParams.error;

    const activeEntry: ActiveJob = {
      jobId: job.id,
      type: job.type,
      category: entry.category,
      phase: null,
      promise: null!,
    };

    // Per-job setPhase closure
    const setPhase = (phase: string | null) => {
      activeEntry.phase = phase;
      try { this.db.updateJob(job.id, { activity: phase }); } catch { /* best-effort */ }
      this.eventBus.emit({ type: 'job:phase', data: { jobId: job.id, jobType: job.type, phase } });
      // Backward compat: also emit heartbeat:phase for heartbeat jobs
      if (job.type === 'heartbeat') {
        this.eventBus.emit({ type: 'heartbeat:phase', data: { phase, jobId: job.id } });
      }
    };

    const ctx: JobContext = {
      jobId: job.id,
      config: this.config,
      db: this.db,
      eventBus: this.eventBus,
      setPhase,
    };

    // Emit job:started
    this.eventBus.emit({ type: 'job:started', data: { jobId: job.id, type: job.type, priority: job.priority } });

    // Execute handler within job scope (for per-job adapter tracking)
    const handlerPromise = runInJobScope(job.id, () => entry.fn(ctx, this.shared));

    const jobPromise = (async () => {
      try {
        const result = await handlerPromise;
        if (cancelled) return;
        this.db.updateJob(job.id, {
          status: 'completed',
          phases: result.phases,
          llmCalls: result.llmCalls,
          tokensUsed: result.tokensUsed,
          result: result.result,
          durationMs: Date.now() - startMs,
          finishedAt: new Date().toISOString(),
        });
        this.eventBus.emit({
          type: 'job:complete',
          data: { jobId: job.id, type: job.type, status: 'completed', durationMs: Date.now() - startMs, result: result.result },
        });
      } catch (err) {
        if (cancelled) return;
        const errorMsg = err instanceof Error ? err.message : String(err);
        const retryCount = (originalParams.retryCount as number) ?? 0;
        this.db.updateJob(job.id, {
          status: 'failed',
          result: { error: errorMsg, retryCount },
          durationMs: Date.now() - startMs,
          finishedAt: new Date().toISOString(),
        });
        this.eventBus.emit({
          type: 'job:complete',
          data: { jobId: job.id, type: job.type, status: 'failed', durationMs: Date.now() - startMs, error: errorMsg },
        });
        console.error(`[job-queue] Job ${job.type}/${job.id.slice(0, 8)} failed:`, errorMsg);

        // Auto-retry for reactive/backfill/first-scan jobs (max 2 retries)
        const MAX_RETRIES = 2;
        const retryableSources = new Set(['reactive', 'backfill', 'first-scan']);
        if (retryCount < MAX_RETRIES && retryableSources.has(job.triggerSource)) {
          const params = { ...originalParams, retryCount: retryCount + 1 };
          this.db.enqueueJob(job.type, {
            priority: job.priority,
            triggerSource: job.triggerSource,
            params,
          });
          console.error(`[job-queue] Auto-retry ${job.type}/${job.id.slice(0, 8)} (attempt ${retryCount + 2}/${MAX_RETRIES + 1})`);
        }
      } finally {
        setPhase(null);
        this.active.delete(job.id);
      }
    })();

    // Race against timeout (unref so timer doesn't prevent process exit)
    const timeoutPromise = new Promise<'timeout'>(r => { const t = setTimeout(() => r('timeout'), JOB_TIMEOUT_MS); t.unref(); });
    Promise.race([jobPromise.then(() => 'done' as const), timeoutPromise]).then(winner => {
      if (winner === 'timeout' && this.active.has(job.id)) {
        cancelled = true;
        killJobAdapters(job.id);
        this.db.updateJob(job.id, {
          status: 'failed',
          result: { error: `timeout (${Math.round(JOB_TIMEOUT_MS / 60000)}min)` },
          durationMs: JOB_TIMEOUT_MS,
          finishedAt: new Date().toISOString(),
        });
        this.eventBus.emit({
          type: 'job:complete',
          data: { jobId: job.id, type: job.type, status: 'failed', durationMs: JOB_TIMEOUT_MS, error: 'timeout' },
        });
        console.error(`[job-queue] Job ${job.type}/${job.id.slice(0, 8)} timed out — killed adapters`);
        this.active.delete(job.id);
      }
    });

    activeEntry.promise = jobPromise;
    this.active.set(job.id, activeEntry);
  }

  private ioActiveCount(): number {
    return [...this.active.values()].filter(a => a.category === 'io').length;
  }

  async drainAll(timeoutMs = 60_000): Promise<void> {
    if (this.active.size === 0) return;
    console.error(`[job-queue] Draining ${this.active.size} active jobs (max ${Math.round(timeoutMs / 1000)}s)...`);
    const promises = [...this.active.values()].map(a => a.promise);
    const result = await Promise.race([
      Promise.allSettled(promises).then(() => 'done' as const),
      new Promise<'timeout'>(r => setTimeout(r, timeoutMs)),
    ]);
    if (result === 'timeout' && this.active.size > 0) {
      console.error(`[job-queue] Drain timeout — killing ${this.active.size} remaining jobs`);
      this.killAll();
    }
  }

  killAll(): void {
    for (const entry of this.active.values()) {
      killJobAdapters(entry.jobId);
    }
    this.active.clear();
  }

  get activeCount(): number {
    return this.active.size;
  }

  get activeJobs(): Array<{ jobId: string; type: string; phase: string | null }> {
    return [...this.active.values()].map(a => ({ jobId: a.jobId, type: a.type, phase: a.phase }));
  }
}
