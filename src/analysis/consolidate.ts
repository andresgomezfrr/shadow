import { z } from 'zod';
import type { ObjectivePack } from '../backend/types.js';
import type { MemoryRecord } from '../storage/models.js';

import { maintainMemoryLayers } from '../memory/layers.js';
import { checkMemoryDuplicate } from '../memory/dedup.js';
import { generateAndStoreEmbedding } from '../memory/lifecycle.js';
import { selectAdapter } from '../backend/index.js';
import { safeParseJson } from '../backend/json-repair.js';
import { DEPTH_ELIGIBLE_KINDS } from '../profile/bond.js';
import { budgetSkipIfExceeded } from './budget.js';

import type { HeartbeatContext } from './state-machine.js';
import { getModel } from './shared.js';

const MetaPatternSchema = z.object({
  title: z.string().min(1),
  bodyMd: z.string().min(10),
  confidence: z.number().min(0).max(100).optional(),
  tags: z.array(z.string()).optional(),
});

const ConsolidateSchema = z.object({
  metaPatterns: z.array(MetaPatternSchema).default([]),
});

const KnowledgeSummaryLLMSchema = z.object({
  summary: z.string().min(100),
  themes: z.array(z.string().min(2)).min(2),
  highlights: z.array(z.object({
    title: z.string().min(1),
    why: z.string().min(1),
  })).min(3).max(7),
  entities: z.array(z.object({
    type: z.enum(['repo', 'project', 'system', 'contact']),
    id: z.string(),
  })).optional(),
});

type KnowledgeSummaryAction = 'created' | 'merged' | 'skipped';

export type KnowledgeSummaryResult = {
  action: KnowledgeSummaryAction;
  memoryId?: string;
  reason?: string;
  themes?: string[];
  llmCalls?: number;
  tokensUsed?: number;
  clustered?: { checked: number; merged: number };
};

const KNOWLEDGE_SUMMARY_MIN_NEW = 10;
const CLUSTER_MERGE_SIMILARITY = 0.80;
const CLUSTER_MERGE_HOUR = 3;

