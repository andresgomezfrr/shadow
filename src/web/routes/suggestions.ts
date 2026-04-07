import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ShadowDatabase } from '../../storage/database.js';
import type { DaemonSharedState } from '../../daemon/job-handlers.js';
import { json, clampLimit, clampOffset, parseBody, parseOptionalBody, BulkSuggestionSchema, OptionalCategorySchema, DismissCategorySchema, SnoozeSchema } from '../helpers.js';

export async function handleSuggestionRoutes(
  req: IncomingMessage, res: ServerResponse,
  pathname: string, params: URLSearchParams,
  db: ShadowDatabase,
  _daemonState?: DaemonSharedState,
): Promise<boolean> {

  if (req.method === 'GET') {
    if (pathname === '/api/suggestions') {
      const status = params.get('status') ?? undefined;
      const kind = params.get('kind') ?? undefined;
      const limit = clampLimit(params.get('limit'), 30);
      const offset = clampOffset(params.get('offset'));
      let items = db.listSuggestions({ status, kind, limit, offset });
      // Sort pending suggestions by rank score (best first)
      if (status === 'pending' && items.length > 0) {
        const profile = db.ensureProfile();
        const { computeRankScore } = await import('../../suggestion/ranking.js');
        const { computeProjectMomentum } = await import('../../analysis/project-detection.js');
        const projects = db.listProjects();
        const projectMomentum = new Map(projects.map(p => [p.id, computeProjectMomentum(db, p.id, 7)]));
        items.sort((a, b) => computeRankScore(b, profile, { projectMomentum }) - computeRankScore(a, profile, { projectMomentum }));
      }
      const total = db.countSuggestions({ status, kind });
      const fbState = db.getThumbsState('suggestion');
      return json(res, { items, total, feedbackState: fbState }), true;
    }
  }

  if (req.method === 'POST') {
    // Bulk suggestion actions
    if (pathname === '/api/suggestions/bulk') {
      const body = await parseBody(req, res, BulkSuggestionSchema);
      if (!body) return true;
      let processed = 0;
      if (body.action === 'dismiss') {
        const { dismissSuggestion } = await import('../../suggestion/engine.js');
        for (const id of body.ids) {
          const result = await dismissSuggestion(db, id, body.note, body.category);
          if (result.ok) processed++;
        }
      } else if (body.action === 'accept') {
        const { acceptSuggestion } = await import('../../suggestion/engine.js');
        for (const id of body.ids) {
          const result = acceptSuggestion(db, id, body.category);
          if (result.ok) processed++;
        }
      } else if (body.action === 'snooze') {
        const { snoozeSuggestion } = await import('../../suggestion/engine.js');
        const until = new Date(Date.now() + (body.hours ?? 72) * 3600000).toISOString();
        for (const id of body.ids) {
          const result = snoozeSuggestion(db, id, until);
          if (result.ok) processed++;
        }
      }
      return json(res, { processed, total: body.ids.length }), true;
    }

    const match = pathname.match(/^\/api\/suggestions\/([^/]+)\/(accept|dismiss|snooze)$/);
    if (match) {
      const [, id, action] = match;
      if (action === 'accept') {
        const { acceptSuggestion } = await import('../../suggestion/engine.js');
        const body = await parseOptionalBody(req, OptionalCategorySchema);
        const result = acceptSuggestion(db, id, body.category);
        if (!result.ok) return json(res, { error: 'Cannot accept — suggestion not pending' }, 400), true;
        const updated = db.getSuggestion(id);
        return json(res, { ...updated, runId: result.runCreated }), true;
      } else if (action === 'dismiss') {
        const { dismissSuggestion } = await import('../../suggestion/engine.js');
        const body = await parseOptionalBody(req, DismissCategorySchema);
        await dismissSuggestion(db, id, body.note, body.category);
        const updated = db.getSuggestion(id);
        return json(res, updated), true;
      } else if (action === 'snooze') {
        const body = await parseOptionalBody(req, SnoozeSchema);
        if (body.hours === 0) {
          // Unsnooze: wake immediately
          db.updateSuggestion(id, { status: 'pending', expiresAt: null });
          const updated = db.getSuggestion(id);
          return json(res, updated), true;
        }
        const { snoozeSuggestion } = await import('../../suggestion/engine.js');
        const until = new Date(Date.now() + body.hours * 60 * 60 * 1000).toISOString();
        const result = snoozeSuggestion(db, id, until);
        if (!result.ok) return json(res, { error: 'Cannot snooze — suggestion not pending' }, 400), true;
        const updated = db.getSuggestion(id);
        return json(res, updated), true;
      }
    }
  }

  return false;
}
