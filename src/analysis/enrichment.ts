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
  dedupStats?: { created: number; updated: number };
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
  opts?: { existingCache?: string; runHistory?: string; sourceEffectiveness?: string },
): string {
  const { existingCache, runHistory, sourceEffectiveness } = opts ?? {};
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
    sourceEffectiveness ? '## Source effectiveness (based on past consumption)' : '',
    sourceEffectiveness ?? '',
    '',
    existingCache ? '## Already cached (do not re-query unless expiring within 2 hours)' : '',
    existingCache ?? '',
    existingCache ? 'Focus on discovering NEW context not listed above. Only refresh items expiring soon.' : '',
    '',
    runHistory ? '## Recent enrichment runs' : '',
    runHistory ?? '',
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
    existingCache ? '5. Do NOT re-query information already in the cache above.' : '',
    sourceEffectiveness ? '6. Prioritize high-value sources. Skip low-value sources unless you have a specific reason.' : '',
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

// --- Query History ---

function buildRunHistory(db: ShadowDatabase, projectId: string, limit = 3): string | undefined {
  const recentJobs = db.listJobs({ type: 'context-enrich', status: 'completed', limit });
  if (recentJobs.length === 0) return undefined;

  const lines: string[] = [];
  for (const job of recentJobs) {
    const result = job.result as Record<string, unknown> | null;
    const projectResults = (result?.projectResults ?? []) as Array<{
      projectId: string; projectName: string; dedupStats?: { created: number; updated: number }; sources: string[];
    }>;
    const pr = projectResults.find(p => p.projectId === projectId);
    if (!pr) continue;

    const ago = Math.round((Date.now() - new Date(job.finishedAt ?? job.startedAt).getTime()) / 3600000);
    const stats = pr.dedupStats;
    if (stats) {
      const sourceList = pr.sources.length > 0 ? pr.sources.join(', ') : 'none';
      lines.push(`- ${ago}h ago: ${stats.created} new, ${stats.updated} updated (sources: ${sourceList})`);
    } else {
      lines.push(`- ${ago}h ago: ${pr.sources.length > 0 ? pr.sources.join(', ') : 'no data'}`);
    }
  }

  return lines.length > 0 ? lines.join('\n') : undefined;
}

// --- Source Effectiveness ---

function buildSourceEffectiveness(db: ShadowDatabase, projectId: string): string | undefined {
  try {
    const rows = db.rawDb.prepare(`
      SELECT source, COUNT(*) as total,
        SUM(CASE WHEN access_count > 0 THEN 1 ELSE 0 END) as consumed
      FROM enrichment_cache WHERE entity_id = ? AND stale = 0
      GROUP BY source HAVING total >= 3
    `).all(projectId) as Array<{ source: string; total: number; consumed: number }>;

    if (rows.length === 0) return undefined;

    const lines = rows.map(r => {
      const pct = Math.round((r.consumed / r.total) * 100);
      const label = pct >= 60 ? 'high value' : pct >= 30 ? 'moderate' : 'low value — consider skipping';
      return `- ${r.source}: ${r.consumed}/${r.total} consumed (${pct}%) — ${label}`;
    });
    return lines.join('\n');
  } catch {
    return undefined;
  }
}

// --- TTL Intelligence ---

const TTL_TIERS: Array<{ maxRate: number; category: string }> = [
  { maxRate: 0.15, category: 'stable' },
  { maxRate: 0.35, category: 'long' },
  { maxRate: 0.60, category: 'medium' },
  { maxRate: 1.00, category: 'short' },
];

function analyzeTtlDrift(db: ShadowDatabase): void {
  try {
    const rows = db.rawDb.prepare(`
      SELECT source, SUM(refresh_count) as refreshes, SUM(change_count) as changes
      FROM enrichment_cache WHERE stale = 0 AND refresh_count > 0
      GROUP BY source
    `).all() as Array<{ source: string; refreshes: number; changes: number }>;

    for (const row of rows) {
      if (row.refreshes < 5) continue; // not enough data
      const changeRate = row.changes / row.refreshes;
      const optimal = TTL_TIERS.find(t => changeRate <= t.maxRate)?.category ?? 'medium';

      // Load mcp-discover metadata for this source
      const meta = db.listEnrichment({ source: 'mcp-discover' })
        .find(d => d.entityName === row.source);
      if (!meta) continue;

      const detail = meta.detail as Record<string, unknown>;
      const currentTtl = (detail.learnedTtl ?? detail.defaultTtl) as string | undefined;
      if (currentTtl === optimal) continue;

      // Update learned TTL
      const newDetail = { ...detail, learnedTtl: optimal };
      const { createHash } = require('node:crypto') as typeof import('node:crypto');
      const contentHash = createHash('sha256').update(`mcp-discover:${meta.summary}`).digest('hex').slice(0, 16);
      db.upsertEnrichment({
        source: 'mcp-discover',
        entityType: 'mcp-server',
        entityId: row.source,
        entityName: row.source,
        summary: meta.summary,
        detail: newDetail,
        contentHash,
      });
      console.error(`[shadow:enrich] TTL drift: ${row.source} ${currentTtl ?? 'default'}→${optimal} (change_rate=${changeRate.toFixed(2)}, ${row.changes}/${row.refreshes})`);
    }
  } catch (e) {
    console.error('[shadow:enrich] TTL analysis failed:', e instanceof Error ? e.message : e);
  }
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
    // Filter out disabled projects
    const disabledProjects = (prefs?.enrichmentDisabledProjects as string[] | undefined) ?? [];
    const lowerDisabled = disabledProjects.map(n => n.toLowerCase());
    const eligibleProjects = activeProjects.filter(p => !lowerDisabled.includes(p.projectName.toLowerCase()));
    if (eligibleProjects.length < activeProjects.length) {
      const skipped = activeProjects.filter(p => lowerDisabled.includes(p.projectName.toLowerCase())).map(p => p.projectName);
      console.error(`[shadow:enrich] Skipping disabled projects: ${skipped.join(', ')}`);
    }
    const projectResults: PerProjectResult[] = [];

    for (let i = 0; i < eligibleProjects.length; i++) {
      const ap = eligibleProjects[i];
      onProgress?.(ap.projectName, i + 1, eligibleProjects.length);
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

        // Build existing cache summary so the LLM knows what's already cached
        const cachedItems = db.listEnrichment({ entityId: project.id, limit: 20 });
        let existingCache: string | undefined;
        if (cachedItems.length > 0) {
          const lines = cachedItems.map(item => {
            const expires = item.expiresAt ? new Date(item.expiresAt).toISOString().slice(0, 16).replace('T', ' ') : 'no expiry';
            return `- [${item.source}] ${item.summary} (expires: ${expires})`;
          });
          existingCache = lines.join('\n');
        }

        const runHistory = buildRunHistory(db, project.id);
        const sourceEff = buildSourceEffectiveness(db, project.id);
        const prompt = buildEnrichPrompt(project.name, repoNames, systemNames, serverDescriptions, project.id, {
          existingCache, runHistory, sourceEffectiveness: sourceEff,
        });

        console.error(`[shadow:enrich] Starting enrichment for ${project.name} (${repoNames.length} repos, ${cachedItems.length} cached)`);

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
        const updatedItems = db.listEnrichment({ entityId: project.id, limit: 50 })
          .filter(i => i.updatedAt >= phaseStart && i.createdAt < phaseStart);
        pr.itemsCollected = newItems.length;
        pr.sources = [...new Set([...newItems, ...updatedItems].map(i => i.source))];
        pr.findings = newItems.map(i => ({ source: i.source, summary: i.summary }));
        pr.dedupStats = { created: newItems.length, updated: updatedItems.length };
        totalItems += pr.itemsCollected;

        console.error(`[shadow:enrich] ${project.name}: ${newItems.length} new, ${updatedItems.length} updated from ${pr.sources.join(', ') || 'no sources'}`);
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
    analyzeTtlDrift(db);
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

  // Track consumption for scoring
  for (const item of newItems) db.touchEnrichment(item.id);

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

  // Track consumption for scoring
  for (const item of valid) db.touchEnrichment(item.id);

  return valid.map(item => {
    const entityLabel = item.entityName ? ` (${item.entityType}: ${item.entityName})` : '';
    return `- [${item.source}]${entityLabel}: ${item.summary}`;
  }).join('\n');
}
