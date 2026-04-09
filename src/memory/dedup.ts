import type { ShadowDatabase } from '../storage/database.js';
import { embed, embeddingText } from './embeddings.js';

// --- Types ---

export type DedupDecision =
  | { action: 'create' }
  | { action: 'update'; existingId: string; similarity: number }
  | { action: 'skip'; existingId: string; similarity: number };

export type DedupThresholds = {
  skip: number;   // >= this → too similar, skip entirely
  update: number; // >= this → same topic, merge/update existing
};

// Calibrated from real data (feedback thumbs duplicates at 0.76/0.73)
export const MEMORY_THRESHOLDS: DedupThresholds = { skip: 0.85, update: 0.70 };
export const OBSERVATION_THRESHOLDS: DedupThresholds = { skip: 0.80, update: 0.65 };
export const SUGGESTION_THRESHOLDS: DedupThresholds = { skip: 0.80, update: 0.70 };
// Lower threshold for dismissed — even loosely similar should be skipped
export const SUGGESTION_DISMISSED_THRESHOLDS: DedupThresholds = { skip: 0.75, update: 0.75 };
export const ENRICHMENT_THRESHOLDS: DedupThresholds = { skip: 0.85, update: 0.65 };

type VecTable = 'memory_vectors' | 'observation_vectors' | 'suggestion_vectors' | 'enrichment_vectors';

// --- Core function ---

/**
 * Check if text is semantically similar to existing entries in a vector table.
 * Returns: create (no match), update (same topic, merge), or skip (near-duplicate).
 */
export async function checkDuplicate(opts: {
  text: string;
  db: ShadowDatabase;
  vecTable: VecTable;
  thresholds: DedupThresholds;
  excludeIds?: string[];
  /** Only compare against entries matching these statuses in the main table */
  statusFilter?: { table: string; statuses: string[] };
}): Promise<DedupDecision> {
  const { db, vecTable, thresholds, excludeIds, statusFilter } = opts;

  const queryEmbedding = await embed(opts.text);

  // Find top 5 nearest vectors
  let rows: { id: string; distance: number }[];
  try {
    rows = db.rawDb
      .prepare(`SELECT id, distance FROM ${vecTable} WHERE embedding MATCH ? ORDER BY distance LIMIT 5`)
      .all(queryEmbedding) as { id: string; distance: number }[];
  } catch {
    return { action: 'create' };
  }

  // Filter and convert to cosine similarity
  for (const row of rows) {
    if (excludeIds?.includes(row.id)) continue;

    // Check status filter if specified
    if (statusFilter) {
      try {
        const entity = db.rawDb
          .prepare(`SELECT status FROM ${statusFilter.table} WHERE id = ?`)
          .get(row.id) as { status: string } | undefined;
        if (!entity || !statusFilter.statuses.includes(entity.status)) continue;
      } catch {
        continue;
      }
    }

    // L2 → cosine for normalized vectors: cosine_sim = 1 - (L2² / 2)
    const similarity = 1 - (row.distance * row.distance) / 2;

    if (similarity >= thresholds.skip) {
      return { action: 'skip', existingId: row.id, similarity };
    }
    if (similarity >= thresholds.update) {
      return { action: 'update', existingId: row.id, similarity };
    }

    // First candidate below threshold → no match possible (sorted by distance)
    break;
  }

  return { action: 'create' };
}

// --- Convenience wrappers ---

export async function checkMemoryDuplicate(
  db: ShadowDatabase,
  entity: { kind?: string; title: string; bodyMd?: string },
): Promise<DedupDecision> {
  return checkDuplicate({
    text: embeddingText('memory', entity),
    db,
    vecTable: 'memory_vectors',
    thresholds: MEMORY_THRESHOLDS,
  });
}

export async function checkObservationDuplicate(
  db: ShadowDatabase,
  entity: { kind?: string; title: string; detail?: Record<string, unknown> },
): Promise<DedupDecision> {
  return checkDuplicate({
    text: embeddingText('observation', entity),
    db,
    vecTable: 'observation_vectors',
    thresholds: OBSERVATION_THRESHOLDS,
    statusFilter: { table: 'observations', statuses: ['active', 'acknowledged'] },
  });
}

export async function checkSuggestionDuplicate(
  db: ShadowDatabase,
  entity: { kind?: string; title: string; summaryMd?: string },
  against: 'pending' | 'dismissed' | 'accepted',
): Promise<DedupDecision> {
  const statusMap: Record<string, string[]> = {
    pending: ['pending', 'snoozed'],
    dismissed: ['dismissed'],
    accepted: ['accepted'],
  };
  return checkDuplicate({
    text: embeddingText('suggestion', entity),
    db,
    vecTable: 'suggestion_vectors',
    thresholds: against === 'dismissed' ? SUGGESTION_DISMISSED_THRESHOLDS : SUGGESTION_THRESHOLDS,
    statusFilter: { table: 'suggestions', statuses: statusMap[against] },
  });
}

export async function checkEnrichmentDuplicate(
  db: ShadowDatabase,
  entity: { title: string; summaryMd?: string },
): Promise<DedupDecision> {
  return checkDuplicate({
    text: embeddingText('enrichment', entity),
    db,
    vecTable: 'enrichment_vectors',
    thresholds: ENRICHMENT_THRESHOLDS,
    // No statusFilter — match against stale entries too so we can un-stale them on update
  });
}
