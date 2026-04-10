import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ShadowDatabase } from '../../storage/database.js';
import type { DaemonSharedState } from '../../daemon/job-handlers.js';
import { json, clampLimit, clampOffset } from '../helpers.js';

type ChainInfo = {
  observationId?: string;
  observationTitle?: string;
  suggestionId?: string;
  suggestionTitle?: string;
};

type FeedItem = {
  source: 'run' | 'suggestion' | 'observation' | 'task';
  id: string;
  priority: number;
  data: unknown;
  chain?: ChainInfo;
};

/**
 * Priority order for the unified feed:
 * 1. Runs with status=completed (need decision NOW)
 * 2. Observations severity=high, status=active
 * 3. Suggestions status=pending (by score desc)
 * 4. Observations severity=warning, status=active
 * 5. Suggestions status=backlog
 * 6. Observations severity=info, status=active
 */
function assignPriority(item: FeedItem): number {
  if (item.source === 'run') {
    const r = item.data as { status?: string };
    if (r.status === 'running') return 110;
    if (r.status === 'queued') return 105;
    if (r.status === 'failed') return 102;
    return 100;
  }
  if (item.source === 'task') {
    const t = item.data as { status?: string };
    if (t.status === 'in_progress') return 85;
    if (t.status === 'blocked') return 82;
    return 55; // todo
  }
  if (item.source === 'observation') {
    const obs = item.data as { severity?: string };
    if (obs.severity === 'high') return 90;
    if (obs.severity === 'warning') return 60;
    return 40;
  }
  if (item.source === 'suggestion') {
    const sug = item.data as { status?: string };
    if (sug.status === 'pending') return 70;
    if (sug.status === 'backlog') return 50;
    return 30;
  }
  return 0;
}

