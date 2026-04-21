import { createHash } from 'node:crypto';
import { z } from 'zod';

import type { ShadowConfig } from '../config/load-config.js';
import type { ShadowDatabase } from '../storage/database.js';
import { selectAdapter } from '../backend/index.js';
import { safeParseJson } from '../backend/json-repair.js';
import { discoverMcpServerNames } from '../observation/mcp-discovery.js';
import { log } from '../log.js';

// --- Types ---

type McpDiscoverResult = {
  serversDescribed: number;
  serversTotal: number;
  serverNames: string[];
  llmCalls: number;
  tokensUsed: number;
};

const McpDiscoverResponseSchema = z.object({
  servers: z.array(z.object({
    name: z.string(),
    description: z.string().nullable(),
    toolCount: z.number(),
    defaultTtl: z.enum(['volatile', 'short', 'medium', 'long', 'stable']).default('medium'),
    enrichmentHint: z.string().nullable().default(null),
  })),
});

// --- Helpers ---

function contentHash(name: string, description: string): string {
  return createHash('sha256').update(`mcp-discover:${name}:${description}`).digest('hex').slice(0, 16);
}

// --- Main ---

/**
 * Discover MCP server metadata by asking an LLM to describe each server
 * based on the tool schemas visible in its context.
 *
 * One LLM call with allowedTools: ['mcp__*'] — the LLM sees all tool
 * definitions and describes each server without calling any tools.
 */
export async function activityMcpDiscover(
  db: ShadowDatabase,
  config: ShadowConfig,
): Promise<McpDiscoverResult> {
  // Discover ALL servers (including disabled) — mcp-discover describes all of them
  const servers = discoverMcpServerNames();

  if (servers.length === 0) {
    log.error('[shadow:mcp-discover] No MCP servers found — skipping');
    return { serversDescribed: 0, serversTotal: 0, serverNames: [], llmCalls: 0, tokensUsed: 0 };
  }

  // Check staleness: skip if all servers already have non-expired descriptions
  const existing = db.listEnrichment({ source: 'mcp-discover' });
  const describedNames = new Set(existing.map(e => e.entityName));
  const needsUpdate = servers.some(s => !describedNames.has(s));
  if (!needsUpdate) {
    log.error(`[shadow:mcp-discover] All ${servers.length} servers already described — skipping`);
    return { serversDescribed: 0, serversTotal: servers.length, serverNames: servers, llmCalls: 0, tokensUsed: 0 };
  }

  // Build prompt
  const serverList = servers.map(s => `- ${s}`).join('\n');
  const prompt = [
    'You have access to MCP tool definitions in your context. Based ONLY on the tool',
    'schemas visible to you (names, descriptions, input schemas), describe each of',
    'these MCP servers:',
    '',
    serverList,
    '',
    'For each server, write a concise 1-sentence description of its purpose and capabilities.',
    'Count the tools you can see for each server (tool names are prefixed with mcp__{servername}__).',
    'Use the sanitized server name in tool prefixes (spaces become _, dots removed, etc.).',
    '',
    'If you cannot see any tools for a server, set description to null and toolCount to 0.',
    '',
    'Also assign a defaultTtl category for each server based on data volatility:',
    '- "volatile" (2h): monitoring, alerting, real-time metrics',
    '- "short" (12h): ticketing, PR state, CI/CD',
    '- "medium" (48h): project management, sprint tracking',
    '- "long" (7d): documentation, code search, architecture',
    '- "stable" (30d): org structure, team rosters, policies',
    '',
    'Also write an enrichmentHint for each server: a short sentence describing what kind of',
    'live data an enrichment agent could query from this server. Focus on what questions it can answer.',
    'Example: "Query active alerts, incidents, and deployment history by component name"',
    'Set enrichmentHint to null if the server only provides authentication or has no queryable tools.',
    '',
    'IMPORTANT: Do NOT call any tools. Only analyze the tool definitions visible in your context.',
    '',
    'Return JSON only:',
    '{ "servers": [{ "name": "exact server name", "description": "what it does", "toolCount": 0, "defaultTtl": "medium", "enrichmentHint": "what to query" }] }',
  ].join('\n');

  // Resolve configurable model
  const profile = db.ensureProfile();
  const prefs = profile.preferences as Record<string, unknown> | undefined;
  const prefModels = (prefs?.models ?? {}) as Record<string, string>;
  const model = prefModels.mcpDiscover ?? config.models.mcpDiscover;

  const adapter = selectAdapter(config);
  let llmCalls = 0;
  let tokensUsed = 0;
  let serversDescribed = 0;

  try {
    const result = await adapter.execute({
      repos: [],
      title: 'MCP Server Discovery',
      goal: 'Describe MCP servers from tool schemas',
      prompt,
      relevantMemories: [],
      model,
      effort: 'low',
      systemPrompt: null,       // No override — Claude sees MCP tool definitions
      allowedTools: ['mcp__*'], // All MCP tool schemas loaded into context
      timeoutMs: 60_000,
    });
    llmCalls++;
    tokensUsed += (result.inputTokens ?? 0) + (result.outputTokens ?? 0);
    db.recordLlmUsage({
      source: 'mcp_discover', sourceId: null, model,
      inputTokens: result.inputTokens ?? 0, outputTokens: result.outputTokens ?? 0,
    });

    if (result.status === 'success' && result.output) {
      const parseResult = safeParseJson(result.output, McpDiscoverResponseSchema, 'mcp-discover');
      if (parseResult.success) {
        for (const srv of parseResult.data.servers) {
          if (!srv.description) continue;
          const hash = contentHash(srv.name, srv.description);
          db.upsertEnrichment({
            source: 'mcp-discover',
            entityType: 'mcp-server',
            entityId: srv.name,
            entityName: srv.name,
            summary: srv.description,
            detail: { toolCount: srv.toolCount, defaultTtl: srv.defaultTtl, enrichmentHint: srv.enrichmentHint },
            contentHash: hash,
            expiresAt: new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString(), // 25h TTL
          });
          serversDescribed++;
        }
        log.error(`[shadow:mcp-discover] Described ${serversDescribed} servers`);
      } else {
        log.error(`[shadow:mcp-discover] Failed to parse response: ${!parseResult.success ? parseResult.error : 'unknown'}`);
      }
    }
  } catch (e) {
    log.error('[shadow:mcp-discover] LLM call failed:', e instanceof Error ? e.message : e);
  }

  // Expire stale entries
  db.expireStaleEnrichment();

  return { serversDescribed, serversTotal: servers.length, serverNames: servers, llmCalls, tokensUsed };
}
