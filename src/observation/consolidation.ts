import type { ShadowDatabase } from '../storage/database.js';
import { embed, embeddingText } from '../memory/embeddings.js';

const MERGE_THRESHOLD = 0.65; // Cosine similarity above which observations are merged

/**
 * Find and merge semantically similar active observations.
 * Uses embeddings to detect observations about the same issue across repos.
 * Runs periodically (e.g., after each heartbeat) to prevent accumulation.
 */
export async function consolidateObservations(db: ShadowDatabase): Promise<number> {
  const active = db.listObservations({ status: 'active', limit: 50 });
  if (active.length < 2) return 0;

  let merged = 0;
  const resolved = new Set<string>(); // Track already-merged IDs

  for (let i = 0; i < active.length; i++) {
    const obs = active[i];
    if (resolved.has(obs.id)) continue;

    // Generate embedding for this observation
    const text = embeddingText('observation', { kind: obs.kind, title: obs.title, detail: obs.detail });
    const vec = await embed(text);

    // Find similar observations in the vector table
    let candidates: { id: string; distance: number }[];
    try {
      candidates = db.rawDb
        .prepare('SELECT id, distance FROM observation_vectors WHERE embedding MATCH ? ORDER BY distance LIMIT 5')
        .all(vec) as { id: string; distance: number }[];
    } catch {
      continue;
    }

    for (const candidate of candidates) {
      if (candidate.id === obs.id) continue;
      if (resolved.has(candidate.id)) continue;

      const similarity = 1 - (candidate.distance * candidate.distance) / 2;
      if (similarity < MERGE_THRESHOLD) break; // Sorted by distance, no more matches

      // Check that the candidate is also active
      const other = db.getObservation(candidate.id);
      if (!other || other.status !== 'active') continue;

      // Merge: keep the one with more votes, resolve the other
      const [keeper, loser] = obs.votes >= other.votes ? [obs, other] : [other, obs];

      // Combine votes and merge repoIds
      const mergedRepoIds = [...new Set([...keeper.repoIds, ...loser.repoIds])];
      const mergedEntities = [...keeper.entities];
      for (const e of loser.entities) {
        if (!mergedEntities.some(me => me.type === e.type && me.id === e.id)) {
          mergedEntities.push(e);
        }
      }

      db.rawDb.prepare(
        `UPDATE observations SET votes = votes + ?, repo_ids_json = ?, entities_json = ?, last_seen_at = ? WHERE id = ?`,
      ).run(loser.votes, JSON.stringify(mergedRepoIds), JSON.stringify(mergedEntities), new Date().toISOString(), keeper.id);

      db.updateObservationStatus(loser.id, 'resolved');
      db.deleteEmbedding('observation_vectors', loser.id);

      // Record feedback for audit
      try {
        db.createFeedback({
          targetKind: 'observation',
          targetId: loser.id,
          action: 'consolidated',
          note: `Merged into: ${keeper.title} (similarity ${(similarity * 100).toFixed(0)}%)`,
        });
      } catch { /* best-effort */ }

      resolved.add(loser.id);
      merged++;

      console.error(`[shadow:obs-consolidate] Merged "${loser.title.slice(0, 50)}" → "${keeper.title.slice(0, 50)}" (${(similarity * 100).toFixed(0)}%)`);
    }
  }

  return merged;
}
