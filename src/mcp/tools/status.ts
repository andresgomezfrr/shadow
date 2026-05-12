import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { mcpSchema, ok, err, type McpTool, type ToolContext } from './types.js';
import { applyBondDelta } from '../../profile/bond.js';
import { getDaemonState } from '../../daemon/runtime.js';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const CheckInSchema = z.object({
  repoPath: z.string().describe('Current working directory / repo path — used to filter observations and suggestions to the relevant context').optional(),
});

const StatusSchema = z.object({});

const AlertAckSchema = z.object({
  id: z.string().describe('Alert ID to acknowledge (e.g. "backend_unhealthy")'),
});

const AlertResolveSchema = z.object({
  id: z.string().describe('Alert ID to resolve/dismiss manually'),
});

const AvailableSchema = z.object({});

// ---------------------------------------------------------------------------
// buildCheckInData — pure function (no side effects)
//
// Composes the snapshot returned by `shadow_check_in` MCP tool. Extracted so
// the CLI command `shadow context` can reuse the exact same logic without
// going through the MCP envelope or applying the `check_in` bond delta.
// ---------------------------------------------------------------------------

import type { ShadowDatabase } from '../../storage/database.js';
import type { ShadowConfig } from '../../config/load-config.js';
import type { UserProfileRecord } from '../../storage/models.js';

export type CheckInData = {
  displayName: string | null;
  locale: string;
  bondTier: number;
  bondTierName: string;
  bondAxes: UserProfileRecord['bondAxes'];
  bondResetAt: string;
  proactivityLevel: number;
  focusMode: string | null;
  focusUntil: string | null;
  mood: string;
  greeting: string;
  pendingEvents: Array<{ kind: string; priority: number; message: unknown }>;
  pendingSuggestions: number;
  recentObservations: Array<{ kind: string; title: string; repoId: string | null; votes: number; severity: string; createdAt: string }>;
  contextRepo: string | null;
  contextProjects: string[];
  soul: string | null;
  contextEntities?: { repo?: { name: string; id: string }; projects: { name: string; id: string }[]; systems: { name: string; id: string; kind: string }[] };
  contextKnowledge: { title: string; kind: string; snippet: string }[];
  todayTokens: number;
  todayLlmCalls: number;
  updateAvailable: { latest: string; current: string } | null;
  activeAlerts: Array<{ id: string; message: string; severity: string; since: string }>;
};

