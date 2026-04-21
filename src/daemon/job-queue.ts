import type { ShadowConfig } from '../config/schema.js';
import type { ShadowDatabase } from '../storage/database.js';
import type { JobRecord } from '../storage/models.js';
import type { EventBus } from '../web/event-bus.js';
import type { JobHandlerEntry, JobContext, DaemonSharedState, JobHandlerResult } from './job-handlers.js';
import { runInJobScope, killJobAdapters } from '../backend/claude-cli.js';
import { log } from '../log.js';

const JOB_TIMEOUT_MS = 15 * 60 * 1000; // 15min — extra headroom for 4-phase heartbeat (summarize + extract + cleanup + observe)

type ActiveJob = {
  jobId: string;
  type: string;
  category: 'llm' | 'io';
  phase: string | null;
  promise: Promise<void>;
  abort: AbortController;
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
   *
   * When `allowClaim` is false (e.g., during darkwake or no network), in-flight jobs
   * keep running but no new jobs are claimed from the queue — they wait for the next
   * tick where the system is fully awake and online.
   */
  async tick(opts: { allowClaim?: boolean } = {}): Promise<boolean> {
    const allowClaim = opts.allowClaim ?? true;

    // Cleanup: remove completed/failed from active map
    for (const [jobId] of this.active) {
      const job = this.db.getJob(jobId);
      if (!job || job.status !== 'running') {
        this.active.delete(jobId);
      }
    }

    // Compute types to exclude (same-type mutual exclusion)
    const excludeTypes = [...new Set([...this.active.values()].map(a => a.type))];

    // Manual triggers bypass the canSchedule gate — the user explicitly clicked
    // Trigger (or invoked `shadow job X`), their intent overrides darkwake/offline
    // gates. Scheduled jobs still wait for a fully-awake/online tick.
    if (!allowClaim) {
      this.claimLoop(excludeTypes, 'manual');
      return this.active.size > 0;
    }

    // Full claim loop — all trigger sources
    this.claimLoop(excludeTypes, null);
    return this.active.size > 0;
  }

  /**
   * Claim eligible queued jobs up to capacity. If `triggerSource` is set, only
   * jobs with that source are considered. Mutates `excludeTypes` as it claims
   * (same-type mutual exclusion per tick).
   */
  private claimLoop(excludeTypes: string[], triggerSource: string | null): void {
    while (true) {
      const currentLlm = [...this.active.values()].filter(a => a.category === 'llm').length;

      // When LLM slots are full, exclude all LLM types so only IO jobs get claimed
      const exclude = [...excludeTypes];
      if (currentLlm >= this.config.maxConcurrentJobs) {
        for (const [type, entry] of this.handlers) {
          if (entry.category === 'llm' && !exclude.includes(type)) exclude.push(type);
        }
      }

      const claimOpts: { excludeTypes?: string[]; triggerSource?: string } = {};
      if (exclude.length > 0) claimOpts.excludeTypes = exclude;
      if (triggerSource) claimOpts.triggerSource = triggerSource;

      const claimed = this.db.claimNextJob(Object.keys(claimOpts).length > 0 ? claimOpts : undefined);
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
      excludeTypes.push(claimed.type);

      if (triggerSource === 'manual') {
        log.error(`[job-queue] Claimed manual job '${claimed.type}' (bypassing canSchedule=false)`);
      }
    }
  }

  private startJob(job: JobRecord, entry: JobHandlerEntry): void {
    const startMs = Date.now();
    let cancelled = false;

    // Save original params before handler overwrites result (needed for retry)
    const originalParams: Record<string, unknown> = { ...(job.result as Record<string, unknown>) };
    delete originalParams.error;

    const abort = new AbortController();

    const activeEntry: ActiveJob = {
      jobId: job.id,
      type: job.type,
      category: entry.category,
      phase: null,
      promise: null!,
      abort,
    };

    // Per-job setPhase closure
    const setPhase = (phase: string | null) => {
      activeEntry.phase = phase;
      try {
        this.db.updateJob(job.id, { activity: phase });
      } catch (e) {
        log.error(`[job-queue] phase update failed for job ${job.id.slice(0, 8)} (${job.type}):`, e instanceof Error ? e.message : e);
      }
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
      signal: abort.signal,
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
        const errorCode = result.lastErrorCode ?? (isGhostJob ? 'unknown' : undefined);
        const finalResult = isGhostJob
          ? { ...result.result, error: 'LLM calls returned no tokens — possible auth/backend issue', ghost: true, errorCode }
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
          this.db.createEvent({ kind: 'job_completed', priority: 3, payload: { message: `Manual job completed: ${job.type}`, jobId: job.id, jobType: job.type, detail: JSON.stringify(finalResult).slice(0, 200) } });
        }

        // Track consecutive ghost jobs for backend health alerting
        if (isGhostJob) {
          this.shared.consecutiveGhostJobs++;
          this.shared.lastGhostHint = result.lastError ?? null;
          this.shared.lastGhostCode = errorCode ?? 'unknown';
          log.error(`[job-queue] Ghost job detected: ${job.type}/${job.id.slice(0, 8)} — code=${this.shared.lastGhostCode} llmCalls=${result.llmCalls} tokens=0 (consecutive: ${this.shared.consecutiveGhostJobs})`);
        } else if (entry.category === 'llm' && result.tokensUsed > 0) {
          this.shared.consecutiveGhostJobs = 0;
          this.shared.lastGhostHint = null;
          this.shared.lastGhostCode = null;
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
        log.error(`[job-queue] Job ${job.type}/${job.id.slice(0, 8)} failed:`, errorMsg);
        this.db.createEvent({ kind: 'job_failed', priority: 7, payload: { message: `${job.type} failed: ${errorMsg.slice(0, 100)}`, jobId: job.id, jobType: job.type, detail: errorMsg.slice(0, 200) } });

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
          log.error(`[job-queue] Auto-retry ${job.type}/${job.id.slice(0, 8)} (attempt ${retryCount + 2}/${MAX_RETRIES + 1})`);
        }
      } finally {
        setPhase(null);
        this.active.delete(job.id);
      }
    })();

    // Race against timeout (unref so timer doesn't prevent process exit)
    const jobTimeoutMs = entry.timeoutMs ?? JOB_TIMEOUT_MS;
    const timeoutPromise = new Promise<'timeout'>(r => { const t = setTimeout(() => r('timeout'), jobTimeoutMs); t.unref(); });
    Promise.race([jobPromise.then(() => 'done' as const), timeoutPromise]).then(winner => {
      if (winner === 'timeout' && this.active.has(job.id)) {
        cancelled = true;
        abort.abort(new Error(`timeout (${Math.round(jobTimeoutMs / 60000)}min)`));
        killJobAdapters(job.id);
        this.db.updateJob(job.id, {
          status: 'failed',
          result: { error: `timeout (${Math.round(jobTimeoutMs / 60000)}min)` },
          durationMs: jobTimeoutMs,
          finishedAt: new Date().toISOString(),
        });
        this.eventBus.emit({
          type: 'job:complete',
          data: { jobId: job.id, type: job.type, status: 'failed', durationMs: jobTimeoutMs, error: 'timeout' },
        });
        log.error(`[job-queue] Job ${job.type}/${job.id.slice(0, 8)} timed out — killed adapters`);
        this.db.createEvent({ kind: 'job_failed', priority: 7, payload: { message: `${job.type} timed out`, jobId: job.id, jobType: job.type, detail: 'Job exceeded timeout limit' } });
        this.active.delete(job.id);
      }
    });

    activeEntry.promise = jobPromise;
    this.active.set(job.id, activeEntry);
  }


  async drainAll(timeoutMs = 60_000): Promise<void> {
    if (this.active.size === 0) return;
    log.error(`[job-queue] Draining ${this.active.size} active jobs (max ${Math.round(timeoutMs / 1000)}s)...`);
    const promises = [...this.active.values()].map(a => a.promise);
    const result = await Promise.race([
      Promise.allSettled(promises).then(() => 'done' as const),
      new Promise<'timeout'>(r => setTimeout(r, timeoutMs)),
    ]);
    if (result === 'timeout' && this.active.size > 0) {
      log.error(`[job-queue] Drain timeout — killing ${this.active.size} remaining jobs`);
      this.killAll();
    }
  }

  killAll(): void {
    for (const entry of this.active.values()) {
      entry.abort.abort(new Error('daemon shutdown'));
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
