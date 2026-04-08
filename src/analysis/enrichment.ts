import type { ShadowConfig } from '../config/load-config.js';
import type { ShadowDatabase } from '../storage/database.js';
import { selectAdapter } from '../backend/index.js';
import { discoverMcpServerNames } from '../observation/mcp-discovery.js';

// --- Types ---

type ActiveProjectInput = { projectId: string; projectName: string; score: number };

type PerProjectResult = {
  projectId: string;
  projectName: string;
  itemsCollected: number;
  sources: string[];
  findings: Array<{ source: string; summary: string }>;
  error?: string;
};

type EnrichResult = {
  itemsCollected: number;
  llmCalls: number;
  tokensUsed: number;
  projectResults?: PerProjectResult[];
};

// --- Helpers ---

function buildServerDescriptions(db: ShadowDatabase, enabledServers: string[]): string {
  const descriptions = db.listEnrichment({ source: 'mcp-discover' });
  if (descriptions.length === 0) return 'No server descriptions available.';
  // Only include enabled servers
  const enabled = descriptions.filter(d => d.entityName && enabledServers.includes(d.entityName));
  if (enabled.length === 0) return 'No enabled servers with descriptions.';
  return enabled.map(d => {
    const detail = d.detail as Record<string, unknown> | undefined;
    const toolCount = detail?.toolCount as number | undefined;
    const ttl = detail?.defaultTtl as string | undefined;
    const hint = detail?.enrichmentHint as string | undefined;
    let line = `- **${d.entityName}**${toolCount ? ` (${toolCount} tools` : ''}${ttl ? `, TTL: ${ttl}` : ''}${toolCount ? ')' : ''}: ${d.summary}`;
    if (hint) line += `\n  → Enrichment: ${hint}`;
    return line;
  }).join('\n');
}

function buildEnrichPrompt(
  projectName: string,
  repoNames: string[],
  systemNames: string[],
  serverDescriptions: string,
  projectId: string,
): string {
  return [
    `You are Shadow's enrichment agent for project: ${projectName}`,
    '',
    '## Project',
    `ID: ${projectId}`,
    repoNames.length > 0 ? `Repos: ${repoNames.join(', ')}` : 'Repos: none',
    systemNames.length > 0 ? `Systems: ${systemNames.join(', ')}` : '',
    '',
    '## Available MCP servers',
    serverDescriptions,
    '',
    '## Tool usage',
    '- **shadow_*** tools: read Shadow\'s knowledge (memories, project details) and write results (shadow_enrichment_write).',
    '- **All other tools** (listed above with enrichment hints): query external live data. Read-only.',
    '',
    '## Instructions',
    '1. Use shadow_memory_search to find memories about this project —',
    '   tool configurations, service identifiers, channel names, workflows.',
    '2. You MUST query at least one external MCP server (non-shadow).',
    '   Use the enrichment hints above and what you learned from memories to make precise queries.',
    '3. For each useful finding, call shadow_enrichment_write with:',
    '   - projectId: the project ID shown above',
    '   - source: the name of the external MCP server you queried',
    '   - summary: a concise 1-2 sentence finding',
    '4. Skip external servers that are not relevant to this project.',
  ].filter(Boolean).join('\n');
}

function buildPostEnrichPrompt(findingSummaries: string): string {
  return [
    'You are Shadow\'s memory analyst. Review these enrichment findings and decide',
    'which contain STABLE KNOWLEDGE worth remembering across sessions.',
    '',
    '## Findings',
    findingSummaries,
    '',
    '## What to promote to memory',
    '- Facts that won\'t change soon: missing SLOs, architecture patterns, runbook locations,',
    '  service configurations, team conventions, deployment tools, infrastructure details',
    '- Use shadow_memory_teach with appropriate kind (workflow, team_knowledge, tech_stack)',
    '  and layer (core for permanent, warm for weeks, hot for days)',
    '- Link to the relevant project using entityType and entityId if applicable',
    '',
    '## What NOT to promote',
    '- Transient state: current alert status, today\'s deployments, active incidents, PR counts',
    '- Information already in existing memories (use shadow_memory_search to check first)',
    '',
    'Only call shadow_memory_teach if you find genuinely stable knowledge.',
    'If nothing is worth remembering, do nothing.',
  ].join('\n');
}

// --- Main ---

/**
 * Agent-based enrichment: single Opus call per active project.
 *
 * The LLM uses Shadow's MCP tools (memory search, project detail) to learn
 * domain context, then queries external MCP servers and writes findings
 * directly to the DB via shadow_enrichment_write.
 *
 * No JSON parsing needed — data flows through tool calls end-to-end.
 */
export async function activityEnrich(
  db: ShadowDatabase,
  config: ShadowConfig,
  activeProjects?: ActiveProjectInput[],
  onProgress?: (name: string, index: number, total: number) => void,
): Promise<EnrichResult> {
  const enrichStartTime = new Date().toISOString();
  const allServers = discoverMcpServerNames();
  const profile = db.ensureProfile();
  const prefs = profile.preferences as Record<string, unknown> | undefined;
  const disabledServers = (prefs?.enrichmentDisabledServers as string[] | undefined) ?? [];
  const mcpServers = allServers.filter(s => !disabledServers.includes(s));

  if (mcpServers.length === 0) {
    console.error(`[shadow:enrich] No enabled MCP servers (${allServers.length} discovered, ${disabledServers.length} disabled) — skipping`);
    return { itemsCollected: 0, llmCalls: 0, tokensUsed: 0 };
  }

  const adapter = selectAdapter(config);
  const prefModels = (prefs?.models ?? {}) as Record<string, string>;
  const model = prefModels.enrich ?? config.models.enrich;
  const prefEfforts = (prefs?.efforts ?? {}) as Record<string, string>;
  const effort = prefEfforts.enrich ?? config.efforts.enrich;
  const serverDescriptions = buildServerDescriptions(db, mcpServers);

  // Build per-server allowedTools wildcards (mcp__* alone doesn't grant tool-call permission)
  const sanitize = (name: string) => name.replace(/[^a-zA-Z0-9_]/g, '_');
  const mcpToolWildcards = mcpServers.map(s => `mcp__${sanitize(s)}__*`);

  let totalItems = 0;
  let totalLlmCalls = 0;
  let totalTokens = 0;

  // ========== PROJECT-SCOPED ENRICHMENT ==========
  if (activeProjects && activeProjects.length > 0) {
    const projectResults: PerProjectResult[] = [];

    for (let i = 0; i < activeProjects.length; i++) {
      const ap = activeProjects[i];
      onProgress?.(ap.projectName, i + 1, activeProjects.length);
      const pr: PerProjectResult = {
        projectId: ap.projectId, projectName: ap.projectName,
        itemsCollected: 0, sources: [], findings: [],
      };
      const phaseStart = new Date().toISOString();

      try {
        const project = db.getProject(ap.projectId);
        if (!project) { pr.error = 'project not found'; projectResults.push(pr); continue; }

        const repoNames = (project.repoIds ?? []).map(id => db.getRepo(id)?.name).filter(Boolean) as string[];
        const systemNames = (project.systemIds ?? []).map(id => db.getSystem(id)).filter(Boolean).map(s => `${s!.name} (${s!.kind})`) as string[];

        const prompt = buildEnrichPrompt(project.name, repoNames, systemNames, serverDescriptions, project.id);

        console.error(`[shadow:enrich] Starting enrichment for ${project.name} (${repoNames.length} repos)`);

        const result = await adapter.execute({
          repos: [],
          title: `Enrich: ${project.name}`,
          goal: `Gather external context for ${project.name} via MCP servers`,
          prompt,
          relevantMemories: [],
          model,
          effort,
          systemPrompt: null,       // LLM uses tools freely
          allowedTools: mcpToolWildcards, // Per-server wildcards for tool-call permission
        });
        totalLlmCalls++;
        totalTokens += (result.inputTokens ?? 0) + (result.outputTokens ?? 0);
        db.recordLlmUsage({
          source: 'enrichment', sourceId: project.id, model,
          inputTokens: result.inputTokens ?? 0, outputTokens: result.outputTokens ?? 0,
        });

        // Count items written via shadow_enrichment_write during this execution
        const newItems = db.listEnrichment({ entityId: project.id, createdSince: phaseStart, limit: 50 });
        pr.itemsCollected = newItems.length;
        pr.sources = [...new Set(newItems.map(i => i.source))];
        pr.findings = newItems.map(i => ({ source: i.source, summary: i.summary }));
        totalItems += pr.itemsCollected;

        console.error(`[shadow:enrich] ${project.name}: ${pr.itemsCollected} items from ${pr.sources.join(', ') || 'no sources'}`);
      } catch (e) {
        pr.error = e instanceof Error ? e.message : String(e);
        console.error(`[shadow:enrich] Project ${ap.projectName} failed:`, pr.error);
      }

      projectResults.push(pr);
    }

    // ========== POST-ENRICHMENT: promote stable findings to memory ==========
    if (totalItems > 0) {
      try {
        const allNewFindings = db.listEnrichment({ createdSince: enrichStartTime, limit: 50 });
        const findingSummaries = allNewFindings
          .map(f => `[${f.source}] (${f.entityName}): ${f.summary}`)
          .join('\n');

        if (findingSummaries) {
          console.error(`[shadow:enrich] Post-analysis: reviewing ${allNewFindings.length} findings for stable knowledge`);
          const postResult = await adapter.execute({
            repos: [],
            title: 'Enrichment: memory analysis',
            goal: 'Promote stable findings to long-term memory',
            prompt: buildPostEnrichPrompt(findingSummaries),
            relevantMemories: [],
            model,
            effort,
            systemPrompt: null,
            allowedTools: ['mcp__shadow__*'],
          });
          totalLlmCalls++;
          totalTokens += (postResult.inputTokens ?? 0) + (postResult.outputTokens ?? 0);
          db.recordLlmUsage({
            source: 'enrichment_post', sourceId: null, model,
            inputTokens: postResult.inputTokens ?? 0, outputTokens: postResult.outputTokens ?? 0,
          });
        }
      } catch (e) {
        console.error('[shadow:enrich] Post-analysis failed:', e instanceof Error ? e.message : e);
      }
    }

    db.expireStaleEnrichment();
    return { itemsCollected: totalItems, llmCalls: totalLlmCalls, tokensUsed: totalTokens, projectResults };
  }

  // ========== GENERIC ENRICHMENT (fallback — no active projects) ==========
  const projects = db.listProjects({ status: 'active' });
  const repos = db.listRepos();

  const allRepoNames = repos.slice(0, 10).map(r => r.name);
  const allProjectNames = projects.map(p => p.name);

  const prompt = [
    'You are Shadow\'s enrichment agent.',
    '',
    '## Context',
    allProjectNames.length > 0 ? `Projects: ${allProjectNames.join(', ')}` : '',
    `Repos: ${allRepoNames.join(', ')}`,
    '',
    '## Available MCP servers',
    serverDescriptions,
    '',
    '## Instructions',
    '1. Use shadow_memory_search to find memories about tools, workflows, JIRA projects.',
    '2. Decide which MCP servers are relevant and query them.',
    '3. For each useful finding, call shadow_enrichment_write with the relevant projectId.',
    '   Use shadow_projects to find project IDs if needed.',
    '4. Skip MCP servers that are not relevant.',
    '',
    'Focus on external context you cannot learn from the codebase.',
    'Do NOT read local files or code — only use MCP tools.',
  ].filter(Boolean).join('\n');

  const phaseStart = new Date().toISOString();

  try {
    const result = await adapter.execute({
      repos: [], title: 'Enrichment', goal: 'Gather external context via MCP servers',
      prompt, relevantMemories: [], model, effort,
      systemPrompt: null, allowedTools: ['mcp__*'],
    });
    totalLlmCalls++;
    totalTokens += (result.inputTokens ?? 0) + (result.outputTokens ?? 0);
    db.recordLlmUsage({
      source: 'enrichment', sourceId: null, model,
      inputTokens: result.inputTokens ?? 0, outputTokens: result.outputTokens ?? 0,
    });

    const newItems = db.listEnrichment({ createdSince: phaseStart, limit: 50 });
    totalItems = newItems.length;
    console.error(`[shadow:enrich] Generic enrichment: ${totalItems} items from ${new Set(newItems.map(i => i.source)).size} sources`);
  } catch (e) {
    console.error('[shadow:enrich] Generic enrichment failed:', e instanceof Error ? e.message : e);
  }

  db.expireStaleEnrichment();
  return { itemsCollected: totalItems, llmCalls: totalLlmCalls, tokensUsed: totalTokens };
}

/**
 * Build enrichment context string for heartbeat prompts.
 * Returns context + item IDs. Caller must mark as reported after successful use.
 */
export function buildEnrichmentContext(db: ShadowDatabase): { context: string; itemIds: string[] } | undefined {
  const newItems = db.listNewEnrichment(10);
  if (newItems.length === 0) return undefined;

  const lines = newItems.map(item => {
    const entityLabel = item.entityName ? ` (${item.entityType}: ${item.entityName})` : '';
    return `- [${item.source}]${entityLabel}: ${item.summary}`;
  });

  return { context: lines.join('\n'), itemIds: newItems.map(item => item.id) };
}

/**
 * Get enrichment summary for injection into prompts.
 * Does NOT mark as reported — reusable by multiple consumers.
 */
export function getEnrichmentSummary(
  db: ShadowDatabase,
  opts?: { projectId?: string; entityType?: string; limit?: number },
): string | undefined {
  const items = db.listEnrichment({
    entityType: opts?.entityType,
    entityId: opts?.projectId,
    limit: opts?.limit ?? 10,
  });

  // Filter out expired items
  const now = new Date().toISOString();
  const valid = items.filter(i => !i.expiresAt || i.expiresAt > now);

  if (valid.length === 0) return undefined;

  return valid.map(item => {
    const entityLabel = item.entityName ? ` (${item.entityType}: ${item.entityName})` : '';
    return `- [${item.source}]${entityLabel}: ${item.summary}`;
  }).join('\n');
}