export async function buildCheckInData(opts: {
  db: ShadowDatabase;
  config: ShadowConfig;
  repoPath?: string;
  deriveMood: () => string;
  deriveGreeting: (profile: UserProfileRecord) => string;
  trustNames: Record<number, string>;
}): Promise<CheckInData> {
  const { db, config, repoPath, deriveMood, deriveGreeting, trustNames } = opts;

  const profile = db.ensureProfile();
  const mood = deriveMood();
  const greeting = deriveGreeting(profile);
  const pendingEvents = db.listPendingEvents();
  const pendingSuggestions = db.countPendingSuggestions();
  const usage = db.getUsageSummary('day');

  let contextRepoId: string | null = null;
  let contextProjectIds: string[] = [];
  if (repoPath) {
    const repo = db.findRepoByPath(repoPath);
    if (repo) {
      contextRepoId = repo.id;
      contextProjectIds = db.findProjectsForRepo(repo.id).map(p => p.id);
    }
  }

  let recentObs = db.listObservations({ status: 'open', limit: 10 });
  if (contextRepoId) {
    const repoObs = recentObs.filter(o => o.repoId === contextRepoId || o.repoIds.includes(contextRepoId!));
    recentObs = [...repoObs, ...recentObs.filter(o => !repoObs.includes(o))].slice(0, 5);
  } else {
    recentObs = recentObs.slice(0, 5);
  }

  const allMems = db.listMemories({ archived: false });
  const soulMem = allMems.find(m => m.kind === 'soul_reflection');
  const soul = soulMem?.bodyMd ?? null;

  let contextKnowledge: { title: string; kind: string; snippet: string }[] = [];
  let contextEntities: CheckInData['contextEntities'];

  if (contextRepoId) {
    const repo = db.findRepoByPath(repoPath!);
    const projects = db.findProjectsForRepo(contextRepoId);
    const systemIds = [...new Set(projects.flatMap(p => p.systemIds))];
    const systems = db.getSystemsByIds(systemIds);

    contextEntities = {
      repo: repo ? { name: repo.name, id: repo.id } : undefined,
      projects: projects.map(p => ({ name: p.name, id: p.id })),
      systems: systems.map(s => ({ name: s.name, id: s.id, kind: s.kind })),
    };

    const searchTerms = [repo?.name, ...projects.map(p => p.name), ...systems.map(s => s.name)].filter(Boolean).join(' ');
    if (searchTerms) {
      try {
        const { vectorSearch } = await import('../../memory/search.js');
        const results = await vectorSearch({ db: db.rawDb, text: searchTerms, vecTable: 'memory_vectors', limit: 5 });
        for (const r of results) {
          if (r.similarity < 0.25) break;
          const mem = db.getMemory(r.id);
          if (mem && !mem.archivedAt) {
            contextKnowledge.push({ title: mem.title, kind: mem.kind, snippet: mem.bodyMd.slice(0, 150) });
          }
        }
      } catch { /* embedding model may not be ready yet */ }
    }
  } else {
    const coreMems = db.listMemories({ layer: 'core', archived: false, limit: 3 })
      .filter(m => m.kind === 'knowledge_summary' || m.kind === 'taught');
    contextKnowledge = coreMems.map(m => ({ title: m.title, kind: m.kind, snippet: m.bodyMd.slice(0, 150) }));
  }

  return {
    displayName: profile.displayName,
    locale: profile.locale,
    bondTier: profile.bondTier,
    bondTierName: trustNames[profile.bondTier] ?? 'observer',
    bondAxes: profile.bondAxes,
    bondResetAt: profile.bondResetAt,
    proactivityLevel: profile.proactivityLevel,
    focusMode: profile.focusMode,
    focusUntil: profile.focusUntil,
    mood,
    greeting,
    pendingEvents: pendingEvents.map(e => ({
      kind: e.kind,
      priority: e.priority,
      message: (e.payload as Record<string, unknown>).message ?? e.kind,
    })),
    pendingSuggestions,
    recentObservations: recentObs.map(o => ({
      kind: o.kind,
      title: o.title,
      repoId: o.repoId,
      votes: o.votes,
      severity: o.severity,
      createdAt: o.createdAt,
    })),
    contextRepo: contextRepoId,
    contextProjects: contextProjectIds,
    soul,
    contextEntities,
    contextKnowledge,
    todayTokens: usage.totalInputTokens + usage.totalOutputTokens,
    todayLlmCalls: usage.totalCalls,
    updateAvailable: getDaemonState(config).updateAvailable ?? null,
    activeAlerts: (getDaemonState(config).alerts ?? []).map(a => ({
      id: a.id,
      message: a.message,
      severity: a.severity,
      since: a.since,
    })),
  };
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export function statusTools(ctx: ToolContext): McpTool[] {
  const { db, config, deriveMood, deriveGreeting, trustNames } = ctx;

  return [
    // -----------------------------------------------------------------------
    // shadow_check_in
    // -----------------------------------------------------------------------
    {
      name: 'shadow_check_in',
      description: 'Get Shadow\'s current soul, mood, context, and pending updates. Call this at the start of a conversation to adopt Shadow\'s persona, or when the user greets Shadow.',
      inputSchema: mcpSchema(CheckInSchema),
      handler: async (params) => {
        const { repoPath } = CheckInSchema.parse(params);
        // Side effect: each check_in increases bond. CLI variant skips this.
        try { applyBondDelta(db, 'check_in'); } catch { /* ignore */ }
        const data = await buildCheckInData({ db, config, repoPath, deriveMood, deriveGreeting, trustNames });
        return ok(data);
      },
    },

    // -----------------------------------------------------------------------
    // shadow_status
    // -----------------------------------------------------------------------
    {
      name: 'shadow_status',
      description: 'Returns a quick summary of Shadow\'s state: bond tier, bond axes, repo count, pending suggestions/events, and today\'s LLM usage. Use when the user asks how Shadow is doing or wants a one-glance health check without the full check_in payload.',
      inputSchema: mcpSchema(StatusSchema),
      handler: async () => {
        const profile = db.getProfile('default');
        const repos = db.listRepos();
        const pendingSuggestions = db.countPendingSuggestions();
        const pendingEvents = db.listPendingEvents();
        const usage = db.getUsageSummary('day');
        return ok({
          bondTier: profile?.bondTier ?? 1,
          bondAxes: profile?.bondAxes ?? { time: 0, depth: 0, momentum: 0, alignment: 0, autonomy: 0 },
          bondResetAt: profile?.bondResetAt ?? null,
          totalInteractions: profile?.totalInteractions ?? 0,
          proactivityLevel: profile?.proactivityLevel ?? config.proactivityLevel,
          repoCount: repos.length,
          pendingSuggestions,
          pendingEvents: pendingEvents.length,
          usageToday: {
            totalInputTokens: usage.totalInputTokens,
            totalOutputTokens: usage.totalOutputTokens,
            totalCalls: usage.totalCalls,
          },
        });
      },
    },

    // -----------------------------------------------------------------------
    // shadow_available
    // -----------------------------------------------------------------------
    {
      name: 'shadow_available',
      description: 'Exit focus mode and restore the previous proactivity level. Use when the user signals they are done concentrating ("I\'m back", "done focusing") and wants normal Shadow responsiveness. Requires trust level >= 1.',
      inputSchema: mcpSchema(AvailableSchema),
      handler: async () => {

        db.updateProfile('default', { focusMode: null, focusUntil: null });
        const profile = db.ensureProfile();
        return ok({ mode: 'available', proactivityLevel: profile.proactivityLevel });
      },
    },

    // -----------------------------------------------------------------------
    // shadow_alerts
    // -----------------------------------------------------------------------
    {
      name: 'shadow_alerts',
      description: 'List active daemon alerts: backend health issues, version updates, disk pressure, etc. Use when investigating why the daemon is misbehaving or when the user asks what alerts are currently firing.',
      inputSchema: mcpSchema(StatusSchema),
      handler: async () => {
        const alerts = getDaemonState(config).alerts ?? [];
        return ok({ alerts, count: alerts.length });
      },
    },

    // -----------------------------------------------------------------------
    // shadow_alert_ack
    // -----------------------------------------------------------------------
    {
      name: 'shadow_alert_ack',
      description: 'Acknowledge a daemon alert by ID — dims it on the status line but keeps it visible until auto-cleared. Use when the user has seen the alert and wants it muted without resolving the underlying condition. Requires trust level >= 1.',
      inputSchema: mcpSchema(AlertAckSchema),
      handler: async (params) => {
        const { id } = AlertAckSchema.parse(params);
        const alerts = getDaemonState(config).alerts ?? [];
        const alert = alerts.find(a => a.id === id);
        if (!alert) return err(`Alert "${id}" not found`);
        const actionsPath = resolve(config.resolvedDataDir, 'alert-actions.jsonl');
        appendFileSync(actionsPath, JSON.stringify({ action: 'ack', id }) + '\n', 'utf-8');
        return ok({ id, action: 'acked' });
      },
    },

    // -----------------------------------------------------------------------
    // shadow_alert_resolve
    // -----------------------------------------------------------------------
    {
      name: 'shadow_alert_resolve',
      description: 'Manually resolve/dismiss a daemon alert by ID, removing it from the active list. Use when the user has fixed the underlying issue; auto-managed alerts may reappear if the condition persists. Requires trust level >= 1.',
      inputSchema: mcpSchema(AlertResolveSchema),
      handler: async (params) => {
        const { id } = AlertResolveSchema.parse(params);
        const alerts = getDaemonState(config).alerts ?? [];
        const alert = alerts.find(a => a.id === id);
        if (!alert) return err(`Alert "${id}" not found`);
        const actionsPath = resolve(config.resolvedDataDir, 'alert-actions.jsonl');
        appendFileSync(actionsPath, JSON.stringify({ action: 'resolve', id }) + '\n', 'utf-8');
        return ok({ id, action: 'resolved' });
      },
    },
  ];
}
