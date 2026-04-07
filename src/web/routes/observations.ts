import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ShadowDatabase } from '../../storage/database.js';
import type { DaemonSharedState } from '../../daemon/job-handlers.js';
import { json, clampLimit, clampOffset, parseOptionalBody, OptionalNoteSchema } from '../helpers.js';

export async function handleObservationRoutes(
  req: IncomingMessage, res: ServerResponse,
  pathname: string, params: URLSearchParams,
  db: ShadowDatabase,
  _daemonState?: DaemonSharedState,
): Promise<boolean> {

  if (req.method === 'GET') {
    if (pathname === '/api/observations') {
      const limit = clampLimit(params.get('limit'), 20);
      const offset = clampOffset(params.get('offset'));
      const status = params.get('status') ?? 'all';
      const repoId = params.get('repoId') ?? undefined;
      const severity = params.get('severity') ?? undefined;
      const items = db.listObservations({ limit, offset, status, repoId, severity });
      const total = db.countObservations({ repoId, status, severity });
      const fbState = db.getThumbsState('observation');
      return json(res, { items, total, feedbackState: fbState }), true;
    }
  }

  if (req.method === 'POST') {
    const obsMatch = pathname.match(/^\/api\/observations\/([^/]+)\/(acknowledge|resolve|reopen)$/);
    if (obsMatch) {
      const [, obsId, action] = obsMatch;
      const obs = db.getObservation(obsId);
      if (!obs) return json(res, { error: 'Not found' }, 404), true;
      const statusMap: Record<string, string> = { acknowledge: 'acknowledged', resolve: 'resolved', reopen: 'active' };
      db.updateObservationStatus(obsId, statusMap[action]);
      const obsBody = await parseOptionalBody(req, OptionalNoteSchema);
      if (action !== 'reopen') db.createFeedback({ targetKind: 'observation', targetId: obsId, action, note: obsBody.note });
      return json(res, db.getObservation(obsId)), true;
    }
  }

  return false;
}
