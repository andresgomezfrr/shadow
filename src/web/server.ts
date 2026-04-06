import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase, type ShadowDatabase } from '../storage/database.js';
import { loadConfig } from '../config/load-config.js';
import { ProfileUpdateSchema } from '../config/schema.js';
import { DIGEST_SCHEDULES, nextScheduledAt } from '../daemon/schedules.js';
import type { EventBus } from './event-bus.js';

function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data));
}

function html(res: ServerResponse, body: string): void {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(body);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

function parseUrl(req: IncomingMessage): { pathname: string; params: URLSearchParams } {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  return { pathname: url.pathname, params: url.searchParams };
}

async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  params: URLSearchParams,
  db: ShadowDatabase,
): Promise<void> {
  // --- GET routes ---
  if (req.method === 'GET') {
    if (pathname === '/api/status') {
      const config = loadConfig();
      let nextHeartbeatAt: string | null = null;
      try {
        const statePath = resolve(config.resolvedDataDir, 'daemon.json');
        if (existsSync(statePath)) {
          const raw = JSON.parse(readFileSync(statePath, 'utf-8'));
          nextHeartbeatAt = raw.nextHeartbeatAt ?? null;
        }
      } catch { /* ignore */ }
      const profile = db.ensureProfile();
      const memoriesCount = db.countMemories({ archived: false });
      const pendingSuggestions = db.countPendingSuggestions();
      const reposCount = db.countRepos();
      const contactsCount = db.countContacts();
      const systemsCount = db.countSystems();
      const lastHeartbeat = db.getLastJob('heartbeat');
      const usage = db.getUsageSummary('day');
      const activeObservations = db.countObservations({ status: 'active' });
      const runsToReview = db.countRuns({ status: 'completed' });
      return json(res, {
        profile,
        counts: {
          memories: memoriesCount,
          pendingSuggestions,
          activeObservations,
          runsToReview,
          repos: reposCount,
          contacts: contactsCount,
          systems: systemsCount,
        },
        usage,
        lastHeartbeat,
        nextHeartbeatAt,
        jobSchedule: {
          heartbeat: { intervalMs: 30 * 60 * 1000, nextAt: nextHeartbeatAt },
          suggest: (() => {
            const lastSug = db.getLastJob('suggest');
            const intervalMs = config.suggestIntervalMs;
            const nextAt = lastSug ? new Date(new Date(lastSug.startedAt).getTime() + intervalMs).toISOString() : null;
            return { intervalMs, nextAt };
          })(),
          consolidate: (() => {
            const lastCon = db.getLastJob('consolidate');
            const nextAt = lastCon ? new Date(new Date(lastCon.startedAt).getTime() + 6 * 60 * 60 * 1000).toISOString() : null;
            return { intervalMs: 6 * 60 * 60 * 1000, nextAt };
          })(),
          reflect: (() => {
            const lastRef = db.getLastJob('reflect');
            const nextAt = lastRef ? new Date(new Date(lastRef.startedAt).getTime() + 24 * 60 * 60 * 1000).toISOString() : null;
            return { intervalMs: 24 * 60 * 60 * 1000, nextAt };
          })(),
          'remote-sync': (() => {
            const lastSync = db.getLastJob('remote-sync');
            const nextAt = lastSync ? new Date(new Date(lastSync.startedAt).getTime() + config.remoteSyncIntervalMs).toISOString() : null;
            return { intervalMs: config.remoteSyncIntervalMs, nextAt };
          })(),
          'repo-profile': (() => {
            const lastRp = db.getLastJob('repo-profile');
            return {
              trigger: 'after remote-sync detects changes',
              nextAt: null,
              enabled: config.repoProfileEnabled,
              lastRanAt: lastRp?.startedAt ?? null,
            };
          })(),
          'context-enrich': (() => {
            const prefs = profile.preferences as Record<string, unknown> | undefined;
            const enabled = (prefs?.enrichmentEnabled as boolean | undefined) ?? config.enrichmentEnabled;
            const intMin = prefs?.enrichmentIntervalMin as number | undefined;
            const intervalMs = intMin ? intMin * 60 * 1000 : config.enrichmentIntervalMs;
            const lastEnrich = db.getLastJob('context-enrich');
            const nextAt = enabled && lastEnrich ? new Date(new Date(lastEnrich.startedAt).getTime() + intervalMs).toISOString() : null;
            return { intervalMs, nextAt, enabled };
          })(),
          ...Object.fromEntries(Object.entries(DIGEST_SCHEDULES).map(([type, sched]) => {
            const tz = db.ensureProfile().timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
            return [type, { schedule: sched.label, nextAt: nextScheduledAt(sched, tz) }];
          })),
        },
      });
    }

    if (pathname === '/api/memories') {
      const q = params.get('q');
      const layer = params.get('layer') ?? undefined;
      const memoryType = params.get('memoryType') ?? undefined;
      const limit = params.get('limit') ? parseInt(params.get('limit')!, 10) : undefined;
      const offset = params.get('offset') ? parseInt(params.get('offset')!, 10) : undefined;
      if (q) {
        const results = db.searchMemories(q, { layer, limit: limit ?? 50 });
        const items = results.map((r) => ({ ...r.memory, rank: r.rank, snippet: r.snippet }));
        return json(res, { items, total: items.length });
      }
      const items = db.listMemories({ layer, memoryType, archived: false, limit, offset });
      const total = db.countMemories({ layer, memoryType, archived: false });
      return json(res, { items, total });
    }

    if (pathname === '/api/suggestions') {
      const status = params.get('status') ?? undefined;
      const kind = params.get('kind') ?? undefined;
      const limit = params.get('limit') ? parseInt(params.get('limit')!, 10) : undefined;
      const offset = params.get('offset') ? parseInt(params.get('offset')!, 10) : undefined;
      let items = db.listSuggestions({ status, kind, limit, offset });
      // Sort pending suggestions by rank score (best first)
      if (status === 'pending' && items.length > 0) {
        const profile = db.ensureProfile();
        const { computeRankScore } = await import('../suggestion/ranking.js');
        const { computeProjectMomentum } = await import('../heartbeat/project-detection.js');
        const projects = db.listProjects();
        const projectMomentum = new Map(projects.map(p => [p.id, computeProjectMomentum(db, p.id, 7)]));
        items.sort((a, b) => computeRankScore(b, profile, { projectMomentum }) - computeRankScore(a, profile, { projectMomentum }));
      }
      const total = db.countSuggestions({ status, kind });
      const fbState = db.getThumbsState('suggestion');
      return json(res, { items, total, feedbackState: fbState });
    }

    if (pathname === '/api/observations') {
      const limit = parseInt(params.get('limit') ?? '20', 10);
      const offset = params.get('offset') ? parseInt(params.get('offset')!, 10) : undefined;
      const status = params.get('status') ?? 'all';
      const repoId = params.get('repoId') ?? undefined;
      const severity = params.get('severity') ?? undefined;
      const items = db.listObservations({ limit, offset, status, repoId, severity });
      const total = db.countObservations({ repoId, status, severity });
      const fbState = db.getThumbsState('observation');
      return json(res, { items, total, feedbackState: fbState });
    }

    if (pathname === '/api/contacts') {
      const team = params.get('team') ?? undefined;
      const contacts = db.listContacts({ team });
      return json(res, contacts);
    }

    if (pathname === '/api/digest/status') {
      const status: Record<string, { status: string; periodStart?: string }> = {};
      for (const kind of ['daily', 'weekly', 'brag']) {
        const job = db.getLastJob(`digest-${kind}`);
        if (job?.status === 'running' || job?.status === 'queued') {
          status[kind] = { status: job.status, periodStart: (job.result as Record<string, string>).periodStart };
        } else {
          status[kind] = { status: 'idle' };
        }
      }
      return json(res, status);
    }

    if (pathname === '/api/digests') {
      const kind = params.get('kind') ?? undefined;
      const limit = params.get('limit') ? parseInt(params.get('limit')!, 10) : 20;
      const before = params.get('before') ?? undefined;
      const after = params.get('after') ?? undefined;
      const digests = db.listDigests({ kind, limit, before, after });
      return json(res, digests);
    }

    if (pathname === '/api/projects') {
      const status = params.get('status') ?? undefined;
      const projects = db.listProjects(status ? { status } : undefined);
      return json(res, projects);
    }

    if (pathname === '/api/systems') {
      const kind = params.get('kind') ?? undefined;
      const systems = db.listSystems({ kind });
      return json(res, systems);
    }

    // Project detail: /api/projects/:id
    const projectDetailMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
    if (projectDetailMatch && req.method === 'GET') {
      const project = db.getProject(projectDetailMatch[1]);
      if (!project) return json(res, { error: 'Project not found' }, 404);

      const repos = project.repoIds.map(id => db.getRepo(id)).filter(Boolean);
      const systems = project.systemIds.map(id => db.getSystem(id)).filter(Boolean);
      const contacts = project.contactIds.map(id => db.getContact(id)).filter(Boolean);

      const observations = db.listObservations({ status: 'active', limit: 50 })
        .filter(o => (o.entities ?? []).some(e => e.type === 'project' && e.id === project.id));
      const suggestions = db.listSuggestions({ status: 'pending' })
        .filter(s => (s.entities ?? []).some(e => e.type === 'project' && e.id === project.id));
      const memories = db.listMemories({ archived: false })
        .filter(m => (m.entities ?? []).some(e => e.type === 'project' && e.id === project.id));

      let enrichment: unknown[] = [];
      try {
        enrichment = db.listEnrichment({ limit: 10 })
          .filter(e => e.entityType === 'project' && e.entityId === project.id);
      } catch { /* enrichment_cache may not exist yet */ }

      return json(res, {
        ...project,
        repos: repos.map(r => ({ id: r!.id, name: r!.name, path: r!.path, lastObservedAt: r!.lastObservedAt })),
        systems: systems.map(s => ({ id: s!.id, name: s!.name, kind: s!.kind })),
        contacts: contacts.map(c => ({ id: c!.id, name: c!.name, role: c!.role, team: c!.team })),
        observations: observations.slice(0, 10).map(o => ({ id: o.id, kind: o.kind, severity: o.severity, title: o.title, votes: o.votes, createdAt: o.createdAt })),
        suggestions: suggestions.slice(0, 10).map(s => ({ id: s.id, kind: s.kind, title: s.title, impactScore: s.impactScore, confidenceScore: s.confidenceScore, riskScore: s.riskScore })),
        memories: memories.slice(0, 10).map(m => ({ id: m.id, kind: m.kind, layer: m.layer, title: m.title, createdAt: m.createdAt })),
        enrichment,
        counts: {
          observations: observations.length,
          suggestions: suggestions.length,
          memories: memories.length,
        },
      });
    }

    // System detail: /api/systems/:id
    const systemDetailMatch = pathname.match(/^\/api\/systems\/([^/]+)$/);
    if (systemDetailMatch && req.method === 'GET') {
      const system = db.getSystem(systemDetailMatch[1]);
      if (!system) return json(res, { error: 'System not found' }, 404);

      const observations = db.listObservations({ status: 'active', limit: 50 })
        .filter(o => (o.entities ?? []).some(e => e.type === 'system' && e.id === system.id));
      const memories = db.listMemories({ archived: false })
        .filter(m => (m.entities ?? []).some(e => e.type === 'system' && e.id === system.id));

      // Find projects that include this system
      const projects = db.listProjects({ status: 'active' })
        .filter(p => p.systemIds.includes(system.id));

      return json(res, {
        ...system,
        observations: observations.slice(0, 10).map(o => ({ id: o.id, kind: o.kind, severity: o.severity, title: o.title, createdAt: o.createdAt })),
        memories: memories.slice(0, 10).map(m => ({ id: m.id, kind: m.kind, title: m.title, createdAt: m.createdAt })),
        projects: projects.map(p => ({ id: p.id, name: p.name, kind: p.kind })),
        counts: {
          observations: observations.length,
          memories: memories.length,
          projects: projects.length,
        },
      });
    }

    // Enrichment cache: /api/enrichment
    if (pathname === '/api/enrichment') {
      const source = params.get('source') ?? undefined;
      const limit = parseInt(params.get('limit') ?? '20', 10);
      const offset = parseInt(params.get('offset') ?? '0', 10);
      try {
        const items = db.listEnrichment({ source, limit, offset });
        const total = db.countEnrichment({ source });
        return json(res, { items, total });
      } catch {
        return json(res, { items: [], total: 0 });
      }
    }

    // Soul history: current reflection + archived snapshots
    if (pathname === '/api/soul/history') {
      const all = db.listMemories({ archived: false });
      const current = all.find(m => m.kind === 'soul_reflection');
      // Snapshots are archived memories with kind='soul_snapshot'
      const snapshots = db.rawDb
        .prepare("SELECT id, title, body_md, created_at, archived_at FROM memories WHERE kind = 'soul_snapshot' ORDER BY created_at DESC LIMIT 20")
        .all()
        .map((row: unknown) => {
          const r = row as Record<string, unknown>;
          return { id: String(r.id), title: String(r.title), bodyMd: String(r.body_md), createdAt: String(r.created_at), archivedAt: String(r.archived_at) };
        });
      return json(res, {
        current: current ? { id: current.id, bodyMd: current.bodyMd, updatedAt: current.updatedAt } : null,
        snapshots,
      });
    }

    if (pathname === '/api/config') {
      const cfg = loadConfig();
      // Expose runtime config without sensitive paths
      const { resolvedDataDir, resolvedDatabasePath, resolvedArtifactsDir, claudeBin, claudeExtraPath, ...safe } = cfg;
      return json(res, { config: safe });
    }

    if (pathname === '/api/usage') {
      const period = (params.get('period') ?? 'week') as 'day' | 'week' | 'month';
      const usage = db.getUsageSummary(period);
      return json(res, usage);
    }

    if (pathname === '/api/heartbeats') {
      // Legacy alias — redirect to jobs with type=heartbeat
      const limit = parseInt(params.get('limit') ?? '30', 10);
      const jobs = db.listJobs({ type: 'heartbeat', limit });
      return json(res, jobs);
    }

    if (pathname === '/api/jobs') {
      const type = params.get('type') ?? undefined;
      const typePrefix = params.get('typePrefix') ?? undefined;
      const limit = parseInt(params.get('limit') ?? '30', 10);
      const offset = params.get('offset') ? parseInt(params.get('offset')!, 10) : undefined;
      const items = db.listJobs({ type, typePrefix, limit, offset });
      const total = db.countJobs({ type, typePrefix });
      return json(res, { items, total });
    }

    if (pathname === '/api/repos') {
      const repos = db.listRepos();
      return json(res, repos);
    }

    if (pathname === '/api/entity-graph') {
      const relations = db.listRelations();
      return json(res, relations);
    }

    if (pathname === '/api/daily-summary') {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const sinceIso = todayStart.toISOString();
      const profile = db.ensureProfile();
      const repos = db.listRepos();
      const todayObs = db.listObservations({ status: 'active', limit: 10 });
      const todayMemories = db.listMemories({ archived: false, createdSince: sinceIso, limit: 50 });
      const suggestions = db.listSuggestions({ status: 'pending', limit: 20 });
      const usage = db.getUsageSummary('day');
      const events = db.listPendingEvents();
      const runsToReview = db.listRuns({ status: 'completed', limit: 5 });
      const recentJobs = db.listJobs({ limit: 5 });
      // Active projects with observation/suggestion counts
      const activeProjects = db.listProjects({ status: 'active' }).map(p => {
        const projObs = db.listObservations({ status: 'active', limit: 50 })
          .filter(o => (o.entities ?? []).some(e => e.type === 'project' && e.id === p.id));
        const projSugs = suggestions
          .filter(s => (s.entities ?? []).some(e => e.type === 'project' && e.id === p.id));
        return {
          id: p.id, name: p.name, kind: p.kind,
          repoCount: p.repoIds.length, systemCount: p.systemIds.length,
          observationCount: projObs.length, suggestionCount: projSugs.length,
          topObservation: projObs[0]?.title ?? null,
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
          observationsToday: db.countObservations({ status: 'active' }),
          memoriesCreatedToday: db.countMemories({ archived: false, createdSince: sinceIso }),
          pendingSuggestions: db.countPendingSuggestions(),
          runsToReview: db.countRuns({ status: 'completed' }),
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
      });
    }

    if (pathname === '/api/events') {
      const events = db.listPendingEvents();
      return json(res, events);
    }

    if (pathname === '/api/runs') {
      const status = params.get('status') ?? undefined;
      const repoId = params.get('repoId') ?? undefined;
      const archived = params.get('archived') === 'true' ? true : undefined;
      const limit = params.get('limit') ? parseInt(params.get('limit')!, 10) : undefined;
      const offset = params.get('offset') ? parseInt(params.get('offset')!, 10) : undefined;
      const items = db.listRuns({ status, repoId, archived, limit, offset });
      const total = db.countRuns({ status, archived });
      return json(res, { items, total });
    }

    if (pathname === '/api/feedback-state') {
      const targetKind = params.get('targetKind');
      if (!targetKind) return json(res, { error: 'Missing targetKind' }, 400);
      return json(res, db.getThumbsState(targetKind));
    }

    // --- Unified activity timeline (jobs + runs) ---
    if (pathname === '/api/activity') {
      const typeFilter = params.get('type') ?? undefined;
      const sourceFilter = params.get('source') ?? undefined;
      const statusFilter = params.get('status') ?? undefined;
      const periodFilter = params.get('period') ?? undefined;
      const limit = parseInt(params.get('limit') ?? '30', 10);
      const offset = parseInt(params.get('offset') ?? '0', 10);

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
          merged.push({
            id: r.id,
            source: 'run',
            type: `run:${r.kind}`,
            status: r.status,
            phases: [],
            activity: null,
            llmCalls: 0,
            tokensUsed: 0,
            durationMs: r.startedAt && r.finishedAt ? new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime() : null,
            result: r.resultSummaryMd ? { summaryMd: r.resultSummaryMd } : {},
            startedAt: r.startedAt ?? r.createdAt,
            finishedAt: r.finishedAt ?? null,
            runId: r.id,
            repoName,
            confidence: r.confidence ?? null,
            verified: r.verified ?? null,
            parentRunId: r.parentRunId ?? null,
            prUrl: r.prUrl ?? null,
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
      return json(res, { items, total });
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

      // Fetch generous limit and filter in JS
      const allJobs = db.listJobs({ limit: 500 }).filter(j => j.startedAt && j.startedAt >= periodDate);
      const allRuns = db.listRuns({ limit: 500 }).filter(r => (r.startedAt ?? r.createdAt) >= periodDate);

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
      });
    }
  }

  // --- POST routes ---
  if (req.method === 'POST') {
    const match = pathname.match(/^\/api\/suggestions\/([^/]+)\/(accept|dismiss|snooze)$/);
    if (match) {
      const [, id, action] = match;
      if (action === 'accept') {
        const { acceptSuggestion } = await import('../suggestion/engine.js');
        let category: string | undefined;
        try { const body = JSON.parse(await readBody(req)); category = body.category; } catch { /* no body is ok */ }
        const result = acceptSuggestion(db, id, category);
        if (!result.ok) return json(res, { error: 'Cannot accept — suggestion not pending' }, 400);
        const updated = db.getSuggestion(id);
        return json(res, { ...updated, runId: result.runCreated });
      } else if (action === 'dismiss') {
        const { dismissSuggestion } = await import('../suggestion/engine.js');
        let note: string | undefined;
        let category: string | undefined;
        try { const body = JSON.parse(await readBody(req)); note = body.note; category = body.category; } catch { /* no body is ok */ }
        await dismissSuggestion(db, id, note, category);
        const updated = db.getSuggestion(id);
        return json(res, updated);
      } else if (action === 'snooze') {
        let hours = 72;
        try { const body = JSON.parse(await readBody(req)); hours = body.hours ?? 72; } catch { /* */ }
        if (hours === 0) {
          // Unsnooze: wake immediately
          db.updateSuggestion(id, { status: 'pending', expiresAt: null });
          const updated = db.getSuggestion(id);
          return json(res, updated);
        }
        const { snoozeSuggestion } = await import('../suggestion/engine.js');
        const until = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
        const result = snoozeSuggestion(db, id, until);
        if (!result.ok) return json(res, { error: 'Cannot snooze — suggestion not pending' }, 400);
        const updated = db.getSuggestion(id);
        return json(res, updated);
      }
    }

    const obsMatch = pathname.match(/^\/api\/observations\/([^/]+)\/(acknowledge|resolve|reopen)$/);
    if (obsMatch) {
      const [, obsId, action] = obsMatch;
      const obs = db.getObservation(obsId);
      if (!obs) return json(res, { error: 'Not found' }, 404);
      const statusMap: Record<string, string> = { acknowledge: 'acknowledged', resolve: 'resolved', reopen: 'active' };
      db.updateObservationStatus(obsId, statusMap[action]);
      let obsNote: string | undefined;
      try { const body = JSON.parse(await readBody(req)); obsNote = body.note; } catch { /* ok */ }
      if (action !== 'reopen') db.createFeedback({ targetKind: 'observation', targetId: obsId, action, note: obsNote });
      return json(res, db.getObservation(obsId));
    }

    // --- Run actions ---
    const runArchiveMatch = pathname.match(/^\/api\/runs\/([^/]+)\/archive$/);
    if (runArchiveMatch) {
      const [, runId] = runArchiveMatch;
      const run = db.getRun(runId);
      if (!run) return json(res, { error: 'Run not found' }, 404);
      db.updateRun(runId, { archived: true });
      return json(res, { ok: true });
    }

    const runVerifyMatch = pathname.match(/^\/api\/runs\/([^/]+)\/verify$/);
    if (runVerifyMatch) {
      const [, runId] = runVerifyMatch;
      const run = db.getRun(runId);
      if (!run) return json(res, { error: 'Run not found' }, 404);
      if (run.kind !== 'execution') return json(res, { error: 'Only execution runs can be verified' }, 400);

      const repo = db.getRepo(run.repoId);
      if (!repo) return json(res, { error: 'Repository not found' }, 404);

      const { RunnerService } = await import('../runner/service.js');
      const { loadConfig } = await import('../config/load-config.js');
      const config = loadConfig();
      const runner = new RunnerService(config, db);
      const cwd = run.worktreePath ?? repo.path;
      const verifyResult = runner.runVerification(run.repoId, cwd);
      const hasCommands = Object.keys(verifyResult.results).length > 0;
      const verified = hasCommands ? (verifyResult.allPassed ? 'verified' : 'needs_review') : 'unverified';
      db.updateRun(runId, { verification: verifyResult.results, verified });
      return json(res, { ok: true, verified, verification: verifyResult.results });
    }

    const runRollbackMatch = pathname.match(/^\/api\/runs\/([^/]+)\/rollback$/);
    if (runRollbackMatch) {
      const [, runId] = runRollbackMatch;
      const run = db.getRun(runId);
      if (!run) return json(res, { error: 'Run not found' }, 404);
      if (!run.snapshotRef) return json(res, { error: 'No snapshot available for this run' }, 400);

      const { RunnerService } = await import('../runner/service.js');
      const { loadConfig } = await import('../config/load-config.js');
      const config = loadConfig();
      const runner = new RunnerService(config, db);
      const result = runner.rollbackRun(runId);
      if (!result.ok) return json(res, { error: result.error }, 500);
      return json(res, { ok: true });
    }

    const runRetryMatch = pathname.match(/^\/api\/runs\/([^/]+)\/retry$/);
    if (runRetryMatch) {
      const [, runId] = runRetryMatch;
      const run = db.getRun(runId);
      if (!run) return json(res, { error: 'Run not found' }, 404);
      if (run.status !== 'failed') return json(res, { error: 'Only failed runs can be retried' }, 400);
      const newRun = db.createRun({
        repoId: run.repoId,
        repoIds: run.repoIds,
        suggestionId: run.suggestionId,
        parentRunId: run.parentRunId ?? undefined,
        kind: run.kind,
        prompt: run.prompt,
      });
      db.updateRun(runId, { archived: true });
      return json(res, { ok: true, newRunId: newRun.id });
    }

    const runMatch = pathname.match(/^\/api\/runs\/([^/]+)\/(execute|session|discard|executed-manual)$/);
    if (runMatch) {
      const [, runId, action] = runMatch;
      const run = db.getRun(runId);
      if (!run) return json(res, { error: 'Run not found' }, 404);

      if (action === 'discard') {
        try { db.transitionRun(runId, 'discarded'); } catch { return json(res, { error: 'Run must be completed to discard' }, 400); }
        let discardNote: string | undefined;
        try { const body = JSON.parse(await readBody(req)); discardNote = body.note; } catch { /* ok */ }
        db.createFeedback({ targetKind: 'run', targetId: runId, action: 'discard', note: discardNote });

        // Auto-rollback + cleanup worktree on discard
        if (run.snapshotRef) {
          try {
            const { RunnerService } = await import('../runner/service.js');
            const { loadConfig } = await import('../config/load-config.js');
            const config = loadConfig();
            const runner = new RunnerService(config, db);
            runner.rollbackRun(runId);
          } catch { /* best-effort rollback */ }
        }
        if (run.worktreePath) {
          try {
            const repo = db.getRepo(run.repoId);
            if (repo) {
              const { execSync } = await import('node:child_process');
              execSync(`git worktree remove "${run.worktreePath}" --force`, { cwd: repo.path, timeout: 10_000, stdio: 'pipe' });
              const branchName = `shadow/${runId.slice(0, 8)}`;
              execSync(`git branch -D "${branchName}"`, { cwd: repo.path, timeout: 5_000, stdio: 'pipe' });
            }
          } catch { /* best-effort cleanup */ }
        }

        return json(res, { ok: true, status: 'discarded' });
      }

      if (action === 'executed-manual') {
        try { db.transitionRun(runId, 'executed_manual'); } catch { return json(res, { error: 'Run must be completed' }, 400); }
        return json(res, { ok: true, status: 'executed_manual' });
      }

      if (action === 'execute') {
        try { db.transitionRun(runId, 'executed'); } catch { return json(res, { error: 'Run must be completed to execute' }, 400); }
        const childRun = db.createRun({
          repoId: run.repoId,
          repoIds: run.repoIds,
          suggestionId: run.suggestionId,
          parentRunId: run.id,
          kind: 'execution',
          prompt: `Implement the following plan. Write the actual code changes.\n\n${run.resultSummaryMd}`,
        });
        return json(res, { runId: childRun.id, status: 'queued' });
      }

      if (action === 'session') {
        // If the run already has a sessionId, return it
        if (run.sessionId) {
          const repo = db.getRepo(run.repoId);
          const repoPath = repo?.path ?? process.cwd();
          return json(res, { sessionId: run.sessionId, command: `cd ${repoPath} && claude --resume ${run.sessionId}` });
        }
        // Create a session seeded with the plan + context. No --system-prompt so Claude has MCP access.
        const config = loadConfig();
        const { spawn: spawnChild } = await import('node:child_process');
        const { randomUUID } = await import('node:crypto');
        const sessionId: string = randomUUID();
        const suggestion = run.suggestionId ? db.getSuggestion(run.suggestionId) : null;
        const repo = db.getRepo(run.repoId);
        const cwd = repo?.path ?? process.cwd();
        const prompt = [
          `You are Shadow, helping implement a plan. You have MCP tools and filesystem access.`,
          '',
          `## Suggestion: ${suggestion?.title ?? run.kind}`,
          suggestion?.summaryMd ?? run.prompt,
          suggestion?.reasoningMd ? `\n## Reasoning\n${suggestion.reasoningMd}` : '',
          run.resultSummaryMd ? `\n## Plan\n${run.resultSummaryMd}` : '',
          '',
          `## Repository\n- ${repo?.name ?? 'unknown'} (${cwd})`,
          repo?.testCommand ? `- Test: \`${repo.testCommand}\`` : '',
          repo?.buildCommand ? `- Build: \`${repo.buildCommand}\`` : '',
          '',
          'Use shadow_memory_search for relevant context. Read files as needed.',
          'Ready to help implement this. What would you like to start with?',
        ].filter(Boolean).join('\n');
        const env: Record<string, string> = { ...process.env as Record<string, string> };
        const claudeBin = config.claudeBin ?? 'claude';
        if (config.claudeExtraPath) env.PATH = `${config.claudeExtraPath}:${env.PATH ?? ''}`;

        const result = await new Promise<{ stdout: string; error?: boolean; message?: string }>((resolve) => {
          const child = spawnChild(claudeBin, [
            '--print', '--output-format', 'json',
            '--session-id', sessionId,
            prompt,
          ], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
          const chunks: Buffer[] = [];
          child.stdout.on('data', (d: Buffer) => chunks.push(d));
          const timer = setTimeout(() => {
            child.kill('SIGTERM');
            setTimeout(() => child.kill('SIGKILL'), 5_000); // SIGKILL fallback
          }, 120_000);
          child.on('close', () => { clearTimeout(timer); resolve({ stdout: Buffer.concat(chunks).toString('utf8'), error: false }); });
          child.on('error', (err) => { clearTimeout(timer); resolve({ stdout: '', error: true, message: err.message }); });
        });

        if (result.error) {
          return json(res, { error: 'Failed to create session', detail: result.message }, 500);
        }
        let finalSessionId = sessionId;
        try {
          const out = JSON.parse(result.stdout || '{}') as { session_id?: string };
          if (out.session_id) finalSessionId = out.session_id;
        } catch { /* use generated */ }
        db.updateRun(runId, { sessionId: finalSessionId });
        return json(res, { sessionId: finalSessionId, command: `cd ${cwd} && claude --resume ${finalSessionId}` });
      }
    }

    // Draft PR endpoint
    const draftPrMatch = pathname.match(/^\/api\/runs\/([^/]+)\/draft-pr$/);
    if (draftPrMatch) {
      const runId = draftPrMatch[1];
      const run = db.getRun(runId);
      if (!run) return json(res, { error: 'Run not found' }, 404);
      if (!run.worktreePath) return json(res, { error: 'Run has no worktree/branch' }, 400);
      if (run.prUrl) return json(res, { ok: true, prUrl: run.prUrl });

      const repo = db.getRepo(run.repoId);
      if (!repo?.remoteUrl || !repo.remoteUrl.includes('github')) {
        return json(res, { error: 'Repo has no GitHub remote' }, 400);
      }

      const branchName = `shadow/${run.id.slice(0, 8)}`;

      // Verify branch exists locally before attempting push
      const { execSync: execCheck } = await import('node:child_process');
      try {
        execCheck(`git rev-parse --verify ${branchName}`, { cwd: repo.path, stdio: 'pipe', timeout: 5_000 });
      } catch {
        return json(res, { error: `Branch ${branchName} no longer exists — worktree may have been cleaned up` }, 400);
      }

      const suggestion = run.suggestionId ? db.getSuggestion(run.suggestionId) : null;
      const title = suggestion?.title ?? run.prompt.slice(0, 70);
      const body = [
        '## Summary',
        '',
        suggestion?.summaryMd ?? run.prompt,
        '',
        '---',
        `Generated by Shadow (trust L${db.ensureProfile().trustLevel})`,
      ].join('\n');

      const { execSync: exec } = await import('node:child_process');
      try {
        // Push branch to remote
        exec(`git push -u origin ${branchName}`, { cwd: repo.path, stdio: 'pipe', timeout: 30_000 });

        // Create draft PR via gh CLI
        const prOutput = exec(
          `gh pr create --draft --title ${JSON.stringify(title)} --body ${JSON.stringify(body)} --head ${branchName} --base ${repo.defaultBranch}`,
          { cwd: repo.path, stdio: 'pipe', timeout: 30_000, encoding: 'utf-8' },
        ).toString().trim();

        // gh pr create returns the PR URL
        const prUrl = prOutput.split('\n').pop()?.trim() ?? prOutput;
        db.updateRun(runId, { prUrl });

        db.createAuditEvent({
          interface: 'web',
          action: 'create-draft-pr',
          targetKind: 'run',
          targetId: runId,
          detail: { prUrl, branchName },
        });

        return json(res, { ok: true, prUrl });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return json(res, { error: `Failed to create draft PR: ${msg}` }, 500);
      }
    }

    if (pathname === '/api/profile') {
      let body: Record<string, unknown>;
      try { body = JSON.parse(await readBody(req)); } catch { return json(res, { error: 'Invalid JSON body' }, 400); }
      const parsed = ProfileUpdateSchema.safeParse(body);
      if (!parsed.success) {
        return json(res, { error: 'Validation failed', issues: parsed.error.issues }, 400);
      }
      const updates: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(parsed.data)) {
        updates[key] = value;
      }
      // Merge preferences instead of overwriting
      if (updates.preferences && typeof updates.preferences === 'object') {
        const current = db.ensureProfile();
        const merged = { ...(current.preferences as Record<string, unknown>), ...(updates.preferences as Record<string, unknown>) };
        updates.preferencesJson = merged;
        delete updates.preferences;
      }
      db.updateProfile('default', updates);
      const updated = db.ensureProfile();
      return json(res, updated);
    }

    if (pathname === '/api/focus') {
      let body: Record<string, unknown>;
      try { body = JSON.parse(await readBody(req)); } catch { return json(res, { error: 'Invalid JSON body' }, 400); }
      if (body.mode === 'focus') {
        let focusUntil: string | null = null;
        if (body.duration) {
          const durMatch = String(body.duration).match(/^(\d+)\s*(h|m)$/i);
          if (durMatch) {
            const ms = durMatch[2].toLowerCase() === 'h' ? Number(durMatch[1]) * 3600000 : Number(durMatch[1]) * 60000;
            focusUntil = new Date(Date.now() + ms).toISOString();
          }
        }
        db.updateProfile('default', { focusMode: 'focus', focusUntil });
      } else {
        db.updateProfile('default', { focusMode: null, focusUntil: null });
      }
      return json(res, db.ensureProfile());
    }

    if (pathname === '/api/feedback') {
      const body = JSON.parse(await readBody(req));
      const { targetKind, targetId, action, note } = body;
      if (!targetKind || !targetId || !action) return json(res, { error: 'Missing targetKind, targetId, or action' }, 400);
      db.createFeedback({ targetKind, targetId, action, note });
      return json(res, { ok: true });
    }

    if (pathname === '/api/heartbeat/trigger') {
      if (db.hasQueuedOrRunning('heartbeat')) {
        return json(res, { error: 'Heartbeat already queued or running' }, 409);
      }
      db.enqueueJob('heartbeat', { priority: 10, triggerSource: 'manual' });
      return json(res, { triggered: true });
    }

    const jobTriggerMatch = pathname.match(/^\/api\/jobs\/trigger\/(.+)$/);
    if (jobTriggerMatch) {
      const type = decodeURIComponent(jobTriggerMatch[1]);
      const VALID_TYPES = new Set(['heartbeat', 'suggest', 'consolidate', 'reflect', 'remote-sync', 'repo-profile', 'context-enrich', 'digest-daily', 'digest-weekly', 'digest-brag']);
      if (!VALID_TYPES.has(type)) {
        return json(res, { error: `Unknown job type: ${type}` }, 400);
      }
      if (db.hasQueuedOrRunning(type)) {
        return json(res, { error: `${type} already queued or running` }, 409);
      }
      const PRIORITIES: Record<string, number> = {
        heartbeat: 10, suggest: 8, reflect: 5, 'digest-daily': 5, 'digest-weekly': 5, 'digest-brag': 5,
        'context-enrich': 4, consolidate: 3, 'repo-profile': 3, 'remote-sync': 2,
      };
      db.enqueueJob(type, { priority: PRIORITIES[type] ?? 5, triggerSource: 'manual' });
      return json(res, { triggered: true, type });
    }

    const digestTriggerMatch = pathname.match(/^\/api\/digest\/(daily|weekly|brag)\/trigger$/);
    if (digestTriggerMatch) {
      const kind = digestTriggerMatch[1];
      const jobType = `digest-${kind}`;
      if (db.hasQueuedOrRunning(jobType)) {
        return json(res, { error: `${kind} digest already queued or running` }, 409);
      }
      const body = await readBody(req).then(b => b ? JSON.parse(b) : {}).catch(() => ({}));
      const params = body.periodStart ? { periodStart: body.periodStart as string } : {};
      db.enqueueJob(jobType, { triggerSource: 'manual', params });
      return json(res, { triggered: true, kind, periodStart: body.periodStart ?? null });
    }

    if (pathname === '/api/corrections') {
      const body = await readBody(req).then(b => b ? JSON.parse(b) : {}).catch(() => ({}));
      const { title, body: correctionBody, scope, entityType, entityId } = body;

      if (!correctionBody || !scope) {
        return json(res, { error: 'Missing body or scope' }, 400);
      }

      const correctionTitle = title || correctionBody.slice(0, 60) + (correctionBody.length > 60 ? '...' : '');

      const memory = db.createMemory({
        layer: 'core',
        scope,
        kind: 'correction',
        title: correctionTitle,
        bodyMd: correctionBody,
        tags: [],
        sourceType: 'api',
        confidenceScore: 100,
        relevanceScore: 1.0,
      });

      // Link entities if provided
      if (entityType && entityId) {
        try {
          const entities = [{ type: entityType, id: entityId }];
          db.rawDb.prepare('UPDATE memories SET entities_json = ? WHERE id = ?')
            .run(JSON.stringify(entities), memory.id);
        } catch { /* best-effort */ }
      }

      // Generate embedding
      try {
        const { generateAndStoreEmbedding } = await import('../memory/lifecycle.js');
        await generateAndStoreEmbedding(db, 'memory', memory.id, { kind: memory.kind, title: memory.title, bodyMd: memory.bodyMd });
      } catch { /* best-effort */ }

      return json(res, { ok: true, correction: memory });
    }
  }

  // --- CORS preflight ---
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return void res.end();
  }

  json(res, { error: 'Not found' }, 404);
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

export async function startWebServer(port: number = 3700, _existingDb?: ShadowDatabase, eventBus?: EventBus): Promise<{ close: () => void }> {
  const config = loadConfig();
  // Always create own DB connection — sharing with daemon causes "database is not open" errors
  const db = createDatabase(config);

  const __dirname = dirname(fileURLToPath(import.meta.url));

  // React dashboard (built by Vite)
  const srcDashboardDir = resolve(__dirname, '..', '..', 'src', 'web', 'dashboard', 'dist');
  const distDashboardDir = resolve(__dirname, 'dashboard', 'dist');
  const dashboardDir = existsSync(srcDashboardDir) ? srcDashboardDir : (existsSync(distDashboardDir) ? distDashboardDir : null);

  // Legacy fallback
  const srcHtmlPath = resolve(__dirname, '..', '..', 'src', 'web', 'public', 'index.html');
  const distHtmlPath = resolve(__dirname, 'public', 'index.html');
  const legacyHtmlPath = existsSync(srcHtmlPath) ? srcHtmlPath : distHtmlPath;

  const server = createServer(async (req, res) => {
    try {
      const { pathname, params } = parseUrl(req);

      // SSE event stream — must be before handleApi (doesn't end the response)
      if (pathname === '/api/events/stream' && eventBus) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
          'X-Accel-Buffering': 'no',
        });
        res.write(`event: connected\ndata: ${JSON.stringify({ ts: new Date().toISOString() })}\n\n`);
        eventBus.addClient(res);
        req.on('close', () => eventBus.removeClient(res));
        return; // Keep connection open
      }

      if (pathname.startsWith('/api/')) {
        await handleApi(req, res, pathname, params, db);
        return;
      }

      // Serve React SPA if built
      if (dashboardDir) {
        const filePath = resolve(dashboardDir, pathname === '/' ? 'index.html' : pathname.slice(1));
        if (existsSync(filePath) && statSync(filePath).isFile()) {
          const ext = extname(filePath);
          const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
          const content = readFileSync(filePath);
          res.writeHead(200, { 'Content-Type': contentType });
          res.end(content);
          return;
        }
        // SPA fallback — serve index.html for client-side routing
        const indexPath = resolve(dashboardDir, 'index.html');
        if (existsSync(indexPath)) {
          html(res, readFileSync(indexPath, 'utf8'));
          return;
        }
      }

      // Legacy dashboard fallback
      const indexHtml = readFileSync(legacyHtmlPath, 'utf8');
      html(res, indexHtml);
    } catch (err) {
      console.error('Shadow web error:', err);
      json(res, { error: 'Internal server error' }, 500);
    }
  });

  return new Promise<{ close: () => void }>((resolve) => {
    server.listen(port, () => {
      console.log(`Shadow dashboard: http://localhost:${port}`);
      resolve({
        close: () => { try { server.close(); db.close(); } catch { /* best-effort */ } },
      });
    });
  });
}
