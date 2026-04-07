import type { ShadowDatabase } from '../storage/database.js';
import type { EntityLink, MemoryRecord, MemorySearchResult } from '../storage/models.js';
import type { ShadowConfig } from '../config/schema.js';
import { embed } from './embeddings.js';
import { generateAndStoreEmbedding } from './lifecycle.js';
import { selectAdapter } from '../backend/index.js';
import { safeParseJson } from '../backend/json-repair.js';
import { z } from 'zod';

/**
 * Search memories by text query using FTS5.
 * Delegates directly to db.searchMemories() which handles BM25 ranking.
 */
export function searchMemories(
  db: ShadowDatabase,
  query: string,
  options?: {
    layer?: string;
    scope?: string;
    repoId?: string;
    limit?: number;
  },
): MemorySearchResult[] {
  return db.searchMemories(query, options);
}

/**
 * Extract meaningful search terms from a file path.
 * e.g. "src/auth/handler.ts" → ["auth", "handler"]
 */
function extractTermsFromPath(filePath: string): string[] {
  return filePath
    .replace(/\\/g, '/')
    .split('/')
    .flatMap((segment) => {
      // Strip file extension
      const name = segment.replace(/\.[^.]+$/, '');
      // Split camelCase and kebab-case/snake_case
      return name
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .split(/[-_\s]+/)
        .map((t) => t.toLowerCase())
        .filter((t) => t.length > 2);
    })
    // Filter out common noise segments
    .filter((t) => !['src', 'lib', 'dist', 'build', 'index', 'test', 'tests', 'spec', 'node_modules'].includes(t));
}

/**
 * Find memories relevant to a set of file paths and/or topics.
 * Builds an FTS5 query from the context and returns ranked results.
 * Touches each returned memory to track usage.
 */
export function findRelevantMemories(
  db: ShadowDatabase,
  context: {
    filePaths?: string[];
    topics?: string[];
    repoId?: string;
  },
  limit?: number,
  touch = true,
): MemoryRecord[] {
  const terms = new Set<string>();

  if (context.filePaths) {
    for (const fp of context.filePaths) {
      for (const term of extractTermsFromPath(fp)) {
        terms.add(term);
      }
    }
  }

  if (context.topics) {
    for (const topic of context.topics) {
      const cleaned = topic.trim().toLowerCase();
      if (cleaned.length > 0) {
        terms.add(cleaned);
      }
    }
  }

  if (terms.size === 0) {
    return [];
  }

  // Build FTS5 query: OR between all terms
  const ftsQuery = [...terms].join(' OR ');

  const results = db.searchMemories(ftsQuery, {
    repoId: context.repoId,
    limit: limit ?? 10,
  });

  const memories = results.map((r) => r.memory);

  // Touch memories only for user-facing searches, not internal heartbeat lookups
  if (touch) {
    touchMemories(
      db,
      memories.map((m) => m.id),
    );
  }

  return memories;
}

/**
 * Touch (increment access count) for all provided memory IDs.
 * Call this after injecting memories into a prompt to track usage.
 */
export function touchMemories(db: ShadowDatabase, memoryIds: string[]): void {
  for (const id of memoryIds) {
    db.touchMemory(id);
  }
}

/**
 * Load pending corrections and format them as a prompt section.
 * Corrections override any other information and MUST be respected by LLM prompts.
 * Optionally filters by entity overlap when entities are provided.
 */
export function loadPendingCorrections(
  db: ShadowDatabase,
  entities?: EntityLink[],
): string {
  const corrections = db.listMemories({ kind: 'correction', archived: false, limit: 50 });
  if (corrections.length === 0) return '';

  const relevant = entities
    ? corrections.filter(c => {
        const cEntities = c.entities;
        return cEntities.length === 0 || cEntities.some(ce =>
          entities.some(e => ce.type === e.type && ce.id === e.id)
        );
      })
    : corrections;

  if (relevant.length === 0) return '';

  const lines = relevant.map(c => {
    const scope = c.entities.map(e => e.type).join(', ');
    return `- ${scope ? `[${scope}] ` : ''}${c.bodyMd}`;
  });

  return `## Pending Corrections (these OVERRIDE any other information — MUST be respected)\n${lines.join('\n')}\n`;
}

/**
 * Enforce corrections by finding semantically similar memories that contradict them.
 * Uses LLM to decide whether each candidate should be archived, edited, or kept.
 * After processing, the correction memory is promoted to kind 'taught' (consumed).
 */
