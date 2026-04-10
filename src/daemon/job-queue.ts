import type { ShadowConfig } from '../config/schema.js';
import type { ShadowDatabase } from '../storage/database.js';
import type { JobRecord } from '../storage/models.js';
import type { EventBus } from '../web/event-bus.js';
import type { JobHandlerEntry, JobContext, DaemonSharedState, JobHandlerResult } from './job-handlers.js';
import { runInJobScope, killJobAdapters } from '../backend/claude-cli.js';

const JOB_TIMEOUT_MS = 15 * 60 * 1000; // 15min — extra headroom for 4-phase heartbeat (summarize + extract + cleanup + observe)

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

    // Claim loop: LLM jobs capped by maxConcurrentJobs, IO jobs unlimited
    while (true) {
      const currentLlm = [...this.active.values()].filter(a => a.category === 'llm').length;

      // When LLM slots are full, exclude all LLM types so only IO jobs get claimed
      const exclude = [...excludeTypes];
      if (currentLlm >= this.config.maxConcurrentJobs) {
        for (const [type, entry] of this.handlers) {
          if (entry.category === 'llm' && !exclude.includes(type)) exclude.push(type);
        }
      }

      const claimed = this.db.claimNextJob(
        exclude.length > 0 ? { excludeTypes: exclude } : undefined,
      );
      if (!claimed) break;

      const entry = this.handlers.get(claimed.type);
      if (!entry) {
        this.db.updateJob(claimed.id, {
          status: 'failed',
          result: { error: `unknown job type: ${claimed.type}` },
          finishedAt: new Date().toISOString(),
        });
        continue;
      }

      this.startJob(claimed, entry);
      excludeTypes.push(claimed.type); // same-type mutual exclusion
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

    const ac = new AbortController();
    const ctx: JobContext = {
      jobId: job.id,
      config: this.config,
      db: this.db,
      eventBus: this.eventBus,
      setPhase,
      signal: ac.signal,
    };

    // Emit job:started
    this.eventBus.emit({ type: 'job:started', data: { jobId: job.id, type: job.type, priority: job.priority } });

    // Execute handler within job scope (for per-job adapter tracking)
    const handlerPromise = runInJobScope(job.id, () => entry.fn(ctx, this.shared));

    const jobPromise = (async () => {
      try {
        const result = await handlerPromise;
        if (cancelled) return;

        // Detect ghost jobs: LLM calls were attempted but returned no tokens (auth/backend issue)
        const isGhostJob = entry.category === 'llm' && result.llmCalls > 0 && result.tokensUsed === 0;
        const finalStatus = isGhostJob ? 'failed' : 'completed';
        const finalResult = isGhostJob
          ? { ...result.result, error: 'LLM calls returned no tokens — possible auth/backend issue', ghost: true }
          : result.result;

        this.db.updateJob(job.id, {
          status: finalStatus,
          phases: result.phases,
          llmCalls: result.llmCalls,
          tokensUsed: result.tokensUsed,
          result: finalResult,
          durationMs: Date.now() - startMs,
          finishedAt: new Date().toISOString(),
        });
        this.eventBus.emit({
          type: 'job:complete',
          data: { jobId: job.id, type: job.type, status: finalStatus, durationMs: Date.now() - startMs, result: finalResult },
        });
        // Emit event for manually triggered jobs
        if (finalStatus === 'completed' && job.triggerSource === 'manual') {
          this.db.createEvent({ kind: 'job_completed', priority: 3, payload: { message: `Manual job completed: ${job.type}`, detail: JSON.stringify(finalResult).slice(0, 200) } });
        }

        // Track consecutive ghost jobs for backend health alerting
        if (isGhostJob) {
          this.shared.consecutiveGhostJobs++;
          this.shared.lastGhostHint = result.lastError ?? null;
          console.error(`[job-queue] Ghost job detected: ${job.type}/${job.id.slice(0, 8)} — ${result.llmCalls} LLM calls, 0 tokens (consecutive: ${this.shared.consecutiveGhostJobs})`);
        } else if (entry.category === 'llm' && result.tokensUsed > 0) {
          this.shared.consecutiveGhostJobs = 0;
          this.shared.lastGhostHint = null;
        }
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
        this.db.createEvent({ kind: 'job_failed', priority: 7, payload: { message: `${job.type} failed: ${errorMsg.slice(0, 100)}`, jobType: job.type, detail: errorMsg.slice(0, 200) } });

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
        ac.abort();
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
        this.db.createEvent({ kind: 'job_failed', priority: 7, payload: { message: `${job.type} timed out`, jobType: job.type, detail: 'Job exceeded timeout limit' } });
        this.active.delete(job.id);
      }
    });

    activeEntry.promise = jobPromise;
    this.active.set(job.id, activeEntry);
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