export async function handleWorkspaceRoutes(
  req: IncomingMessage, res: ServerResponse,
  pathname: string, params: URLSearchParams,
  db: ShadowDatabase,
  _daemonState?: DaemonSharedState,
): Promise<boolean> {

  if (req.method === 'GET' && pathname === '/api/workspace/feed') {
    const type = params.get('type') ?? 'all';
    const projectId = params.get('projectId') ?? undefined;
    const limit = clampLimit(params.get('limit'), 20);
    const offset = clampOffset(params.get('offset'));

    const items: FeedItem[] = [];

    // Which statuses to include
    const includeRuns = type === 'all' || type === 'run';
    const includeActiveTasks = type === 'all' || type === 'task';
    const includeTaskTodo = type === 'task-todo';
    const includeTaskInProgress = type === 'task-in-progress';
    const includeTaskBlocked = type === 'task-blocked';
    const includeTaskClosed = type === 'task-closed';
    const includePending = type === 'all' || type === 'suggestion';
    const includeBacklog = type === 'backlog';
    const includeSnoozed = type === 'snoozed';
    const includeActiveObs = type === 'all' || type === 'observation';
    const includeAckedObs = type === 'acknowledged';

    // Runs: active (running/queued) + to review (completed/failed), not archived, top-level only
    if (includeRuns) {
      for (const status of ['running', 'queued', 'completed', 'failed'] as const) {
        const runs = db.listRuns({ status, archived: false, limit: 50 });
        for (const r of runs) {
          if (r.parentRunId) continue; // skip children
          if (projectId) {
            const projects = db.findProjectsForRepo(r.repoId);
            if (!projects.some(p => p.id === projectId)) continue;
          }
          items.push({ source: 'run', id: r.id, priority: 0, data: r });
        }
      }
    }

    // Tasks by status
    if (includeActiveTasks) {
      for (const t of db.listTasks({ projectId, limit: 50 })) {
        if (t.status !== 'closed') items.push({ source: 'task', id: t.id, priority: 0, data: t });
      }
    }
    if (includeTaskTodo) {
      for (const t of db.listTasks({ status: 'todo', projectId, limit: 50 })) {
        items.push({ source: 'task', id: t.id, priority: 0, data: t });
      }
    }
    if (includeTaskInProgress) {
      for (const t of db.listTasks({ status: 'in_progress', projectId, limit: 50 })) {
        items.push({ source: 'task', id: t.id, priority: 0, data: t });
      }
    }
    if (includeTaskBlocked) {
      for (const t of db.listTasks({ status: 'blocked', projectId, limit: 50 })) {
        items.push({ source: 'task', id: t.id, priority: 0, data: t });
      }
    }
    if (includeTaskClosed) {
      for (const t of db.listTasks({ status: 'closed', projectId, limit: 50 })) {
        items.push({ source: 'task', id: t.id, priority: 0, data: t });
      }
    }

    // Suggestions by status
    if (includePending) {
      for (const s of db.listSuggestions({ status: 'pending', projectId, limit: 50 })) {
        items.push({ source: 'suggestion', id: s.id, priority: 0, data: s });
      }
    }
    if (includeBacklog) {
      for (const s of db.listSuggestions({ status: 'backlog', projectId, limit: 50 })) {
        items.push({ source: 'suggestion', id: s.id, priority: 0, data: s });
      }
    }
    if (includeSnoozed) {
      for (const s of db.listSuggestions({ status: 'snoozed', projectId, limit: 50 })) {
        items.push({ source: 'suggestion', id: s.id, priority: 0, data: s });
      }
    }

    // Observations by status
    if (includeActiveObs) {
      for (const o of db.listObservations({ status: 'active', projectId, limit: 50 })) {
        items.push({ source: 'observation', id: o.id, priority: 0, data: o });
      }
    }
    if (includeAckedObs) {
      for (const o of db.listObservations({ status: 'acknowledged', projectId, limit: 50 })) {
        items.push({ source: 'observation', id: o.id, priority: 0, data: o });
      }
    }

    // Assign priorities and sort
    for (const item of items) item.priority = assignPriority(item);
    items.sort((a, b) => b.priority - a.priority);

    // Counts — always computed for all statuses so tabs show accurate numbers
    const countRuns = (['running', 'queued', 'completed', 'failed'] as const)
      .flatMap(s => db.listRuns({ status: s, archived: false, limit: 50 }))
      .filter(r => !r.parentRunId).length;
    const countTasksTodo = db.countTasks({ status: 'todo', projectId });
    const countTasksInProgress = db.countTasks({ status: 'in_progress', projectId });
    const countTasksBlocked = db.countTasks({ status: 'blocked', projectId });
    const countTasksClosed = db.countTasks({ status: 'closed', projectId });
    const countPending = db.countSuggestions({ status: 'pending', projectId });
    const countBacklog = db.countSuggestions({ status: 'backlog', projectId });
    const countSnoozed = db.countSuggestions({ status: 'snoozed', projectId });
    const countActive = db.countObservations({ status: 'active', projectId });
    const countAcked = db.countObservations({ status: 'acknowledged', projectId });

    const counts = {
      runs: countRuns,
      tasks: countTasksTodo + countTasksInProgress + countTasksBlocked,
      tasksTodo: countTasksTodo,
      tasksInProgress: countTasksInProgress,
      tasksBlocked: countTasksBlocked,
      tasksClosed: countTasksClosed,
      suggestions: countPending,
      observations: countActive,
      backlog: countBacklog,
      snoozed: countSnoozed,
      acknowledged: countAcked,
    };

    const total = items.length;
    const paged = items.slice(offset, offset + limit);

    // Enrich paged items with chain info (batch lookups)
    const suggestionIds = new Set<string>();
    const observationIds = new Set<string>();

    for (const item of paged) {
      if (item.source === 'run') {
        const r = item.data as { suggestionId?: string | null };
        if (r.suggestionId) suggestionIds.add(r.suggestionId);
      }
      if (item.source === 'suggestion') {
        const s = item.data as { sourceObservationId?: string | null };
        if (s.sourceObservationId) observationIds.add(s.sourceObservationId);
      }
    }

    // Fetch suggestions referenced by runs
    const sugCache = new Map<string, { id: string; title: string; sourceObservationId: string | null }>();
    for (const sid of suggestionIds) {
      const s = db.getSuggestion(sid);
      if (s) {
        sugCache.set(sid, { id: s.id, title: s.title, sourceObservationId: s.sourceObservationId });
        if (s.sourceObservationId) observationIds.add(s.sourceObservationId);
      }
    }

    // Fetch observations referenced by suggestions (and transitively by runs)
    const obsCache = new Map<string, { id: string; title: string }>();
    for (const oid of observationIds) {
      const o = db.getObservation(oid);
      if (o) obsCache.set(oid, { id: o.id, title: o.title });
    }

    // Attach chain to each item
    for (const item of paged) {
      if (item.source === 'run') {
        const r = item.data as { suggestionId?: string | null };
        if (r.suggestionId) {
          const sug = sugCache.get(r.suggestionId);
          if (sug) {
            const obs = sug.sourceObservationId ? obsCache.get(sug.sourceObservationId) : undefined;
            item.chain = {
              suggestionId: sug.id, suggestionTitle: sug.title,
              ...(obs ? { observationId: obs.id, observationTitle: obs.title } : {}),
            };
          }
        }
      }
      if (item.source === 'suggestion') {
        const s = item.data as { sourceObservationId?: string | null };
        if (s.sourceObservationId) {
          const obs = obsCache.get(s.sourceObservationId);
          if (obs) item.chain = { observationId: obs.id, observationTitle: obs.title };
        }
      }
    }

    return json(res, { items: paged, total, counts }), true;
  }

  return false;
}
