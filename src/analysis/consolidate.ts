import type { ObjectivePack } from '../backend/types.js';

import { maintainMemoryLayers } from '../memory/layers.js';
import { checkMemoryDuplicate } from '../memory/dedup.js';
import { generateAndStoreEmbedding } from '../memory/lifecycle.js';
import { selectAdapter } from '../backend/index.js';

import type { HeartbeatContext } from './state-machine.js';
import { getModel } from './shared.js';

export async function activityConsolidate(
  ctx: HeartbeatContext,
): Promise<{ memoriesPromoted: number; memoriesDemoted: number; memoriesExpired: number; llmCalls: number; tokensUsed: number }> {
  // Step 1: Run the programmatic memory layer maintenance
  const layerResult = maintainMemoryLayers(ctx.db);

  let llmCalls = 0;
  let tokensUsed = 0;

  // Step 2: Optionally synthesize meta-patterns via LLM if enough hot memories exist
  const hotMemories = ctx.db.listMemories({ layer: 'hot', archived: false });

  if (hotMemories.length >= 10) {
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
        try {
          const parsed = JSON.parse(result.output) as {
            metaPatterns?: Array<{
              title?: string;
              bodyMd?: string;
              confidence?: number;
              tags?: string[];
            }>;
          };

          if (parsed.metaPatterns && Array.isArray(parsed.metaPatterns)) {
            for (const pattern of parsed.metaPatterns) {
              if (!pattern.title || !pattern.bodyMd) continue;

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
        } catch (e) {
          console.error('[shadow:consolidate] Failed to parse LLM output:', e instanceof Error ? e.message : e);
        }
      }
    } catch (e) {
      console.error('[shadow:consolidate] LLM call failed:', e instanceof Error ? e.message : e);
    }
  }

  return {
    memoriesPromoted: layerResult.promoted,
    memoriesDemoted: layerResult.demoted,
    memoriesExpired: layerResult.expired,
    llmCalls,
    tokensUsed,
  };
}
