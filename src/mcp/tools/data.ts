import { z } from 'zod';

import { mcpSchema, type McpTool, type ToolContext } from './types.js';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const SearchSchema = z.object({
  query: z.string().describe('Natural language search query'),
  types: z.array(z.enum(['memory', 'observation', 'suggestion'])).describe('Entity types to search (default: all three)').optional(),
  limit: z.number().describe('Max results per type (default 5)').optional(),
});

const RunListSchema = z.object({
  status: z.string().describe('Filter by status: queued, running, completed, executed, executed_manual, failed, closed, discarded').optional(),
  repoId: z.string().describe('Filter by repo ID').optional(),
  archived: z.boolean().describe('Include archived runs (default false)').optional(),
  limit: z.number().describe('Max results (default 20)').optional(),
  offset: z.number().describe('Offset for pagination (default 0)').optional(),
});

const RunCreateSchema = z.object({
  repoId: z.string().describe('Repository ID where the work will happen'),
  prompt: z.string().describe('Description of what to implement'),
  kind: z.string().describe('Run kind — e.g. task, refactor, bug, improvement (default: task)').optional(),
});

const RunViewSchema = z.object({
  runId: z.string().describe('Run ID to view'),
});

const UsageSchema = z.object({
  period: z.string().describe('Time period: day, week, month (default: day)').optional(),
});

const DigestSchema = z.object({
  kind: z.enum(['daily', 'weekly', 'brag']).describe('Digest type'),
});

const DigestsSchema = z.object({
  kind: z.enum(['daily', 'weekly', 'brag']).describe('Filter by digest type').optional(),
  limit: z.number().describe('Max results (default 10)').optional(),
});

const EnrichmentConfigSchema = z.object({
  includeCache: z.boolean().describe('Include recent cache entries (default false)').optional(),
  limit: z.number().describe('Max cache entries to return (default 10)').optional(),
});

