import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ShadowDatabase } from '../../storage/database.js';
import type { DaemonSharedState } from '../../daemon/job-handlers.js';
import { json, readBody, parseBody, FocusSchema, FeedbackSchema } from '../helpers.js';
import { ProfileUpdateSchema } from '../../config/schema.js';
import { DIGEST_SCHEDULES, CLEANUP_SCHEDULE, nextScheduledAt } from '../../daemon/schedules.js';
import { loadConfig } from '../../config/load-config.js';
import { loadAutonomyConfig } from '../../autonomy/rules.js';

export async function handleProfileRoutes(
  req: IncomingMessage, res: ServerResponse,
  pathname: string, params: URLSearchParams,
  db: ShadowDatabase,
  daemonState?: DaemonSharedState,
): Promise<boolean> {

  if (req.method === 'GET') {
    if (pathname === '/api/status') {
      const config = loadConfig();
      const nextHeartbeatAt: string | null = daemonState?.nextHeartbeatAt ?? null;
      const profile = db.ensureProfile();
      const memoriesCount = db.countMemories({ archived: false });
      const pendingSuggestions = db.countPendingSuggestions();
      const reposCount = db.countRepos();
      const contactsCount = db.countContacts();
      const systemsCount = db.countSystems();
      const lastHeartbeat = db.getLastJob('heartbeat');
      const usage = db.getUsageSummary('day');
      const activeObservations = db.countObservations({ status: 'open' });
      const runsToReview = db.countRuns({ status: 'planned' });
      const activeTasks = db.countTasks({ status: 'open' }) + db.countTasks({ status: 'active' }) + db.countTasks({ status: 'blocked' });
      return json(res, {
        profile,
        counts: {
          memories: memoriesCount,
          pendingSuggestions,
          activeObservations,
          runsToReview,
          activeTasks,
          repos: reposCount,
          contacts: contactsCount,
          systems: systemsCount,
        },
        usage,
        lastHeartbeat,
        nextHeartbeatAt,
        jobSchedule: {
          heartbeat: { intervalMs: config.heartbeatIntervalMs, nextAt: nextHeartbeatAt },
          suggest: (() => {
            return { trigger: 'reactive post-heartbeat', nextAt: null };
          })(),
          'suggest-deep': (() => {
            const lastSd = db.getLastJob('suggest-deep');
            return { trigger: 'periodic + first-scan', nextAt: null, lastRanAt: lastSd?.startedAt ?? null };
          })(),
          'suggest-project': (() => {
            const lastSp = db.getLastJob('suggest-project');
            return { trigger: 'reactive after deep scan', nextAt: null, lastRanAt: lastSp?.startedAt ?? null };
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
          'project-profile': (() => {
            const lastPp = db.getLastJob('project-profile');
            return { trigger: 'reactive after repo-profile', nextAt: null, lastRanAt: lastPp?.startedAt ?? null };
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
          'mcp-discover': (() => {
            const prefs = profile.preferences as Record<string, unknown> | undefined;
            const enabled = (prefs?.enrichmentEnabled as boolean | undefined) ?? config.enrichmentEnabled;
            const lastDiscover = db.getLastJob('mcp-discover');
            const nextAt = enabled && lastDiscover ? new Date(new Date(lastDiscover.startedAt).getTime() + 24 * 60 * 60 * 1000).toISOString() : null;
            return { intervalMs: 24 * 60 * 60 * 1000, nextAt, enabled };
          })(),
          'auto-plan': (() => {
            const autonomy = loadAutonomyConfig(db);
            const enabled = autonomy.planRules.enabled && autonomy.planRules.repoIds.length > 0;
            const lastAp = db.getLastJob('auto-plan');
            const intervalMs = 3 * 60 * 60 * 1000;
            const nextAt = enabled && lastAp ? new Date(new Date(lastAp.startedAt).getTime() + intervalMs).toISOString() : null;
            return { intervalMs, nextAt, enabled };
          })(),
          'auto-execute': (() => {
            const autonomy = loadAutonomyConfig(db);
            const enabled = autonomy.executeRules.enabled && autonomy.executeRules.repoIds.length > 0;
            const lastAe = db.getLastJob('auto-execute');
            const intervalMs = 3 * 60 * 60 * 1000;
            const nextAt = enabled && lastAe ? new Date(new Date(lastAe.startedAt).getTime() + intervalMs).toISOString() : null;
            return { intervalMs, nextAt, enabled, trigger: 'offset 1.5h from auto-plan' };
          })(),
          ...Object.fromEntries(Object.entries(DIGEST_SCHEDULES).map(([type, sched]) => {
            const tz = db.ensureProfile().timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
            return [type, { schedule: sched.label, nextAt: nextScheduledAt(sched, tz) }];
          })),
          cleanup: (() => {
            const tz = db.ensureProfile().timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
            return { schedule: CLEANUP_SCHEDULE.label, nextAt: nextScheduledAt(CLEANUP_SCHEDULE, tz) };
          })(),
        },
        recentActivity: (() => {
          try {
            const interactionsPath = resolve(config.resolvedDataDir, 'interactions.jsonl');
            const lines = readFileSync(interactionsPath, 'utf8').trim().split('\n').filter(Boolean);
            const fiveMinAgo = Date.now() - 5 * 60 * 1000;
            return lines.filter(line => {
              try { return new Date((JSON.parse(line) as { ts: string }).ts).getTime() > fiveMinAgo; }
              catch { return false; }
            }).length;
          } catch { return 0; }
        })(),
      }), true;
    }

    if (pathname === '/api/config') {
      const cfg = loadConfig();
      // Expose runtime config without sensitive paths
      const { resolvedDataDir, resolvedDatabasePath, resolvedArtifactsDir, claudeBin, claudeExtraPath, ...safe } = cfg;
      return json(res, { config: safe }), true;
    }

    if (pathname === '/api/usage') {
      const period = (params.get('period') ?? 'week') as 'day' | 'week' | 'month';
      const usage = db.getUsageSummary(period);
      return json(res, usage), true;
    }

    if (pathname === '/api/events') {
      const events = db.listPendingEvents();
      return json(res, events), true;
    }

    if (pathname === '/api/notifications') {
      const events = db.listUnreadEvents();
      return json(res, events), true;
    }

    if (pathname === '/api/feedback-state') {
      const targetKind = params.get('targetKind');
      if (!targetKind) return json(res, { error: 'Missing targetKind' }, 400), true;
      return json(res, db.getThumbsState(targetKind)), true;
    }
  }

  if (req.method === 'POST') {
    // Mark notifications as read
    if (pathname === '/api/notifications/read-all') {
      const count = db.markAllEventsRead();
      return json(res, { ok: true, read: count }), true;
    }
    if (pathname === '/api/notifications/read') {
      let body: { ids?: string[] };
      try { body = JSON.parse(await readBody(req)); } catch { return json(res, { error: 'Invalid JSON' }, 400), true; }
      if (Array.isArray(body.ids)) {
        for (const id of body.ids) db.markEventRead(id);
      }
      return json(res, { ok: true, read: body.ids?.length ?? 0 }), true;
    }

    if (pathname === '/api/profile') {
      let body: Record<string, unknown>;
      try { body = JSON.parse(await readBody(req)); } catch { return json(res, { error: 'Invalid JSON body' }, 400), true; }
      const parsed = ProfileUpdateSchema.safeParse(body);
      if (!parsed.success) {
        return json(res, { error: 'Validation failed', issues: parsed.error.issues }, 400), true;
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
      return json(res, updated), true;
    }

    if (pathname === '/api/focus') {
      const body = await parseBody(req, res, FocusSchema);
      if (!body) return true;
      if (body.mode === 'focus') {
        let focusUntil: string | null = null;
        if (body.duration) {
          const durMatch = body.duration.match(/^(\d+)\s*(h|m)$/i);
          if (durMatch) {
            const ms = durMatch[2].toLowerCase() === 'h' ? Number(durMatch[1]) * 3600000 : Number(durMatch[1]) * 60000;
            focusUntil = new Date(Date.now() + ms).toISOString();
          }
        }
        db.updateProfile('default', { focusMode: 'focus', focusUntil });
      } else {
        db.updateProfile('default', { focusMode: null, focusUntil: null });
      }
      return json(res, db.ensureProfile()), true;
    }

    if (pathname === '/api/feedback') {
      const body = await parseBody(req, res, FeedbackSchema);
      if (!body) return true;
      db.createFeedback({ targetKind: body.targetKind, targetId: body.targetId, action: body.action, note: body.note });
      return json(res, { ok: true }), true;
    }
  }

  return false;
}
