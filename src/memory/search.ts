import type { DatabaseSync } from 'node:sqlite';
import { embed } from './embeddings.js';

export type SearchResult = {
  id: string;
  score: number;
  ftsRank?: number;
  vecSimilarity?: number;
};

type SQLRow = Record<string, unknown>;

const RRF_K = 60; // Standard RRF constant (from Cormack et al.)

/**
 * Sanitize a text query for FTS5 — wrap words in quotes, join with OR.
 */
function sanitizeFtsQuery(query: string): string {
  return query
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .map((w) => `"${w}"`)
    .join(' OR ');
}

/**
 * FTS5 BM25 search on a given FTS table.
 * Returns ranked IDs. Filters applied post-hoc.
 */
function searchFts5(
  db: DatabaseSync,
  query: string,
  ftsTable: string,
  mainTable: string,
  limit: number,
  filters?: { archived?: boolean },
): { id: string; rank: number }[] {
  const sanitized = sanitizeFtsQuery(query);
  if (!sanitized) return [];

  try {
    const rows = db
      .prepare(
        `SELECT m.id, bm25(${ftsTable}) as rank
         FROM ${ftsTable} f
         JOIN ${mainTable} m ON m.rowid = f.rowid
         ${filters?.archived === false ? 'WHERE m.archived_at IS NULL' : ''}
         AND ${ftsTable} MATCH ?
         ORDER BY rank
         LIMIT ?`,
      )
      .all(sanitized, limit) as SQLRow[];

    return rows.map((row) => ({
      id: String(row.id),
      rank: Number(row.rank),
    }));
  } catch {
    return [];
  }
}

/**
 * Vector cosine similarity search on a vec0 table.
 * Returns IDs sorted by similarity (closest first).
 */
function searchVector(
  db: DatabaseSync,
  queryEmbedding: Float32Array,
  vecTable: string,
  limit: number,
): { id: string; distance: number }[] {
  try {
    const rows = db
      .prepare(
        `SELECT id, distance FROM ${vecTable} WHERE embedding MATCH ? ORDER BY distance LIMIT ?`,
      )
      .all(queryEmbedding, limit) as SQLRow[];

    return rows.map((row) => ({
      id: String(row.id),
      distance: Number(row.distance),
    }));
  } catch {
    return [];
  }
}

/**
 * Hybrid search combining FTS5 BM25 + Vector cosine via Reciprocal Rank Fusion.
 *
 * RRF(d) = 1/(k + rank_fts) + 1/(k + rank_vec)
 *
 * This gives equal weight to both ranking signals without needing score normalization.
 */
export async function hybridSearch(opts: {
  db: DatabaseSync;
  query: string;
  ftsTable: string;
  vecTable: string;
  mainTable: string;
  limit: number;
  filters?: { archived?: boolean };
}): Promise<SearchResult[]> {
  const { db, query, ftsTable, vecTable, mainTable, limit, filters } = opts;

  // Run both searches in parallel
  const queryEmbedding = await embed(query);
  const ftsResults = searchFts5(db, query, ftsTable, mainTable, limit * 2, filters);
  const vecResults = searchVector(db, queryEmbedding, vecTable, limit * 2);

  // Build RRF scores
  const scores = new Map<string, { score: number; ftsRank?: number; vecSimilarity?: number }>();

  ftsResults.forEach((r, rank) => {
    const entry = scores.get(r.id) ?? { score: 0 };
    entry.score += 1 / (RRF_K + rank + 1);
    entry.ftsRank = r.rank;
    scores.set(r.id, entry);
  });

  vecResults.forEach((r, rank) => {
    const entry = scores.get(r.id) ?? { score: 0 };
    entry.score += 1 / (RRF_K + rank + 1);
    // sqlite-vec uses L2 distance. For normalized vectors: cosine_sim = 1 - (L2² / 2)
    entry.vecSimilarity = 1 - (r.distance * r.distance) / 2;
    scores.set(r.id, entry);
  });

  return [...scores.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, limit)
    .map(([id, data]) => ({
      id,
      score: data.score,
      ftsRank: data.ftsRank,
      vecSimilarity: data.vecSimilarity,
    }));
}

/**
 * Pure vector similarity search — used for dedup, not user-facing search.
 * Returns top-K most similar entries.
 */
export async function vectorSearch(opts: {
  db: DatabaseSync;
  text: string;
  vecTable: string;
  limit: number;
}): Promise<{ id: string; similarity: number }[]> {
  const queryEmbedding = await embed(opts.text);
  const results = searchVector(opts.db, queryEmbedding, opts.vecTable, opts.limit);
  return results.map((r) => ({
    id: r.id,
    // sqlite-vec uses L2 distance. For normalized vectors: cosine_sim = 1 - (L2² / 2)
    similarity: 1 - (r.distance * r.distance) / 2,
  }));
}
