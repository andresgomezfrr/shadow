import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ShadowDatabase } from '../../storage/database.js';
import type { DaemonSharedState } from '../../daemon/job-handlers.js';
import { json, clampLimit, clampOffset, readBody, parseOptionalBody, DigestTriggerSchema } from '../helpers.js';

export async function handleJobRoutes(
  req: IncomingMessage, res: ServerResponse,
  pathname: string, params: URLSearchParams,
  db: ShadowDatabase,
  _daemonState?: DaemonSharedState,
): Promise<boolean> {

  if (req.method === 'GET') {
    if (pathname === '/api/heartbeats') {
      // Legacy alias — redirect to jobs with type=heartbeat
      const limit = clampLimit(params.get('limit'), 30);
      const jobs = db.listJobs({ type: 'heartbeat', limit });
      return json(res, jobs), true;
    }

    if (pathname === '/api/jobs') {
      const type = params.get('type') ?? undefined;
      const typePrefix = params.get('typePrefix') ?? undefined;
      const limit = clampLimit(params.get('limit'), 30);
      const offset = clampOffset(params.get('offset'));
      const items = db.listJobs({ type, typePrefix, limit, offset });
      const total = db.countJobs({ type, typePrefix });
      return json(res, { items, total }), true;
    }
  }

  if (req.method === 'POST') {
    if (pathname === '/api/heartbeat/trigger') {
      if (db.hasQueuedOrRunning('heartbeat')) {
        return json(res, { error: 'Heartbeat already queued or running' }, 409), true;
      }
      db.enqueueJob('heartbeat', { priority: 10, triggerSource: 'manual' });
      return json(res, { triggered: true }), true;
    }

    const jobTriggerMatch = pathname.match(/^\/api\/jobs\/trigger\/(.+)$/);
    if (jobTriggerMatch) {
      const type = decodeURIComponent(jobTriggerMatch[1]);
      const VALID_TYPES = new Set(['heartbeat', 'suggest', 'suggest-deep', 'suggest-project', 'consolidate', 'reflect', 'remote-sync', 'repo-profile', 'project-profile', 'context-enrich', 'digest-daily', 'digest-weekly', 'digest-brag']);
      if (!VALID_TYPES.has(type)) {
        return json(res, { error: `Unknown job type: ${type}` }, 400), true;
      }
      if (db.hasQueuedOrRunning(type)) {
        return json(res, { error: `${type} already queued or running` }, 409), true;
      }
      const PRIORITIES: Record<string, number> = {
        heartbeat: 10, suggest: 8, 'suggest-deep': 6, 'suggest-project': 5, reflect: 5, 'digest-daily': 5, 'digest-weekly': 5, 'digest-brag': 5,
        'context-enrich': 4, 'project-profile': 4, consolidate: 3, 'repo-profile': 3, 'remote-sync': 2,
      };
      const body = await readBody(req).then(b => b ? JSON.parse(b) : {}).catch(() => ({}));
      db.enqueueJob(type, { priority: PRIORITIES[type] ?? 5, triggerSource: 'manual', params: Object.keys(body).length > 0 ? body : undefined });
      return json(res, { triggered: true, type }), true;
    }

    const digestTriggerMatch = pathname.match(/^\/api\/digest\/(daily|weekly|brag)\/trigger$/);
    if (digestTriggerMatch) {
      const kind = digestTriggerMatch[1];
      const jobType = `digest-${kind}`;
      if (db.hasQueuedOrRunning(jobType)) {
        return json(res, { error: `${kind} digest already queued or running` }, 409), true;
      }
      const body = await parseOptionalBody(req, DigestTriggerSchema);
      const params = body.periodStart ? { periodStart: body.periodStart } : {};
      db.enqueueJob(jobType, { triggerSource: 'manual', params });
      return json(res, { triggered: true, kind, periodStart: body.periodStart ?? null }), true;
    }
  }

  return false;
}
