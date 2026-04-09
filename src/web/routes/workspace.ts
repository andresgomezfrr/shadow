import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ShadowDatabase } from '../../storage/database.js';
import type { DaemonSharedState } from '../../daemon/job-handlers.js';
import { json, clampLimit, clampOffset } from '../helpers.js';

type FeedItem = {
  source: 'run' | 'suggestion' | 'observation';
  id: string;
  priority: number;
  data: unknown;
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
  if (item.source === 'run') return 100;
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

    // Runs: only "to review" (completed, not archived, top-level only)
    if (type === 'all' || type === 'run') {
      const runs = db.listRuns({ status: 'completed', archived: false, limit: 50 });
      for (const r of runs) {
        if (r.parentRunId) continue; // skip children
        if (projectId) {
          // Filter by project: check if run's repo is in project's repos
          const projects = db.findProjectsForRepo(r.repoId);
          if (!projects.some(p => p.id === projectId)) continue;
        }
        items.push({ source: 'run', id: r.id, priority: 0, data: r });
      }
    }

    // Suggestions: pending + backlog
    if (type === 'all' || type === 'suggestion') {
      const pending = db.listSuggestions({ status: 'pending', projectId, limit: 50 });
      const backlog = db.listSuggestions({ status: 'backlog', projectId, limit: 20 });
      for (const s of [...pending, ...backlog]) {
        items.push({ source: 'suggestion', id: s.id, priority: 0, data: s });
      }
    }

    // Observations: active only
    if (type === 'all' || type === 'observation') {
      const obs = db.listObservations({ status: 'active', projectId, limit: 50 });
      for (const o of obs) {
        items.push({ source: 'observation', id: o.id, priority: 0, data: o });
      }
    }

    // Assign priorities and sort
    for (const item of items) item.priority = assignPriority(item);
    items.sort((a, b) => b.priority - a.priority);

    // Counts (before pagination)
    const counts = {
      runs: items.filter(i => i.source === 'run').length,
      suggestions: items.filter(i => i.source === 'suggestion').length,
      observations: items.filter(i => i.source === 'observation').length,
    };

    const total = items.length;
    const paged = items.slice(offset, offset + limit);

    return json(res, { items: paged, total, counts }), true;
  }

  return false;
}
