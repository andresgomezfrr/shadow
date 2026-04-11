import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ShadowDatabase } from '../../storage/database.js';
import { json, readBody, clampLimit, clampOffset } from '../helpers.js';

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

    // Related items: observations, suggestions, runs for the task's repos, created after the task
    const repoIds = task.repoIds;
    const observations = repoIds.length > 0
      ? repoIds.flatMap(rid => db.listObservations({ repoId: rid, limit: 20 }))
        .filter(o => o.createdAt >= task.createdAt)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 10)
      : [];
    const suggestions = repoIds.length > 0
      ? repoIds.flatMap(rid => db.listSuggestions({ repoId: rid, limit: 20 }))
        .filter(s => s.createdAt >= task.createdAt)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 10)
      : [];
    const runs = repoIds.length > 0
      ? repoIds.flatMap(rid => db.listRuns({ repoId: rid, limit: 10 }))
        .filter(r => r.createdAt >= task.createdAt)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 10)
      : [];

    return json(res, { task, observations, suggestions, runs }), true;
  }

  if (req.method !== 'POST' && req.method !== 'DELETE') return false;

  // POST /api/tasks — create
  if (req.method === 'POST' && pathname === '/api/tasks') {
    let body: Record<string, unknown>;
    try { body = JSON.parse(await readBody(req)); } catch { return json(res, { error: 'Invalid JSON' }, 400), true; }
    if (!body.title || typeof body.title !== 'string') return json(res, { error: 'title required' }, 400), true;
    const task = db.createTask({
      title: body.title,
      status: body.status as string | undefined,
      contextMd: body.contextMd as string | undefined,
      externalRefs: body.externalRefs as { source: string; key: string; url: string }[] | undefined,
      repoIds: body.repoIds as string[] | undefined,
      projectId: body.projectId as string | undefined,
      sessionId: body.sessionId as string | undefined,
      sessionRepoPath: body.sessionRepoPath as string | undefined,
    });
    return json(res, task, 201), true;
  }

  // POST /api/tasks/:id/update
  const updateMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/update$/);
  if (req.method === 'POST' && updateMatch) {
    const task = db.getTask(updateMatch[1]);
    if (!task) return json(res, { error: 'Not found' }, 404), true;
    let body: Record<string, unknown>;
    try { body = JSON.parse(await readBody(req)); } catch { return json(res, { error: 'Invalid JSON' }, 400), true; }
    const updates: Record<string, unknown> = {};
    for (const key of ['title', 'status', 'contextMd', 'externalRefs', 'repoIds', 'projectId', 'sessionId', 'sessionRepoPath', 'prUrls']) {
      if (body[key] !== undefined) updates[key] = body[key];
    }
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
