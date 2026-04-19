import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ShadowDatabase } from '../../storage/database.js';
import type { DaemonSharedState } from '../../daemon/job-handlers.js';
import { json, clampLimit, clampOffset, parseOptionalBody, DigestTriggerSchema, JobTriggerParamsSchema } from '../helpers.js';
import { JOB_TYPES, JOB_TYPE_NAMES } from '../../daemon/job-types.js';

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

    if (pathname === '/api/jobs/running') {
      const rows = db.rawDb.prepare("SELECT DISTINCT type FROM jobs WHERE status IN ('queued', 'running')").all() as Array<{ type: string }>;
      return json(res, { types: rows.map(r => r.type) }), true;
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
      if (!JOB_TYPE_NAMES.includes(type)) {
        return json(res, { error: `Unknown job type: ${type}` }, 400), true;
      }
      const priority = JOB_TYPES[type]?.priority ?? 5;
      const body = await parseOptionalBody(req, res, JobTriggerParamsSchema);
      if (!body) return true;

      // Params-aware dedup for parametric job types
      const PARAM_KEYS: Record<string, string> = {
        'suggest-deep': 'repoId', 'suggest-project': 'projectId', 'repo-profile': 'repoId',
        'project-profile': 'projectId', 'revalidate-suggestion': 'suggestionId',
      };
      const paramKey = PARAM_KEYS[type];
      const paramValue = paramKey ? (body as Record<string, unknown>)[paramKey] as string : undefined;
      if (paramKey && paramValue) {
        if (db.hasQueuedOrRunningWithParams(type, paramKey, paramValue)) {
          return json(res, { error: `${type} already queued or running for ${paramKey}=${paramValue}` }, 409), true;
        }
      } else {
        if (db.hasQueuedOrRunning(type)) {
          return json(res, { error: `${type} already queued or running` }, 409), true;
        }
      }

      db.enqueueJob(type, { priority, triggerSource: 'manual', params: Object.keys(body).length > 0 ? body : undefined });
      return json(res, { triggered: true, type }), true;
    }

    const digestTriggerMatch = pathname.match(/^\/api\/digest\/(daily|weekly|brag)\/trigger$/);
    if (digestTriggerMatch) {
      const kind = digestTriggerMatch[1];
      const jobType = `digest-${kind}`;
      const body = await parseOptionalBody(req, res, DigestTriggerSchema);
      if (!body) return true;
      const params = body.periodStart ? { periodStart: body.periodStart } : {};
      if (body.periodStart) {
        if (db.hasQueuedOrRunningWithParams(jobType, 'periodStart', body.periodStart)) {
          return json(res, { error: `${kind} digest for ${body.periodStart} already queued or running` }, 409), true;
        }
      } else {
        if (db.hasQueuedOrRunning(jobType)) {
          return json(res, { error: `${kind} digest already queued or running` }, 409), true;
        }
      }
      db.enqueueJob(jobType, { triggerSource: 'manual', params });
      return json(res, { triggered: true, kind, periodStart: body.periodStart ?? null }), true;
    }
  }

  return false;
}
