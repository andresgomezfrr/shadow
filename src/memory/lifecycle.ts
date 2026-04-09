import type { ShadowDatabase } from '../storage/database.js';
import { embed, embeddingText } from './embeddings.js';

type VecTable = 'memory_vectors' | 'observation_vectors' | 'suggestion_vectors' | 'enrichment_vectors';
type EntityType = 'memory' | 'observation' | 'suggestion' | 'enrichment';

/**
 * Generate an embedding for an entity and store it in the vector table.
 * Call this after creating or updating a memory/observation/suggestion.
 * Non-blocking: errors are logged but don't propagate.
 */
export async function generateAndStoreEmbedding(
  db: ShadowDatabase,
  type: EntityType,
  id: string,
  entity: { kind?: string; title: string; bodyMd?: string; summaryMd?: string; detail?: Record<string, unknown> },
): Promise<void> {
  try {
    const text = embeddingText(type, entity);
    const vec = await embed(text);
    const table: VecTable = `${type}_vectors` as VecTable;
    db.storeEmbedding(table, id, vec);
  } catch (e) {
    console.error(`[shadow:embed] Failed for ${type}/${id}:`, e instanceof Error ? e.message : e);
  }
}

/**
 * Backfill embeddings for all existing entities that don't have one yet.
 * Runs once after migration, then skipped.
 */
export async function backfillEmbeddings(db: ShadowDatabase): Promise<{ memories: number; observations: number; suggestions: number }> {
  const counts = { memories: 0, observations: 0, suggestions: 0 };

  // Memories without embeddings
  const memories = db.listMemories({ archived: false, limit: 5000 });
  const existingMemVecs = new Set(
    (db.rawDb.prepare('SELECT id FROM memory_vectors').all() as { id: string }[]).map((r) => r.id),
  );
  for (const m of memories) {
    if (existingMemVecs.has(m.id)) continue;
    await generateAndStoreEmbedding(db, 'memory', m.id, { kind: m.kind, title: m.title, bodyMd: m.bodyMd });
    counts.memories++;
  }

  // Observations without embeddings
  const observations = db.rawDb
    .prepare("SELECT id, kind, title, detail_json FROM observations WHERE status IN ('active', 'acknowledged')")
    .all() as { id: string; kind: string; title: string; detail_json: string }[];
  const existingObsVecs = new Set(
    (db.rawDb.prepare('SELECT id FROM observation_vectors').all() as { id: string }[]).map((r) => r.id),
  );
  for (const o of observations) {
    if (existingObsVecs.has(o.id)) continue;
    const detail = JSON.parse(o.detail_json || '{}');
    await generateAndStoreEmbedding(db, 'observation', o.id, { kind: o.kind, title: o.title, detail });
    counts.observations++;
  }

  // Suggestions without embeddings
  const suggestions = db.rawDb
    .prepare("SELECT id, kind, title, summary_md FROM suggestions WHERE status IN ('pending', 'snoozed', 'accepted')")
    .all() as { id: string; kind: string; title: string; summary_md: string }[];
  const existingSugVecs = new Set(
    (db.rawDb.prepare('SELECT id FROM suggestion_vectors').all() as { id: string }[]).map((r) => r.id),
  );
  for (const s of suggestions) {
    if (existingSugVecs.has(s.id)) continue;
    await generateAndStoreEmbedding(db, 'suggestion', s.id, { kind: s.kind, title: s.title, summaryMd: s.summary_md });
    counts.suggestions++;
  }

  return counts;
}
