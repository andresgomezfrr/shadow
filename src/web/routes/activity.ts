import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ShadowDatabase } from '../../storage/database.js';
import type { DaemonSharedState } from '../../daemon/job-handlers.js';
import { json, clampLimit, clampOffset } from '../helpers.js';

// Shared vocabulary — any new run/job status lives in one place so the
// enum validation below and the dashboard filters stay in sync (audit W-12).
const VALID_STATUSES = ['queued', 'running', 'planned', 'awaiting_pr', 'done', 'dismissed', 'failed', 'completed'] as const;
const VALID_PERIODS = ['today', '7d', '30d'] as const;
const VALID_SOURCES = ['job', 'run'] as const;

export async function handleActivityRoutes(
  req: IncomingMessage, res: ServerResponse,
  pathname: string, params: URLSearchParams,
  db: ShadowDatabase,
  _daemonState?: DaemonSharedState,
): Promise<boolean> {

  if (req.method !== 'GET') return false;

  // --- Unified activity timeline (jobs + runs) ---
  if (pathname === '/api/activity') {
    const typeFilter = params.get('type') ?? undefined;
    const sourceFilter = params.get('source') ?? undefined;
    const statusFilter = params.get('status') ?? undefined;
    const periodFilter = params.get('period') ?? undefined;
    const limit = clampLimit(params.get('limit'), 30);
    const offset = clampOffset(params.get('offset'));

    // Validate enums (audit W-12). `type` is open-ended (many job types exist
    // and a `run:*` prefix) so we don't lock that down — status/period/source
    // have fixed vocabularies where a typo silently returned empty results.
    if (statusFilter !== undefined && !(VALID_STATUSES as readonly string[]).includes(statusFilter)) {
      return json(res, { error: `Invalid status "${statusFilter}". Expected: ${VALID_STATUSES.join(', ')}` }, 400), true;
    }
    if (periodFilter !== undefined && !(VALID_PERIODS as readonly string[]).includes(periodFilter)) {
      return json(res, { error: `Invalid period "${periodFilter}". Expected: ${VALID_PERIODS.join(', ')}` }, 400), true;
    }
    if (sourceFilter !== undefined && !(VALID_SOURCES as readonly string[]).includes(sourceFilter)) {
      return json(res, { error: `Invalid source "${sourceFilter}". Expected: ${VALID_SOURCES.join(', ')}` }, 400), true;
    }

    // Compute period start date
    let periodDate: string | null = null;
    if (periodFilter === 'today') {
      const d = new Date(); d.setHours(0, 0, 0, 0);
      periodDate = d.toISOString();
    } else if (periodFilter === '7d') {
      periodDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    } else if (periodFilter === '30d') {
      periodDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    }

    // Determine which sources to query
    const isRunType = typeFilter === 'run' || typeFilter?.startsWith('run:');
    const fetchJobs = sourceFilter !== 'run' && !isRunType;
    const fetchRuns = sourceFilter !== 'job' && (!typeFilter || isRunType);

    type ActivityEntry = {
      id: string;
      source: 'job' | 'run';
      type: string;
      status: string;
      phases: string[];
      activity: string | null;
      llmCalls: number;
      tokensUsed: number;
      durationMs: number | null;
      result: Record<string, unknown>;
      startedAt: string | null;
      finishedAt: string | null;
      runId: string | null;
      repoName: string | null;
      confidence: string | null;
      verified: string | null;
      parentRunId: string | null;
      prUrl: string | null;
      taskId: string | null;
      taskTitle: string | null;
    };

    const merged: ActivityEntry[] = [];
    let totalJobs = 0;
    let totalRuns = 0;

    // Fetch enough from each table to cover offset+limit after merge
    const fetchLimit = limit + offset;

    if (fetchJobs) {
      const jobFilters: { type?: string; status?: string; limit: number; offset: number } = { limit: fetchLimit, offset: 0 };
      if (typeFilter && !isRunType) jobFilters.type = typeFilter;
      if (statusFilter) jobFilters.status = statusFilter;
      let jobs = db.listJobs(jobFilters);
      if (periodDate) jobs = jobs.filter(j => j.startedAt && j.startedAt >= periodDate!);
      for (const j of jobs) {
        merged.push({
          id: j.id,
          source: 'job',
          type: j.type,
          status: j.status,
          phases: j.phases ?? [],
          activity: j.activity ?? null,
          llmCalls: j.llmCalls ?? 0,
          tokensUsed: j.tokensUsed ?? 0,
          durationMs: j.durationMs ?? null,
          result: j.result ?? {},
          startedAt: j.startedAt ?? null,
          finishedAt: j.finishedAt ?? null,
          runId: null,
          repoName: null,
          confidence: null,
          verified: null,
          parentRunId: null,
          prUrl: null,
          taskId: null,
          taskTitle: null,
        });
      }
      // Count: filter by period in JS if needed
      if (periodDate) {
        totalJobs = jobs.length;
      } else {
        const countFilters: { type?: string; status?: string } = {};
        if (typeFilter && !isRunType) countFilters.type = typeFilter;
        if (statusFilter) countFilters.status = statusFilter;
        totalJobs = db.countJobs(countFilters);
      }
    }

    if (fetchRuns) {
      const runFilters: { status?: string; limit: number; offset: number } = { limit: fetchLimit, offset: 0 };
      if (statusFilter) runFilters.status = statusFilter;
      let runs = db.listRuns(runFilters);
      if (periodDate) runs = runs.filter(r => (r.startedAt ?? r.createdAt) >= periodDate!);
      for (const r of runs) {
        const repoName = r.repoId ? (db.getRepo(r.repoId)?.name ?? null) : null;
        const task = r.taskId ? db.getTask(r.taskId) : null;
        const runResult: Record<string, unknown> = {};
        if (r.resultSummaryMd) runResult.summaryMd = r.resultSummaryMd;
        if (r.errorSummary) runResult.error = r.errorSummary;
        if (r.outcome) runResult.outcome = r.outcome;
        if (r.diffStat) runResult.diffStat = r.diffStat;
        if (r.doubts && r.doubts.length > 0) runResult.doubts = r.doubts;
        if (r.verification && Object.keys(r.verification).length > 0) runResult.verification = r.verification;
        merged.push({
          id: r.id,
          source: 'run',
          type: r.kind === 'execution' ? 'run:execute' : 'run:plan',
          status: r.status,
          phases: [],
          activity: r.activity ?? null,
          llmCalls: 0,
          tokensUsed: 0,
          durationMs: r.startedAt && r.finishedAt ? new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime() : null,
          result: runResult,
          startedAt: r.startedAt ?? r.createdAt,
          finishedAt: r.finishedAt ?? null,
          runId: r.id,
          repoName,
          confidence: r.confidence ?? null,
          verified: r.verified ?? null,
          parentRunId: r.parentRunId ?? null,
          prUrl: r.prUrl ?? null,
          taskId: r.taskId ?? null,
          taskTitle: task?.title ?? null,
        });
      }
      if (periodDate) {
        totalRuns = runs.length;
      } else {
        const countFilters: { status?: string } = {};
        if (statusFilter) countFilters.status = statusFilter;
        totalRuns = db.countRuns(countFilters);
      }
    }

    // Sort by startedAt DESC, then paginate
    merged.sort((a, b) => {
      const ta = a.startedAt ? new Date(a.startedAt).getTime() : 0;
      const tb = b.startedAt ? new Date(b.startedAt).getTime() : 0;
      return tb - ta;
    });
    const items = merged.slice(offset, offset + limit);
    const total = totalJobs + totalRuns;
    return json(res, { items, total }), true;
  }

  // --- Activity summary (aggregated metrics) ---
  if (pathname === '/api/activity/summary') {
    const periodParam = params.get('period') ?? 'today';
    let periodDate: string;
    if (periodParam === '7d') {
      periodDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    } else if (periodParam === '30d') {
      periodDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    } else {
      // 'today' or default
      const d = new Date(); d.setHours(0, 0, 0, 0);
      periodDate = d.toISOString();
    }

    const allJobs = db.listJobs({ startedAfter: periodDate, limit: 1000 });
    const allRuns = db.listRuns({ startedAfter: periodDate, limit: 1000 });

    let llmCalls = 0;
    let tokensUsed = 0;
    let observationsCreated = 0;
    let memoriesCreated = 0;
    let suggestionsCreated = 0;

    for (const j of allJobs) {
      llmCalls += j.llmCalls ?? 0;
      tokensUsed += j.tokensUsed ?? 0;
      const result = j.result as Record<string, unknown> | undefined;
      if (result) {
        if (j.type === 'heartbeat' || j.type.startsWith('heartbeat')) {
          observationsCreated += (typeof result.observationsCreated === 'number' ? result.observationsCreated : 0);
          memoriesCreated += (typeof result.memoriesCreated === 'number' ? result.memoriesCreated : 0);
        }
        if (j.type === 'suggest' || j.type.startsWith('suggest')) {
          suggestionsCreated += (typeof result.suggestionsCreated === 'number' ? result.suggestionsCreated : 0);
        }
      }
    }

    return json(res, {
      period: periodParam,
      jobCount: allJobs.length,
      runCount: allRuns.length,
      llmCalls,
      tokensUsed,
      observationsCreated,
      memoriesCreated,
      suggestionsCreated,
    }), true;
  }

  if (pathname === '/api/daily-summary') {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const sinceIso = todayStart.toISOString();
    const profile = db.ensureProfile();
    const repos = db.listRepos();
    const todayObs = db.listObservations({ status: 'open', limit: 10 });
    const todayMemories = db.listMemories({ archived: false, createdSince: sinceIso, limit: 50 });
    const suggestions = db.listSuggestions({ status: 'open', limit: 20 });
    const usage = db.getUsageSummary('day');
    const events = db.listPendingEvents();
    const runsToReview = db.listRuns({ status: 'planned', limit: 5 });
    const recentJobs = db.listJobs({ limit: 5 });
    // Active projects with observation/suggestion counts
    const activeProjects = db.listProjects({ status: 'active' }).map(p => {
      const obsCount = db.countObservations({ status: 'open', projectId: p.id });
      const sugCount = db.countSuggestions({ status: 'open', projectId: p.id });
      const topObs = obsCount > 0 ? db.listObservations({ status: 'open', projectId: p.id, limit: 1 }) : [];
      return {
        id: p.id, name: p.name, kind: p.kind,
        repoCount: p.repoIds.length, systemCount: p.systemIds.length,
        observationCount: obsCount, suggestionCount: sugCount,
        topObservation: topObs[0]?.title ?? null,
      };
    });

    // Recent enrichment
    let recentEnrichment: unknown[] = [];
    try {
      recentEnrichment = db.listNewEnrichment(5).map(e => ({
        id: e.id, source: e.source, entityName: e.entityName, summary: e.summary, createdAt: e.createdAt,
      }));
    } catch { /* enrichment_cache may not exist yet */ }

    return json(res, {
      date: todayStart.toISOString().split('T')[0],
      profile,
      activity: {
        observationsToday: db.countObservations({ status: 'open' }),
        memoriesCreatedToday: db.countMemories({ archived: false, createdSince: sinceIso }),
        pendingSuggestions: db.countPendingSuggestions(),
        runsToReview: db.countRuns({ status: 'planned' }),
        pendingEvents: events.length,
      },
      topObservations: todayObs,
      recentMemories: todayMemories.slice(0, 5).map((m) => ({ id: m.id, title: m.title, kind: m.kind, layer: m.layer, createdAt: m.createdAt })),
      runsToReview,
      pendingSuggestions: suggestions,
      repos: repos.map((r) => ({ id: r.id, name: r.name, path: r.path, lastObservedAt: r.lastObservedAt })),
      tokens: { input: usage.totalInputTokens, output: usage.totalOutputTokens, calls: usage.totalCalls },
      recentJobs,
      activeProjects,
      recentEnrichment,
    }), true;
  }

  return false;
}