export async function enforceCorrections(
  db: ShadowDatabase,
  config: ShadowConfig,
): Promise<{ processed: number; archived: number; edited: number }> {
  // Process oldest corrections first so later refinements prevail
  const corrections = db.listMemories({ kind: 'correction', archived: false, limit: 50 }).reverse();
  if (corrections.length === 0) return { processed: 0, archived: 0, edited: 0 };

  let archived = 0;
  let edited = 0;

  for (const correction of corrections) {
    const corrEntities = correction.entities;

    // Find semantically similar memories via vector search
    let queryEmbedding: Float32Array;
    try {
      queryEmbedding = await embed(`${correction.title} ${correction.bodyMd}`);
    } catch {
      continue; // skip if embedding fails
    }

    let similar: Array<{ id: string; distance: number }>;
    try {
      similar = db.rawDb
        .prepare('SELECT id, distance FROM memory_vectors WHERE embedding MATCH ? ORDER BY distance LIMIT 20')
        .all(queryEmbedding) as Array<{ id: string; distance: number }>;
    } catch {
      continue;
    }

    // Find contradicting memories
    const candidates: Array<{ id: string; title: string; bodyMd: string; similarity: number }> = [];
    for (const row of similar) {
      if (row.id === correction.id) continue;
      const similarity = 1 - (row.distance * row.distance) / 2;
      if (similarity < 0.5) break;

      const mem = db.getMemory(row.id);
      if (!mem || mem.kind === 'correction' || mem.kind === 'soul_reflection' || mem.archivedAt) continue;

      // Check entity overlap
      const memEntities = mem.entities;
      const overlap = corrEntities.length === 0 || corrEntities.some(ce =>
        memEntities.some(me => ce.type === me.type && ce.id === me.id)
      );
      if (!overlap && corrEntities.length > 0) continue;

      candidates.push({ id: mem.id, title: mem.title, bodyMd: mem.bodyMd, similarity });
    }

    // Ask LLM to decide for each candidate
    if (candidates.length > 0) {
      const adapter = selectAdapter(config);
      const prompt = `You are evaluating memories for contradictions with a user correction.

CORRECTION (this is the truth):
Title: ${correction.title}
Content: ${correction.bodyMd}

MEMORIES TO EVALUATE:
${candidates.map((c, i) => `[${i}] "${c.title}": ${c.bodyMd}`).join('\n\n')}

For each memory, decide:
- "archive" if it contradicts the correction and should be removed
- "edit" if it's mostly correct but contains the wrong information — provide corrected text
- "keep" if it doesn't actually contradict the correction

Respond with JSON: { "decisions": [{ "index": number, "action": "archive" | "edit" | "keep", "reason": string, "editedBody": string | null }] }`;

      try {
        const result = await adapter.execute({
          repos: [],
          title: 'Correction enforcement',
          goal: 'Evaluate memories against user correction',
          prompt,
          relevantMemories: [],
          model: 'opus',
          effort: 'high',
        });

        if (result.status === 'success' && result.output) {
          const schema = z.object({
            decisions: z.array(z.object({
              index: z.number(),
              action: z.enum(['archive', 'edit', 'keep']),
              reason: z.string(),
              editedBody: z.string().nullable(),
            })),
          });

          const parsed = safeParseJson(result.output, schema, 'correction-enforce');
          if (parsed.success) {
            for (const decision of parsed.data.decisions) {
              const candidate = candidates[decision.index];
              if (!candidate) continue;

              if (decision.action === 'archive') {
                db.updateMemory(candidate.id, { archivedAt: new Date().toISOString() });
                db.createFeedback({ targetKind: 'memory', targetId: candidate.id, action: 'corrected', note: `Archived: ${decision.reason} (correction: ${correction.title})` });
                archived++;
              } else if (decision.action === 'edit' && decision.editedBody) {
                db.updateMemory(candidate.id, { bodyMd: decision.editedBody });
                const updatedMem = db.getMemory(candidate.id);
                if (updatedMem) {
                  await generateAndStoreEmbedding(db, 'memory', candidate.id, { kind: updatedMem.kind, title: updatedMem.title, bodyMd: decision.editedBody });
                }
                db.createFeedback({ targetKind: 'memory', targetId: candidate.id, action: 'corrected', note: `Edited: ${decision.reason} (correction: ${correction.title})` });
                edited++;
              }
            }
          }
        }
      } catch (err) {
        console.error(`[corrections] LLM enforcement failed for "${correction.title}":`, err instanceof Error ? err.message : err);
      }
    }

    // Promote correction to taught (consumed)
    db.updateMemory(correction.id, { kind: 'taught' });
  }

  return { processed: corrections.length, archived, edited };
}