export async function activityConsolidate(
  ctx: HeartbeatContext,
): Promise<{ memoriesPromoted: number; memoriesDemoted: number; memoriesExpired: number; llmCalls: number; tokensUsed: number; knowledgeSummary: KnowledgeSummaryResult }> {
  // Step 1: Run the programmatic memory layer maintenance
  const layerResult = maintainMemoryLayers(ctx.db);

  let llmCalls = 0;
  let tokensUsed = 0;

  // Step 2: Optionally synthesize meta-patterns via LLM if enough hot memories exist.
  // Skipped entirely if the daily token budget is exhausted (audit A-10) — layer
  // maintenance above still runs since it's purely DB work.
  const hotMemories = ctx.db.listMemories({ layer: 'hot', archived: false });
  const budgetSkip = budgetSkipIfExceeded(ctx.db, 'consolidate-meta-patterns');

  if (!budgetSkip && hotMemories.length >= 10) {
    const memorySummaries = hotMemories.slice(0, 20).map((mem) =>
      `- [${mem.kind}] ${mem.title}: ${mem.bodyMd.slice(0, 150)}`,
    ).join('\n');

    const prompt = [
      'Review the following high-priority memories and synthesize any meta-patterns or overarching themes.',
      'If you find a meta-pattern, return JSON:',
      '{ "metaPatterns": [{ "title": string, "bodyMd": string, "confidence": number, "tags": string[] }] }',
      'If no meta-patterns found, return: { "metaPatterns": [] }',
      '',
      '## Hot Memories',
      memorySummaries,
      '',
      'Respond with JSON only.',
    ].join('\n');

    const pack: ObjectivePack = {
      repos: [],
      title: 'Memory Consolidation',
      goal: 'Synthesize meta-patterns from accumulated memories',
      prompt,
      relevantMemories: hotMemories.slice(0, 20),
      model: getModel(ctx, 'consolidate'),
      timeoutMs: ctx.config.analysisTimeoutMs,
    };

    try {
      const adapter = selectAdapter(ctx.config);
      const result = await adapter.execute(pack);
      llmCalls = 1;
      tokensUsed = (result.inputTokens ?? 0) + (result.outputTokens ?? 0);

      ctx.db.recordLlmUsage({
        source: 'heartbeat_consolidate',
        sourceId: null,
        model: getModel(ctx, 'consolidate'),
        inputTokens: result.inputTokens ?? 0,
        outputTokens: result.outputTokens ?? 0,
      });

      if (result.status === 'success' && result.output) {
        const parsed = safeParseJson(result.output, ConsolidateSchema, 'consolidate');
        if (!parsed.success) {
          console.error('[shadow:consolidate] Failed to parse LLM output — skipping meta-pattern detection this tick');
        } else {
          for (const pattern of parsed.data.metaPatterns) {
            try {
                // Semantic dedup: check if a similar meta_pattern already exists
                const decision = await checkMemoryDuplicate(ctx.db, {
                  kind: 'meta_pattern', title: pattern.title, bodyMd: pattern.bodyMd,
                });
                if (decision.action === 'skip') {
                  console.error(`[shadow:consolidate] Skip duplicate meta_pattern: ${pattern.title}`);
                  continue;
                }
                if (decision.action === 'update') {
                  ctx.db.mergeMemoryBody(decision.existingId, pattern.bodyMd, pattern.tags);
                  const merged = ctx.db.getMemory(decision.existingId);
                  if (merged) {
                    await generateAndStoreEmbedding(ctx.db, 'memory', merged.id, { kind: merged.kind, title: merged.title, bodyMd: merged.bodyMd });
                  }
                  console.error(`[shadow:consolidate] Updated existing meta_pattern: ${pattern.title}`);
                  continue;
                }

                const metaMem = ctx.db.createMemory({
                  layer: 'core',
                  scope: 'global',
                  kind: 'meta_pattern',
                  title: pattern.title,
                  bodyMd: pattern.bodyMd,
                  tags: pattern.tags ?? [],
                  sourceType: 'consolidate',
                  confidenceScore: pattern.confidence ?? 80,
                  relevanceScore: 0.8,
                });
                await generateAndStoreEmbedding(ctx.db, 'memory', metaMem.id, { kind: 'meta_pattern', title: metaMem.title, bodyMd: metaMem.bodyMd });

                // Archive hot memories that are semantically covered by this meta_pattern
                const { vectorSearch } = await import('../memory/search.js');
                const similar = await vectorSearch({
                  db: ctx.db.rawDb, text: pattern.title + ' ' + pattern.bodyMd,
                  vecTable: 'memory_vectors', limit: 10,
                });
                for (const match of similar) {
                  if (match.id === metaMem.id) continue; // Don't archive itself
                  if (match.similarity < 0.65) break; // Below threshold
                  const mem = ctx.db.getMemory(match.id);
                  if (!mem || mem.layer !== 'hot') continue; // Only archive hot sources
                  ctx.db.updateMemory(mem.id, { archivedAt: new Date().toISOString() });
                  ctx.db.deleteEmbedding('memory_vectors', mem.id);
                  ctx.db.createFeedback({ targetKind: 'memory', targetId: mem.id, action: 'consolidated', note: `merged into meta_pattern: ${pattern.title}` });
                  console.error(`[shadow:consolidate] Archived hot source: ${mem.title}`);
                }
            } catch (e) {
              console.error(`[shadow:consolidate] Meta-pattern failed: ${pattern.title}:`, e instanceof Error ? e.message : e);
            }
          }
        }
      }
    } catch (e) {
      console.error('[shadow:consolidate] LLM call failed:', e instanceof Error ? e.message : e);
    }
  }

  // Step 3: Synthesize knowledge_summary (narrative present-state memory)
  const knowledgeSummary: KnowledgeSummaryResult = await synthesizeKnowledgeSummary(ctx).catch((e) => {
    console.error('[shadow:consolidate] knowledgeSummary synthesis failed:', e instanceof Error ? e.message : e);
    return { action: 'skipped', reason: 'error during synthesis' };
  });
  llmCalls += knowledgeSummary.llmCalls ?? 0;
  tokensUsed += knowledgeSummary.tokensUsed ?? 0;

  // Step 4: Cluster-merge similar knowledge_summary memories (gated to low-traffic hour)
  if (shouldRunClusterMerge()) {
    try {
      const clustered = await clusterMergeKnowledgeSummaries(ctx);
      if (clustered.merged > 0) {
        knowledgeSummary.clustered = clustered;
      }
    } catch (e) {
      console.error('[shadow:consolidate] cluster merge failed:', e instanceof Error ? e.message : e);
    }
  }

  return {
    memoriesPromoted: layerResult.promoted,
    memoriesDemoted: layerResult.demoted,
    memoriesExpired: layerResult.expired,
    llmCalls,
    tokensUsed,
    knowledgeSummary,
  };
}

