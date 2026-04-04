import { createHash } from 'node:crypto';

import type { ShadowConfig } from '../config/load-config.js';
import type { ShadowDatabase } from '../storage/database.js';
import { selectAdapter } from '../backend/index.js';
import { discoverMcpServerNames } from '../observation/mcp-discovery.js';

// --- Types ---

type EnrichmentPlan = {
  queries: Array<{
    mcpServer: string;
    intent: string;
    entityType?: string;
    entityName?: string;
  }>;
};

type EnrichmentResult = {
  items: Array<{
    source: string;
    entityType?: string;
    entityName?: string;
    summary: string;
    detail?: Record<string, unknown>;
  }>;
};

// --- Helpers ---

function contentHash(source: string, summary: string): string {
  return createHash('sha256').update(`${source}:${summary}`).digest('hex').slice(0, 16);
}

// --- Main ---

/**
 * 2-phase enrichment:
 * 1. Planning: ask LLM what external data would be useful (Sonnet, JSON-only)
 * 2. Execution: LLM uses MCP tools to gather the data
 *
 * Results are stored in enrichment_cache with content_hash dedup.
 */
export async function activityEnrich(
  db: ShadowDatabase,
  config: ShadowConfig,
): Promise<{ itemsCollected: number; llmCalls: number; tokensUsed: number }> {
  const mcpServers = discoverMcpServerNames();
  if (mcpServers.length === 0) {
    console.error('[shadow:enrich] No external MCP servers found — skipping');
    return { itemsCollected: 0, llmCalls: 0, tokensUsed: 0 };
  }

  const adapter = selectAdapter(config);
  let llmCalls = 0;
  let tokensUsed = 0;
  let itemsCollected = 0;

  // Context for planning
  const projects = db.listProjects({ status: 'active' });
  const systems = db.listSystems();
  const repos = db.listRepos();
  const recentObs = db.listObservations({ status: 'active', limit: 10 });

  const contextSummary = [
    projects.length > 0 ? `Active projects: ${projects.map(p => p.name).join(', ')}` : '',
    systems.length > 0 ? `Systems: ${systems.map(s => `${s.name} (${s.kind})`).join(', ')}` : '',
    `Repos: ${repos.slice(0, 10).map(r => r.name).join(', ')}`,
    recentObs.length > 0 ? `Recent observations: ${recentObs.slice(0, 5).map(o => o.title).join('; ')}` : '',
  ].filter(Boolean).join('\n');

  // Already cached (don't re-fetch)
  const recentCache = db.listEnrichment({ limit: 20 });
  const cachedSummaries = recentCache.map(c => `- [${c.source}] ${c.summary}`).join('\n');

  // ========== PHASE 1: Plan what to query ==========
  const planPrompt = [
    'You are Shadow\'s enrichment planner. The developer has these MCP servers available:',
    mcpServers.map(s => `- ${s}`).join('\n'),
    '',
    '## Developer context',
    contextSummary,
    '',
    cachedSummaries ? `## Already cached (DO NOT re-query)\n${cachedSummaries}\n` : '',
    '',
    'Plan up to 3 enrichment queries that would provide useful EXTERNAL context.',
    'Focus on: deployment status, monitoring alerts, CI/CD pipeline state, calendar events, open PRs, ticket status.',
    'Only suggest queries for MCP servers that are actually available above.',
    '',
    'Return JSON:',
    '{ "queries": [{ "mcpServer": string, "intent": string, "entityType": "project"|"system"|"repo"|null, "entityName": string|null }] }',
    '',
    'Return { "queries": [] } if no useful enrichment is needed right now.',
    'Respond with JSON only.',
  ].join('\n');

  // Resolve configurable models
  const profile = db.ensureProfile();
  const prefs = profile.preferences as Record<string, unknown> | undefined;
  const prefModels = prefs?.models as Record<string, string> | undefined;
  const planModel = prefModels?.enrichPlan ?? config.models.enrichPlan;
  const execModel = prefModels?.enrichExecute ?? config.models.enrichExecute;

  let plan: EnrichmentPlan = { queries: [] };

  try {
    const planResult = await adapter.execute({
      repos: [], title: 'Enrichment Plan', goal: 'Plan external data queries',
      prompt: planPrompt, relevantMemories: [], model: planModel, effort: 'low',
    });
    llmCalls++;
    tokensUsed += (planResult.inputTokens ?? 0) + (planResult.outputTokens ?? 0);
    db.recordLlmUsage({ source: 'enrichment_plan', sourceId: null, model: planModel, inputTokens: planResult.inputTokens ?? 0, outputTokens: planResult.outputTokens ?? 0 });

    if (planResult.status === 'success' && planResult.output) {
      try {
        const parsed = JSON.parse(planResult.output) as EnrichmentPlan;
        if (parsed.queries && Array.isArray(parsed.queries)) {
          plan = parsed;
        }
      } catch {
        console.error('[shadow:enrich] Failed to parse plan');
      }
    }
  } catch (e) {
    console.error('[shadow:enrich] Planning failed:', e instanceof Error ? e.message : e);
    return { itemsCollected: 0, llmCalls, tokensUsed };
  }

  if (plan.queries.length === 0) {
    console.error('[shadow:enrich] No enrichment queries planned');
    return { itemsCollected: 0, llmCalls, tokensUsed };
  }

  console.error(`[shadow:enrich] Planned ${plan.queries.length} queries: ${plan.queries.map(q => `${q.mcpServer}:${q.intent.slice(0, 40)}`).join(', ')}`);

  // ========== PHASE 2: Execute queries via MCP ==========
  const execPrompt = [
    'Execute the following enrichment queries using the available MCP tools.',
    'For each query, call the appropriate MCP tool and summarize what you learn.',
    '',
    '## Queries',
    ...plan.queries.map((q, i) => `${i + 1}. **${q.mcpServer}**: ${q.intent}${q.entityName ? ` (for ${q.entityType}: ${q.entityName})` : ''}`),
    '',
    'Return JSON with your findings:',
    '{ "items": [{ "source": string, "entityType": string|null, "entityName": string|null, "summary": string, "detail": {} }] }',
    '',
    'Each item.source should be the MCP server name.',
    'summary should be a concise 1-2 sentence finding.',
    'detail can include structured data (timestamps, counts, URLs).',
    'If a query fails or returns nothing useful, omit it from items.',
    'Respond with JSON only.',
  ].join('\n');

  try {
    const execResult = await adapter.execute({
      repos: [], title: 'Enrichment Execute', goal: 'Gather external context via MCP',
      prompt: execPrompt, relevantMemories: [], model: execModel, effort: 'medium',
      systemPrompt: null, // MCP access
      allowedTools: ['mcp__*'], // Access ALL user MCP servers
    });
    llmCalls++;
    tokensUsed += (execResult.inputTokens ?? 0) + (execResult.outputTokens ?? 0);
    db.recordLlmUsage({ source: 'enrichment_execute', sourceId: null, model: execModel, inputTokens: execResult.inputTokens ?? 0, outputTokens: execResult.outputTokens ?? 0 });

    if (execResult.status === 'success' && execResult.output) {
      try {
        const parsed = JSON.parse(execResult.output) as EnrichmentResult;
        if (parsed.items && Array.isArray(parsed.items)) {
          for (const item of parsed.items) {
            if (!item.source || !item.summary) continue;
            const hash = contentHash(item.source, item.summary);

            // Resolve entity ID if entityName provided
            let entityId: string | undefined;
            if (item.entityType && item.entityName) {
              if (item.entityType === 'project') {
                entityId = db.findProjectByName(item.entityName)?.id;
              } else if (item.entityType === 'system') {
                entityId = db.listSystems().find(s => s.name.toLowerCase() === item.entityName!.toLowerCase())?.id;
              } else if (item.entityType === 'repo') {
                entityId = db.listRepos().find(r => r.name.toLowerCase() === item.entityName!.toLowerCase())?.id;
              }
            }

            db.upsertEnrichment({
              source: item.source,
              entityType: item.entityType,
              entityId,
              entityName: item.entityName,
              summary: item.summary,
              detail: item.detail,
              contentHash: hash,
              expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24h TTL
            });
            itemsCollected++;
          }
          console.error(`[shadow:enrich] Collected ${itemsCollected} items from ${new Set(parsed.items.map(i => i.source)).size} sources`);
        }
      } catch {
        console.error('[shadow:enrich] Failed to parse execution results');
      }
    }
  } catch (e) {
    console.error('[shadow:enrich] Execution failed:', e instanceof Error ? e.message : e);
  }

  // Expire stale entries
  const expired = db.expireStaleEnrichment();
  if (expired > 0) console.error(`[shadow:enrich] Expired ${expired} stale entries`);

  return { itemsCollected, llmCalls, tokensUsed };
}

/**
 * Build enrichment context string for heartbeat prompts.
 * Marks items as reported after including them.
 */
export function buildEnrichmentContext(db: ShadowDatabase): string | undefined {
  const newItems = db.listNewEnrichment(10);
  if (newItems.length === 0) return undefined;

  const lines = newItems.map(item => {
    const entityLabel = item.entityName ? ` (${item.entityType}: ${item.entityName})` : '';
    return `- [${item.source}]${entityLabel}: ${item.summary}`;
  });

  // Mark as reported
  for (const item of newItems) {
    db.markEnrichmentReported(item.id);
  }

  return lines.join('\n');
}