/**
 * Merge semantically similar memories into richer combined memories.
 * Uses vector search to find clusters, then LLM to decide and merge.
 * Protected kinds (soul_reflection, taught, correction, knowledge_summary, meta_pattern) are excluded.
 * Core-layer memories are excluded.
 */
export async function mergeRelatedMemories(
  db: ShadowDatabase,
  config: ShadowConfig,
): Promise<{ merged: number; archived: number; deduped: number }> {
  const PROTECTED_KINDS = new Set(['soul_reflection', 'correction', 'knowledge_summary']);
  const candidates = db.listMemories({ archived: false, limit: 200 })
    .filter(m => !PROTECTED_KINDS.has(m.kind));

  if (candidates.length < 2) return { merged: 0, archived: 0, deduped: 0 };

  // Step 0: Trivial dedup — archive exact duplicates (same title + same kind) keeping the newest
  let deduped = 0;
  let archived = 0;
  const byTitleKind = new Map<string, typeof candidates>();
  for (const m of candidates) {
    const key = `${m.kind}::${m.title.trim().toLowerCase()}`;
    const group = byTitleKind.get(key) ?? [];
    group.push(m);
    byTitleKind.set(key, group);
  }
  const dedupArchived = new Set<string>();
  for (const group of byTitleKind.values()) {
    if (group.length < 2) continue;
    const sorted = group.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    for (let i = 1; i < sorted.length; i++) {
      db.updateMemory(sorted[i].id, { archivedAt: new Date().toISOString() });
      db.createFeedback({ targetKind: 'memory', targetId: sorted[i].id, action: 'deduped', note: `Exact duplicate of ${sorted[0].id}` });
      dedupArchived.add(sorted[i].id);
      deduped++;
    }
  }
  if (deduped > 0) console.error(`[memory-merge] Deduped ${deduped} exact duplicates`);

  // Filter out just-archived duplicates from candidates
  const dedupedCandidates = candidates.filter(m => !dedupArchived.has(m.id));

  // Build merge clusters via vector search
  const processed = new Set<string>();
  const clusters: Array<Array<{ id: string; title: string; bodyMd: string; kind: string; layer: string; scope: string; entities: Array<{ type: string; id: string }> }>> = [];

  for (const mem of dedupedCandidates) {
    if (processed.has(mem.id)) continue;

    // Search for similar memories
    let embedding: Float32Array;
    try {
      embedding = await embed(`${mem.title} ${mem.bodyMd}`);
    } catch { continue; }

    let similar: Array<{ id: string; distance: number }>;
    try {
      similar = db.rawDb
        .prepare('SELECT id, distance FROM memory_vectors WHERE embedding MATCH ? ORDER BY distance LIMIT 10')
        .all(embedding) as Array<{ id: string; distance: number }>;
    } catch { continue; }

    const cluster = [{ id: mem.id, title: mem.title, bodyMd: mem.bodyMd, kind: mem.kind, layer: mem.layer, scope: mem.scope, entities: mem.entities ?? [] }];

    for (const row of similar) {
      if (row.id === mem.id || processed.has(row.id)) continue;
      const similarity = 1 - (row.distance * row.distance) / 2;
      if (similarity < 0.65) break;

      const other = db.getMemory(row.id);
      if (!other || other.archivedAt || PROTECTED_KINDS.has(other.kind) || other.layer === 'core') continue;
      if (other.scope !== mem.scope) continue; // same scope only

      cluster.push({ id: other.id, title: other.title, bodyMd: other.bodyMd, kind: other.kind, layer: other.layer, scope: other.scope, entities: other.entities ?? [] });
      if (cluster.length >= 5) break; // max cluster size
    }

    if (cluster.length >= 2) {
      clusters.push(cluster);
      for (const c of cluster) processed.add(c.id);
    }
  }

  if (clusters.length === 0) return { merged: 0, archived: 0, deduped };

  // No artificial cap — natural limits are job timeout (8min) and LLM call duration.
  // Safeguard: can't archive more than 20% of total memories in one cycle.
  const totalMemories = db.countMemories({ archived: false });
  const maxArchived = Math.max(10, Math.floor(totalMemories * 0.2));
  let merged = 0;

  const adapter = selectAdapter(config);

  for (const cluster of clusters) {
    if (archived >= maxArchived) break; // proportion safeguard

    const prompt = `You are consolidating knowledge memories for Shadow, an engineering companion. These memories are about similar topics and may overlap.

Memories:
${cluster.map((m, i) => `[${i}] "${m.title}" (${m.kind}, ${m.layer}): ${m.bodyMd}`).join('\n\n')}

Should these be merged into a single, richer memory? Consider:
- Are they genuinely about the same topic/system?
- Does merging lose important nuance?
- Would a combined memory be more useful than ${cluster.length} separate ones?

Respond with JSON:
{
  "shouldMerge": true or false,
  "reason": "brief explanation",
  "mergedTitle": "combined title if merging",
  "mergedBody": "combined body in markdown — preserve ALL important details, do not lose information",
  "mergedKind": "most appropriate kind (convention, design_decision, workflow, preference, pattern, etc.)",
  "keepIndices": []
}

If keepIndices is non-empty, those memories will NOT be merged and will be kept separate.`;

    try {
      const result = await adapter.execute({
        repos: [],
        title: 'Memory merge evaluation',
        goal: 'Decide whether to merge similar memories',
        prompt,
        relevantMemories: [],
        model: 'opus',
        effort: 'high',
      });

      if (result.status !== 'success' || !result.output) continue;

      const schema = z.object({
        shouldMerge: z.boolean(),
        reason: z.string(),
        mergedTitle: z.string().optional(),
        mergedBody: z.string().optional(),
        mergedKind: z.string().optional(),
        keepIndices: z.array(z.number()).optional(),
      });

      const parsed = safeParseJson(result.output, schema, 'memory-merge');
      if (!parsed.success || !parsed.data.shouldMerge) continue;

      const { mergedTitle, mergedBody, mergedKind, keepIndices } = parsed.data;
      if (!mergedTitle || !mergedBody) continue;

      const keepSet = new Set(keepIndices ?? []);
      const toMerge = cluster.filter((_, i) => !keepSet.has(i));
      if (toMerge.length < 2) continue;

      // Collect all entities from merged memories
      const allEntities: Array<{ type: string; id: string }> = [];
      for (const m of toMerge) {
        for (const e of m.entities) {
          if (!allEntities.some(ae => ae.type === e.type && ae.id === e.id)) {
            allEntities.push(e);
          }
        }
      }

      // Collect all source memory IDs (including transitive — if a source was itself a merge)
      const allSourceIds: string[] = [];
      for (const m of toMerge) {
        allSourceIds.push(m.id);
        const existing = db.getMemory(m.id);
        if (existing?.sourceMemoryIds?.length) {
          allSourceIds.push(...existing.sourceMemoryIds);
        }
      }

      // Create merged memory
      const newMem = db.createMemory({
        layer: toMerge[0].layer, // use first memory's layer
        scope: toMerge[0].scope,
        kind: mergedKind || toMerge[0].kind,
        title: mergedTitle,
        bodyMd: mergedBody,
        sourceType: 'consolidation',
        confidenceScore: 80,
        relevanceScore: 0.7,
        sourceMemoryIds: allSourceIds,
      });

      // Set entities via raw SQL (createMemory doesn't support entities_json)
      if (allEntities.length > 0) {
        db.rawDb
          .prepare('UPDATE memories SET entities_json = ? WHERE id = ?')
          .run(JSON.stringify(allEntities), newMem.id);
      }

      // Generate embedding for new memory
      try {
        await generateAndStoreEmbedding(db, 'memory', newMem.id, { kind: newMem.kind, title: mergedTitle, bodyMd: mergedBody });
      } catch { /* best-effort */ }

      // Archive source memories
      for (const m of toMerge) {
        db.updateMemory(m.id, { archivedAt: new Date().toISOString() });
        db.createFeedback({
          targetKind: 'memory',
          targetId: m.id,
          action: 'merged',
          note: `Merged into ${newMem.id}: ${mergedTitle}`,
        });
        archived++;
      }

      merged++;
      console.error(`[memory-merge] Merged ${toMerge.length} memories → "${mergedTitle}"`);
    } catch (err) {
      console.error('[memory-merge] LLM call failed:', err instanceof Error ? err.message : err);
    }
  }

  return { merged, archived, deduped };
}
