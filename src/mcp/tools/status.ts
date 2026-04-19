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

        const profile = db.ensureProfile();
        // Trust: each check_in increases trust
        try { applyBondDelta(db, 'check_in'); } catch { /* ignore */ }
        const mood = deriveMood();
        const greeting = deriveGreeting(profile);
        const pendingEvents = db.listPendingEvents();
        const pendingSuggestions = db.countPendingSuggestions();
        const usage = db.getUsageSummary('day');

        // Context-aware filtering: if repoPath provided, prioritize that repo's data
        let contextRepoId: string | null = null;
        let contextProjectIds: string[] = [];
        if (repoPath) {
          const repo = db.findRepoByPath(repoPath);
          if (repo) {
            contextRepoId = repo.id;
            contextProjectIds = db.findProjectsForRepo(repo.id).map(p => p.id);
          }
        }

        // Filter observations: prefer context repo, fallback to all active
        let recentObs = db.listObservations({ status: 'open', limit: 10 });
        if (contextRepoId) {
          const repoObs = recentObs.filter(o => o.repoId === contextRepoId || o.repoIds.includes(contextRepoId!));
          recentObs = [...repoObs, ...recentObs.filter(o => !repoObs.includes(o))].slice(0, 5);
        } else {
          recentObs = recentObs.slice(0, 5);
        }

        // Soul reflection — the synthesized understanding of the developer
        const allMems = db.listMemories({ archived: false });
        const soulMem = allMems.find(m => m.kind === 'soul_reflection');
        const soul = soulMem?.bodyMd ?? null;

        // Context knowledge: relevant memories for the current context
        let contextKnowledge: { title: string; kind: string; snippet: string }[] = [];
        let contextEntities: { repo?: { name: string; id: string }; projects: { name: string; id: string }[]; systems: { name: string; id: string; kind: string }[] } | undefined;

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

          // Hybrid search for relevant memories using repo + project + system names as query
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
          // No repo context: show core knowledge summaries if available
          const coreMems = db.listMemories({ layer: 'core', archived: false, limit: 3 })
            .filter(m => m.kind === 'knowledge_summary' || m.kind === 'taught');
          contextKnowledge = coreMems.map(m => ({ title: m.title, kind: m.kind, snippet: m.bodyMd.slice(0, 150) }));
        }

        return ok({
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
        });
      },
    },

    // -----------------------------------------------------------------------
    // shadow_status
    // -----------------------------------------------------------------------
    {
      name: 'shadow_status',
      description: 'Returns a summary of Shadow status including trust level, repos, suggestions, events, and LLM usage.',
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
      description: 'Exit focus mode, restore previous proactivity level. Requires trust level >= 1.',
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
      description: 'List active daemon alerts (backend health, version updates, etc).',
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
      description: 'Acknowledge an alert — dims it on the status line but keeps it visible. Requires trust level >= 1.',
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
      description: 'Manually resolve/dismiss an alert — removes it. Auto-managed alerts may reappear if the condition persists. Requires trust level >= 1.',
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