// ---------------------------------------------------------------------------
// knowledge_summary synthesis (audit F-14 phase 1)
//
// A narrative summary of what Shadow currently understands about the user's
// world — semantically distinct from meta_patterns (those describe emergent
// patterns) and digests (those describe events). Gated by a minimum of 10
// new durable memories since the last summary; skipped otherwise.
// ---------------------------------------------------------------------------

async function synthesizeKnowledgeSummary(ctx: HeartbeatContext): Promise<KnowledgeSummaryResult> {
  const budgetSkip = budgetSkipIfExceeded(ctx.db, 'consolidate-knowledge-summary');
  if (budgetSkip) {
    return { action: 'skipped', reason: budgetSkip.reason };
  }

  const [previousSummary] = ctx.db.listMemories({
    kind: 'knowledge_summary',
    archived: false,
    limit: 1,
  });

  const sinceIso = previousSummary?.createdAt ?? ctx.profile.bondResetAt ?? '1970-01-01T00:00:00Z';
  const depthPlaceholders = DEPTH_ELIGIBLE_KINDS.map(() => '?').join(',');
  const newCountRow = ctx.db.rawDb
    .prepare(
      `SELECT COUNT(*) AS n FROM memories
       WHERE archived_at IS NULL
         AND created_at > ?
         AND kind IN (${depthPlaceholders})`,
    )
    .get(sinceIso, ...DEPTH_ELIGIBLE_KINDS) as { n: number };

  if (newCountRow.n < KNOWLEDGE_SUMMARY_MIN_NEW) {
    return {
      action: 'skipped',
      reason: `only ${newCountRow.n} durable memories new since last (need ${KNOWLEDGE_SUMMARY_MIN_NEW})`,
    };
  }

  const fourteenDaysAgo = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const recentDurable: MemoryRecord[] = [];
  for (const kind of DEPTH_ELIGIBLE_KINDS) {
    const rows = ctx.db.listMemories({
      kind,
      archived: false,
      createdSince: fourteenDaysAgo,
      limit: 50,
    });
    recentDurable.push(...rows);
  }
  recentDurable.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const recent50 = recentDurable.slice(0, 50);

  const topAccessedRows = ctx.db.rawDb
    .prepare(
      `SELECT id FROM memories
       WHERE archived_at IS NULL
         AND kind IN (${depthPlaceholders})
       ORDER BY access_count DESC, last_accessed_at DESC
       LIMIT 20`,
    )
    .all(...DEPTH_ELIGIBLE_KINDS) as { id: string }[];

  const seenIds = new Set(recent50.map((m) => m.id));
  const topAccessed: MemoryRecord[] = [];
  for (const row of topAccessedRows) {
    if (seenIds.has(row.id)) continue;
    const mem = ctx.db.getMemory(row.id);
    if (mem) {
      topAccessed.push(mem);
      seenIds.add(mem.id);
    }
  }

  const inputMemories = [...recent50, ...topAccessed];
  const memoryLines = inputMemories
    .map((m) => `- [${m.kind}] ${m.title}: ${m.bodyMd.slice(0, 180)}`)
    .join('\n');

  const previousBlock = previousSummary
    ? `\n## Previous summary (for continuity)\n${previousSummary.bodyMd.slice(0, 800)}\n`
    : '';

  const prompt = [
    "You are Shadow, consolidating your knowledge of this user's world.",
    '',
    'You have access to memories spanning recent interactions, stable patterns,',
    'durable knowledge about their repos, workflows, tech stack, decisions,',
    'and architectural choices.',
    '',
    'Your task: produce a NARRATIVE SUMMARY of what you currently understand',
    "about the user's environment at this moment in time.",
    '',
    'CRITICAL boundaries:',
    '- DO NOT list events that happened (daily/weekly digests exist for that)',
    "- DO NOT repeat meta-patterns already synthesized (memory kind='meta_pattern')",
    '- DO focus on the present knowledge state: how you understand their systems,',
    "  what decisions they've made, what their current focus is, what stable",
    "  preferences you've observed",
    '- Write as if describing a colleague to a new team member — not a dry listing',
    '',
    '## Memories input',
    memoryLines,
    previousBlock,
    'Respond ONLY with JSON:',
    '{',
    '  "summary": "<narrative paragraph, 150-400 words>",',
    '  "themes": ["<short theme>", ...],',
    '  "highlights": [',
    '    {"title": "<one-line headline>", "why": "<why this matters>"},',
    '    ...',
    '  ],',
    '  "entities": [{"type": "repo|project|system|contact", "id": "<uuid>"}, ...]',
    '}',
  ].join('\n');

  const pack: ObjectivePack = {
    repos: [],
    title: 'Knowledge Summary Synthesis',
    goal: "Synthesize a narrative summary of the user's present knowledge state",
    prompt,
    relevantMemories: inputMemories,
    model: getModel(ctx, 'consolidate'),
    timeoutMs: ctx.config.analysisTimeoutMs,
  };

  const adapter = selectAdapter(ctx.config);
  const result = await adapter.execute(pack);
  const llmCalls = 1;
  const tokensUsed = (result.inputTokens ?? 0) + (result.outputTokens ?? 0);

  ctx.db.recordLlmUsage({
    source: 'heartbeat_consolidate_summary',
    sourceId: null,
    model: getModel(ctx, 'consolidate'),
    inputTokens: result.inputTokens ?? 0,
    outputTokens: result.outputTokens ?? 0,
  });

  if (result.status !== 'success' || !result.output) {
    return { action: 'skipped', reason: 'llm call failed', llmCalls, tokensUsed };
  }

  const parsed = safeParseJson(result.output, KnowledgeSummaryLLMSchema, 'knowledge-summary');
  if (!parsed.success) {
    return { action: 'skipped', reason: 'llm output parse failed', llmCalls, tokensUsed };
  }

  const { summary, themes, highlights, entities } = parsed.data;

  // Validate entities against DB — filter hallucinated uuids
  const validEntities = filterValidEntities(ctx, entities ?? []);

  // Build body (narrative + themes + highlights)
  const highlightLines = highlights.map((h) => `- **${h.title}** — ${h.why}`).join('\n');
  const title = `Knowledge summary — ${new Date().toISOString().slice(0, 10)} (${themes.slice(0, 3).join(' · ')})`;
  const bodyMd = [
    summary.trim(),
    '',
    '## Themes',
    themes.map((t) => `- ${t}`).join('\n'),
    '',
    '## Highlights',
    highlightLines,
  ].join('\n');

  const decision = await checkMemoryDuplicate(ctx.db, { kind: 'knowledge_summary', title, bodyMd });
  if (decision.action === 'skip') {
    return { action: 'skipped', reason: 'duplicate of existing summary', llmCalls, tokensUsed };
  }

  if (decision.action === 'update') {
    ctx.db.mergeMemoryBody(decision.existingId, bodyMd, themes);
    const merged = ctx.db.getMemory(decision.existingId);
    if (merged) {
      await generateAndStoreEmbedding(ctx.db, 'memory', merged.id, {
        kind: merged.kind, title: merged.title, bodyMd: merged.bodyMd,
      });
    }
    return { action: 'merged', memoryId: decision.existingId, themes, llmCalls, tokensUsed };
  }

  const mem = ctx.db.createMemory({
    layer: 'core',
    scope: 'global',
    kind: 'knowledge_summary',
    title,
    bodyMd,
    tags: themes,
    sourceType: 'consolidate',
    confidenceScore: 85,
    relevanceScore: 0.9,
  });
  if (validEntities.length > 0) {
    ctx.db.updateMemory(mem.id, { entities: validEntities });
  }
  await generateAndStoreEmbedding(ctx.db, 'memory', mem.id, {
    kind: 'knowledge_summary', title: mem.title, bodyMd: mem.bodyMd,
  });

  return { action: 'created', memoryId: mem.id, themes, llmCalls, tokensUsed };
}