const EnrichmentQuerySchema = z.object({
  source: z.string().describe('Filter by MCP server name').optional(),
  entityName: z.string().describe('Filter by entity name (case-insensitive substring match)').optional(),
  unreportedOnly: z.boolean().describe('Only return new/unreported items (default false)').optional(),
  limit: z.number().describe('Max results (default 20)').optional(),
  offset: z.number().describe('Offset for pagination (default 0)').optional(),
});

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export function dataTools(ctx: ToolContext): McpTool[] {
  const { db, config, trustGate } = ctx;

  return [
    // ---- Events ----
    {
      name: 'shadow_events',
      description: 'Returns pending (undelivered) events.',
      inputSchema: mcpSchema(z.object({})),
      handler: async () => {
        return db.listPendingEvents();
      },
    },
    {
      name: 'shadow_events_ack',
      description: 'Acknowledge all pending events. Requires trust level >= 1.',
      inputSchema: mcpSchema(z.object({})),
      handler: async () => {
        const gate = trustGate(1);
        if (!gate.ok) return gate.error;

        const count = db.deliverAllEvents();
        return { ok: true, acknowledged: count };
      },
    },

    // ---- Search ----
    {
      name: 'shadow_search',
      description: 'Unified semantic search across memories, observations, and suggestions using hybrid search (FTS5 + embeddings).',
      inputSchema: mcpSchema(SearchSchema),
      handler: async (params) => {
        const { query, types: rawTypes, limit: rawLimit } = SearchSchema.parse(params);
        const types = rawTypes ?? ['memory', 'observation', 'suggestion'];
        const limit = rawLimit ?? 5;
        const { hybridSearch } = await import('../../memory/search.js');

        const results: Array<{ type: string; id: string; title: string; kind: string; score: number; similarity?: number }> = [];

        if (types.includes('memory')) {
          const memResults = await hybridSearch({
            db: db.rawDb, query, ftsTable: 'memories_fts', vecTable: 'memory_vectors',
            mainTable: 'memories', limit, filters: { archived: false },
          });
          for (const r of memResults) {
            const m = db.getMemory(r.id);
            if (m) results.push({ type: 'memory', id: m.id, title: m.title, kind: m.kind, score: r.score, similarity: r.vecSimilarity });
          }
        }

        if (types.includes('observation')) {
          const obsResults = await hybridSearch({
            db: db.rawDb, query, ftsTable: 'observations_fts', vecTable: 'observation_vectors',
            mainTable: 'observations', limit,
          }).catch(() => [] as Array<{ id: string; score: number; vecSimilarity?: number }>);
          // observations_fts may not exist yet — fallback to vector-only
          const { vectorSearch } = await import('../../memory/search.js');
          const finalObs = obsResults.length > 0 ? obsResults
            : (await vectorSearch({ db: db.rawDb, text: query, vecTable: 'observation_vectors', limit }))
                .map(r => ({ id: r.id, score: r.similarity, vecSimilarity: r.similarity }));
          for (const r of finalObs) {
            const o = db.getObservation(r.id);
            if (o) results.push({ type: 'observation', id: o.id, title: o.title, kind: o.kind, score: r.score, similarity: r.vecSimilarity });
          }
        }

        if (types.includes('suggestion')) {
          const { vectorSearch } = await import('../../memory/search.js');
          const sugResults = await vectorSearch({ db: db.rawDb, text: query, vecTable: 'suggestion_vectors', limit });
          for (const r of sugResults) {
            const s = db.getSuggestion(r.id);
            if (s) results.push({ type: 'suggestion', id: s.id, title: s.title, kind: s.kind, score: r.similarity, similarity: r.similarity });
          }
        }

        return results.sort((a, b) => b.score - a.score).slice(0, limit * 2);
      },
    },

    // ---- Runs ----
    {
      name: 'shadow_run_list',
      description: 'List task runs. Filter by status, repo, archived. Supports pagination.',
      inputSchema: mcpSchema(RunListSchema),
      handler: async (params) => {
        const { status, repoId, archived, limit, offset } = RunListSchema.parse(params);
        const items = db.listRuns({ status, repoId, archived: archived ?? false, limit: limit ?? 20, offset: offset ?? 0 });
        const total = db.countRuns({ status, archived: archived ?? false });
        return { items, total };
      },
    },
    {
      name: 'shadow_run_view',
      description: 'View details of a specific run.',
      inputSchema: mcpSchema(RunViewSchema),
      handler: async (params) => {
        const { runId } = RunViewSchema.parse(params);
        const run = db.getRun(runId);
        if (!run) return { isError: true, message: `Run not found: ${runId}` };
        return run;
      },
    },
    {
      name: 'shadow_run_create',
      description: 'Create a new run directly (without a suggestion). Use this to register implementation work in Shadow so it is trackable in the workspace. Requires trust level >= 2.',
      inputSchema: mcpSchema(RunCreateSchema),
      handler: async (params) => {
        const gate = trustGate(2);
        if (!gate.ok) return gate.error;
        const { repoId, prompt, kind } = RunCreateSchema.parse(params);
        const repo = db.getRepo(repoId);
        if (!repo) return { isError: true, message: `Repo not found: ${repoId}` };
        const run = db.createRun({ repoId, repoIds: [repoId], kind: kind ?? 'task', prompt });
        return { ok: true, runId: run.id, status: run.status };
      },
    },

    // ---- Usage ----
    {
      name: 'shadow_usage',
      description: 'Returns LLM token usage summary for a given period.',
      inputSchema: mcpSchema(UsageSchema),
      handler: async (params) => {
        const { period: rawPeriod } = UsageSchema.parse(params);
        const period = (rawPeriod as 'day' | 'week' | 'month' | undefined) ?? 'day';
        return db.getUsageSummary(period);
      },
    },

    // ---- Daily Summary ----
    {
      name: 'shadow_daily_summary',
      description: 'Get a comprehensive summary of today\'s engineering activity: repos touched, memories created, suggestions, observations, tokens used, and active hours.',
      inputSchema: mcpSchema(z.object({})),
      handler: async () => {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const sinceIso = todayStart.toISOString();

        const profile = db.ensureProfile();
        const repos = db.listRepos();
        const observations = db.listObservations({ status: 'active', limit: 100 });
        const todayObs = observations.filter(o => o.createdAt > sinceIso);
        const memories = db.listMemories({ archived: false });
        const todayMemories = memories.filter(m => m.createdAt > sinceIso);
        const suggestions = db.listSuggestions({ status: 'pending' });
        const usage = db.getUsageSummary('day');
        const events = db.listPendingEvents();

        return {
          date: todayStart.toISOString().split('T')[0],
          user: profile.displayName ?? 'unknown',
          trustLevel: profile.trustLevel,
          trustScore: profile.trustScore,
          activity: {
            observationsToday: todayObs.length,
            memoriesCreatedToday: todayMemories.length,
            pendingSuggestions: suggestions.length,
            pendingEvents: events.length,
          },
          topObservations: todayObs.slice(0, 5).map(o => ({ kind: o.kind, title: o.title, repo: o.repoId })),
          newMemories: todayMemories.map(m => ({ layer: m.layer, kind: m.kind, title: m.title })),
          pendingSuggestions: suggestions.slice(0, 5).map(s => ({ kind: s.kind, title: s.title, impact: s.impactScore })),
          repos: repos.map(r => ({ name: r.name, lastObserved: r.lastObservedAt })),
          tokens: {
            input: usage.totalInputTokens,
            output: usage.totalOutputTokens,
            totalCalls: usage.totalCalls,
            byModel: usage.byModel,
          },
        };
      },
    },

    // ---- Digests ----
    {
      name: 'shadow_digest',
      description: 'Generate a digest on demand: daily (standup), weekly (1:1), or brag (performance review). Requires trust level >= 1.',
      inputSchema: mcpSchema(DigestSchema),
      handler: async (params) => {
        const gate = trustGate(1);
        if (!gate.ok) return gate.error;

        const { kind } = DigestSchema.parse(params);
        const { activityDailyDigest, activityWeeklyDigest, activityBragDoc } = await import('../../analysis/digests.js');
        let result: { contentMd: string; tokensUsed: number };
        if (kind === 'daily') result = await activityDailyDigest(db, config);
        else if (kind === 'weekly') result = await activityWeeklyDigest(db, config);
        else result = await activityBragDoc(db, config);
        return { ok: true, kind, contentMd: result.contentMd, tokensUsed: result.tokensUsed };
      },
    },
    {
      name: 'shadow_digests',
      description: 'List previous digests. Optionally filter by kind.',
      inputSchema: mcpSchema(DigestsSchema),
      handler: async (params) => {
        const { kind, limit: rawLimit } = DigestsSchema.parse(params);
        return db.listDigests({
          kind,
          limit: rawLimit ?? 10,
        });
      },
    },

    // ---- Enrichment ----
    {
      name: 'shadow_enrichment_config',
      description: 'View enrichment configuration: available MCP servers, enabled status, interval, and recent cache entries.',
      inputSchema: mcpSchema(EnrichmentConfigSchema),
      handler: async (params) => {
        const { discoverMcpServerNames } = await import('../../observation/mcp-discovery.js');
        const discovered = discoverMcpServerNames();
        const { includeCache: rawIncludeCache, limit: rawLimit } = EnrichmentConfigSchema.parse(params);
        const includeCache = rawIncludeCache ?? false;
        const limit = rawLimit ?? 10;

        const profile = db.ensureProfile();
        const prefs = profile.preferences as Record<string, unknown> | undefined;
        const disabled = (prefs?.enrichmentDisabledServers as string[] | undefined) ?? [];

        const disabledProjects = (prefs?.enrichmentDisabledProjects as string[] | undefined) ?? [];

        const result: Record<string, unknown> = {
          enabled: config.enrichmentEnabled,
          intervalMs: config.enrichmentIntervalMs,
          intervalHuman: `${Math.round(config.enrichmentIntervalMs / 60000)}min`,
          availableMcpServers: discovered.map(name => ({ name, enabled: !disabled.includes(name) })),
          serverCount: discovered.length,
          enabledCount: discovered.filter(s => !disabled.includes(s)).length,
          disabledProjects,
        };

        if (includeCache) {
          const items = db.listEnrichment({ limit });
          result.recentCache = items.map(i => ({
            id: i.id,
            source: i.source,
            entityName: i.entityName,
            summary: i.summary,
            reported: i.reported,
            createdAt: i.createdAt,
          }));
          result.totalCached = db.countEnrichment();
          result.unreported = db.countEnrichment({ reported: false });
        }

        return result;
      },
    },
    {
      name: 'shadow_enrichment_query',
      description: 'Query enrichment cache entries. Returns external context gathered from MCP tools.',
      inputSchema: mcpSchema(EnrichmentQuerySchema),
      handler: async (params) => {
        const { source, entityName, unreportedOnly: rawUnreported, limit: rawLimit, offset: rawOffset } = EnrichmentQuerySchema.parse(params);
        const unreportedOnly = rawUnreported ?? false;
        const limit = rawLimit ?? 20;
        const offset = rawOffset ?? 0;
        try {
          let items = db.listEnrichment({ source, reported: unreportedOnly ? false : undefined, limit: entityName ? 100 : limit, offset: entityName ? 0 : offset });
          if (entityName) {
            const lower = entityName.toLowerCase();
            items = items.filter(i => i.entityName?.toLowerCase().includes(lower));
            const total = items.length;
            items = items.slice(offset, offset + limit);
            return { items: items.map(i => ({ id: i.id, source: i.source, entityType: i.entityType, entityName: i.entityName, summary: i.summary, detail: i.detail, reported: i.reported, createdAt: i.createdAt })), total };
          }
          const total = db.countEnrichment({ source, reported: unreportedOnly ? false : undefined });
          return { items: items.map(i => ({ id: i.id, source: i.source, entityType: i.entityType, entityName: i.entityName, summary: i.summary, detail: i.detail, reported: i.reported, createdAt: i.createdAt })), total };
        } catch {
          return { items: [], total: 0 };
        }
      },
    },
    // ---- Enrichment Write ----
    {
      name: 'shadow_enrichment_write',
      description: 'Store an enrichment finding from an external MCP server query. Used by the enrichment agent to persist discoveries. Requires trust level >= 1.',
      inputSchema: mcpSchema(z.object({
        projectId: z.string().describe('Project ID this finding relates to'),
        source: z.string().describe('MCP server name that provided the data (e.g. oliver, atlassian-mcp)'),
        summary: z.string().describe('Concise 1-2 sentence finding'),
        detail: z.record(z.string(), z.unknown()).describe('Optional structured data').optional(),
      })),
      handler: async (params) => {
        const gate = trustGate(1);
        if (!gate.ok) return gate.error;

        const parsed = z.object({
          projectId: z.string(),
          source: z.string(),
          summary: z.string(),
          detail: z.record(z.string(), z.unknown()).optional(),
        }).parse(params);

        // Resolve project name
        const project = db.getProject(parsed.projectId);
        if (!project) return { ok: false, error: `Project not found: ${parsed.projectId}` };

        // Look up TTL from mcp-discover
        const TTL_MS: Record<string, number> = {
          volatile: 2 * 60 * 60 * 1000,
          short: 12 * 60 * 60 * 1000,
          medium: 48 * 60 * 60 * 1000,
          long: 7 * 24 * 60 * 60 * 1000,
          stable: 30 * 24 * 60 * 60 * 1000,
        };
        let ttlCategory = 'medium';
        try {
          const serverMeta = db.listEnrichment({ source: 'mcp-discover', entityId: parsed.source, limit: 1 });
          if (serverMeta.length > 0) {
            const detail = serverMeta[0].detail as Record<string, unknown> | undefined;
            // Prefer learned TTL over default
            const learnedTtl = detail?.learnedTtl as string | undefined;
            const discoveredTtl = detail?.defaultTtl as string | undefined;
            const resolvedTtl = learnedTtl ?? discoveredTtl;
            if (resolvedTtl && TTL_MS[resolvedTtl]) ttlCategory = resolvedTtl;
          }
        } catch { /* use default */ }

        const expiresAt = new Date(Date.now() + (TTL_MS[ttlCategory] ?? TTL_MS.medium)).toISOString();

        // Embedding-based dedup: skip near-duplicates, update similar entries
        const { checkEnrichmentDuplicate } = await import('../../memory/dedup.js');
        const { generateAndStoreEmbedding } = await import('../../memory/lifecycle.js');
        const dedup = await checkEnrichmentDuplicate(db, { title: parsed.summary, summaryMd: parsed.summary });

        if (dedup.action === 'skip') {
          return { ok: true, action: 'skip', reason: 'similar entry exists', existingId: dedup.existingId, similarity: dedup.similarity };
        }

        const { createHash } = await import('node:crypto');
        const contentHash = createHash('sha256').update(`${parsed.source}:${parsed.summary}`).digest('hex').slice(0, 16);

        if (dedup.action === 'update') {
          // Track whether content actually changed (TTL tuning signal)
          const existing = db.getEnrichment(dedup.existingId);
          const contentChanged = (dedup.similarity ?? 0) < 0.95;
          const newRefreshCount = (existing?.refreshCount ?? 0) + 1;
          const newChangeCount = (existing?.changeCount ?? 0) + (contentChanged ? 1 : 0);

          // Update existing record with fresh data
          db.upsertEnrichment({
            source: parsed.source,
            entityType: 'project',
            entityId: parsed.projectId,
            entityName: project.name,
            summary: parsed.summary,
            detail: parsed.detail,
            contentHash,
            expiresAt,
          });
          db.updateEnrichmentStats(dedup.existingId, {
            refreshCount: newRefreshCount,
            changeCount: newChangeCount,
            ttlCategory,
          });
          await generateAndStoreEmbedding(db, 'enrichment', dedup.existingId, { title: parsed.summary, summaryMd: parsed.summary });
          return { ok: true, action: 'updated', existingId: dedup.existingId, similarity: dedup.similarity, ttl: ttlCategory, contentChanged };
        }

        // Create new entry
        const record = db.upsertEnrichment({
          source: parsed.source,
          entityType: 'project',
          entityId: parsed.projectId,
          entityName: project.name,
          summary: parsed.summary,
          detail: parsed.detail,
          contentHash,
          expiresAt,
        });
        db.updateEnrichmentStats(record.id, { ttlCategory });
        await generateAndStoreEmbedding(db, 'enrichment', record.id, { title: parsed.summary, summaryMd: parsed.summary });

        return { ok: true, action: 'created', ttl: ttlCategory, expiresAt };
      },
    },
  ];
}
