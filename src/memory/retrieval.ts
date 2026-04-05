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
  const corrections = db.listMemories({ kind: 'correction', archived: false, limit: 50 });
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
          model: 'sonnet',
          effort: 'low',
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