// ---------------------------------------------------------------------------
// Cluster merge between knowledge_summary memories (audit F-14 phase 2)
//
// As new summaries accumulate, nearby summaries (similarity > 0.80) should
// collapse into the older one to preserve the timeline while consolidating
// redundant narrative. Gated to local hour 3 (~1/day on a 6h consolidate
// cadence) to amortize cost.
// ---------------------------------------------------------------------------

function shouldRunClusterMerge(now: Date = new Date()): boolean {
  return now.getHours() === CLUSTER_MERGE_HOUR;
}

async function clusterMergeKnowledgeSummaries(
  ctx: HeartbeatContext,
): Promise<{ checked: number; merged: number }> {
  const { vectorSearch } = await import('../memory/search.js');
  const summaries = ctx.db.listMemories({ kind: 'knowledge_summary', archived: false });
  if (summaries.length < 3) return { checked: summaries.length, merged: 0 };

  // Oldest first — so newer duplicates merge into older anchors.
  summaries.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const archived = new Set<string>();
  let merged = 0;

  for (const anchor of summaries) {
    if (archived.has(anchor.id)) continue;

    const matches = await vectorSearch({
      db: ctx.db.rawDb,
      text: anchor.title + '\n' + anchor.bodyMd.slice(0, 500),
      vecTable: 'memory_vectors',
      limit: 10,
    });

    for (const match of matches) {
      if (match.id === anchor.id) continue;
      if (archived.has(match.id)) continue;
      if (match.similarity < CLUSTER_MERGE_SIMILARITY) break;

      const candidate = ctx.db.getMemory(match.id);
      if (!candidate || candidate.kind !== 'knowledge_summary') continue;
      if (candidate.archivedAt) continue;
      if (candidate.createdAt <= anchor.createdAt) continue;

      ctx.db.mergeMemoryBody(anchor.id, candidate.bodyMd, candidate.tags);
      ctx.db.updateMemory(candidate.id, { archivedAt: new Date().toISOString() });
      ctx.db.deleteEmbedding('memory_vectors', candidate.id);
      ctx.db.createFeedback({
        targetKind: 'memory',
        targetId: candidate.id,
        action: 'consolidated',
        note: `merged into sibling knowledge_summary ${anchor.id.slice(0, 8)}`,
      });

      const updatedAnchor = ctx.db.getMemory(anchor.id);
      if (updatedAnchor) {
        await generateAndStoreEmbedding(ctx.db, 'memory', updatedAnchor.id, {
          kind: updatedAnchor.kind, title: updatedAnchor.title, bodyMd: updatedAnchor.bodyMd,
        });
      }

      archived.add(candidate.id);
      merged += 1;
    }
  }

  return { checked: summaries.length, merged };
}

function filterValidEntities(
  ctx: HeartbeatContext,
  entities: Array<{ type: 'repo' | 'project' | 'system' | 'contact'; id: string }>,
): Array<{ type: string; id: string }> {
  if (entities.length === 0) return [];
  const tableByType: Record<string, string> = {
    repo: 'repos', project: 'projects', system: 'systems', contact: 'contacts',
  };
  const valid: Array<{ type: string; id: string }> = [];
  for (const e of entities) {
    const table = tableByType[e.type];
    if (!table) continue;
    try {
      const row = ctx.db.rawDb.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(e.id);
      if (row) valid.push({ type: e.type, id: e.id });
    } catch { /* ignore */ }
  }
  return valid;
}
