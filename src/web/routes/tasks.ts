import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import type { ShadowDatabase } from '../../storage/database.js';
import { json, clampLimit, clampOffset, parseBody } from '../helpers.js';

const ExternalRefSchema = z.object({
  source: z.string(),
  key: z.string(),
  url: z.string(),
});

const TaskCreateBodySchema = z.object({
  title: z.string().min(1),
  status: z.enum(['open', 'active', 'blocked']).optional(),
  suggestionId: z.string().optional(),
  contextMd: z.string().optional(),
  externalRefs: z.array(ExternalRefSchema).optional(),
  repoIds: z.array(z.string()).optional(),
  projectId: z.string().optional(),
  sessionId: z.string().optional(),
  sessionRepoPath: z.string().optional(),
});

const TaskUpdateBodySchema = z.object({
  title: z.string().optional(),
  status: z.enum(['open', 'active', 'blocked', 'done']).optional(),
  contextMd: z.string().optional(),
  externalRefs: z.array(ExternalRefSchema).optional(),
  repoIds: z.array(z.string()).optional(),
  projectId: z.string().nullable().optional(),
  sessionId: z.string().nullable().optional(),
  sessionRepoPath: z.string().nullable().optional(),
  prUrls: z.array(z.string()).optional(),
  archived: z.boolean().optional(),
});

export async function handleTaskRoutes(
  req: IncomingMessage, res: ServerResponse,
  pathname: string, params: URLSearchParams,
  db: ShadowDatabase,
): Promise<boolean> {

  // GET /api/tasks — list
  if (req.method === 'GET' && pathname === '/api/tasks') {
    const status = params.get('status') ?? undefined;
    const repoId = params.get('repoId') ?? undefined;
    const projectId = params.get('projectId') ?? undefined;
    const limit = clampLimit(params.get('limit'), 50);
    const offset = clampOffset(params.get('offset'));
    const items = db.listTasks({ status, repoId, projectId, limit, offset });
    const total = db.countTasks({ status, repoId, projectId });
    return json(res, { items, total }), true;
  }

  // GET /api/tasks/:id — detail with related entities
  const detailMatch = pathname.match(/^\/api\/tasks\/([^/]+)$/);
  if (req.method === 'GET' && detailMatch) {
    const task = db.getTask(detailMatch[1]);
    if (!task) return json(res, { error: 'Not found' }, 404), true;

    // Related items: observations, suggestions, runs for the task's repos,
    // created after the task. Batch via `repoIds: [...]` filter (WHERE
    // repo_id IN (...)) instead of looping per-repo — audit W-11.
    const repoIds = task.repoIds;
    const observations = repoIds.length > 0
      ? db.listObservations({ repoIds, limit: 20 * repoIds.length })
        .filter(o => o.createdAt >= task.createdAt)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 10)
      : [];
    const suggestions = repoIds.length > 0
      ? db.listSuggestions({ repoIds, limit: 20 * repoIds.length })
        .filter(s => s.createdAt >= task.createdAt)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 10)
      : [];
    const runs = repoIds.length > 0
      ? db.listRuns({ repoIds, limit: 10 * repoIds.length })
        .filter(r => r.createdAt >= task.createdAt)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 10)
      : [];

    return json(res, { task, observations, suggestions, runs }), true;
  }

  if (req.method !== 'POST' && req.method !== 'DELETE') return false;

  // POST /api/tasks — create
  if (req.method === 'POST' && pathname === '/api/tasks') {
    const body = await parseBody(req, res, TaskCreateBodySchema);
    if (!body) return true;
    const task = db.createTask(body);
    return json(res, task, 201), true;
  }

  // POST /api/tasks/:id/update
  const updateMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/update$/);
  if (req.method === 'POST' && updateMatch) {
    const task = db.getTask(updateMatch[1]);
    if (!task) return json(res, { error: 'Not found' }, 404), true;
    const body = await parseBody(req, res, TaskUpdateBodySchema);
    if (!body) return true;
    const updates: Record<string, unknown> = { ...body };
    if (updates.status === 'done' && !task.closedAt) updates.closedAt = new Date().toISOString();
    if (updates.status && updates.status !== 'done') updates.closedAt = null;
    db.updateTask(task.id, updates as Parameters<typeof db.updateTask>[1]);
    return json(res, db.getTask(task.id)), true;
  }

  // POST /api/tasks/:id/close
  const closeMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/close$/);
  if (req.method === 'POST' && closeMatch) {
    const task = db.getTask(closeMatch[1]);
    if (!task) return json(res, { error: 'Not found' }, 404), true;
    db.updateTask(task.id, { status: 'done', closedAt: new Date().toISOString() });
    return json(res, db.getTask(task.id)), true;
  }

  // POST /api/tasks/:id/archive
  const archiveMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/archive$/);
  if (req.method === 'POST' && archiveMatch) {
    const task = db.getTask(archiveMatch[1]);
    if (!task) return json(res, { error: 'Not found' }, 404), true;
    db.updateTask(task.id, { archived: true });
    return json(res, { ok: true }), true;
  }

  // DELETE /api/tasks/:id
  const deleteMatch = pathname.match(/^\/api\/tasks\/([^/]+)$/);
  if (req.method === 'DELETE' && deleteMatch) {
    const task = db.getTask(deleteMatch[1]);
    if (!task) return json(res, { error: 'Not found' }, 404), true;
    db.deleteTask(task.id);
    return json(res, { ok: true }), true;
  }

  return false;
}
