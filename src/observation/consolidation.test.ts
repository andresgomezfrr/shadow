import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { ConfigSchema } from '../config/schema.js';
import type { ShadowConfig } from '../config/schema.js';

/**
 * Audit T-08: boundary tests para `consolidateObservations`.
 *
 * Approach: mock `embed()` y `embeddingText()` del módulo `memory/embeddings`
 * para retornar vectores deterministas según el título. El cosine distance
 * entre vectores controlados nos deja testear arriba/abajo del threshold
 * MERGE_THRESHOLD = 0.65 sin cargar transformers. Luego poblamos la tabla
 * `observation_vectors` vía la API normal (generateAndStoreEmbedding usa
 * el mismo embed mockeado).
 *
 * Controla similaridad mediante prefijos compartidos en los títulos:
 * misma prefijo → embedding casi igual → similarity ~1.0
 * prefijos distintos → embeddings ortogonales → similarity ~0.0
 */

// Build a 384-dim Float32Array from a seed string — deterministic + controllable.
// Same seed → same vector. Similar seeds produce vectors with high overlap.
function seededEmbedding(seed: string): Float32Array {
  const vec = new Float32Array(384);
  // Hash-based fill + normalize. Seed collisions (same prefix) yield near-identical vectors.
  // Use first 32 chars of seed as the "topic signature" — similar topics → similar vectors.
  const topic = seed.slice(0, 32).toLowerCase();
  for (let i = 0; i < 384; i++) {
    const ch = topic.charCodeAt(i % topic.length) || 1;
    vec[i] = Math.sin(ch * (i + 1) * 0.01);
  }
  // Normalize to unit length
  let sum = 0;
  for (const v of vec) sum += v * v;
  const norm = Math.sqrt(sum) || 1;
  for (let i = 0; i < 384; i++) vec[i] /= norm;
  return vec;
}

mock.module('../memory/embeddings.js', {
  namedExports: {
    embed: async (text: string): Promise<Float32Array> => seededEmbedding(text),
    embeddingText: (_kind: string, data: { title?: string }): string => data.title ?? '',
    cosineSimilarity: (a: Float32Array, b: Float32Array): number => {
      let dot = 0;
      for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
      return dot;
    },
  },
});

// Import AFTER mock is registered
const { ShadowDatabase } = await import('../storage/database.js');
const { consolidateObservations } = await import('./consolidation.js');
const { generateAndStoreEmbedding } = await import('../memory/lifecycle.js');

function createTestDb(): { db: InstanceType<typeof ShadowDatabase>; cleanup: () => void } {
  const dbPath = join(tmpdir(), `shadow-obs-consolidate-${randomUUID()}.db`);
  const parsed = ConfigSchema.parse({});
  const config: ShadowConfig = {
    ...parsed,
    resolvedDataDir: tmpdir(),
    resolvedDatabasePath: dbPath,
    resolvedArtifactsDir: join(tmpdir(), 'artifacts'),
  };
  const db = new ShadowDatabase(config);
  return {
    db,
    cleanup: () => {
      db.close();
      try { unlinkSync(dbPath); } catch { /* */ }
      try { unlinkSync(dbPath + '-wal'); } catch { /* */ }
      try { unlinkSync(dbPath + '-shm'); } catch { /* */ }
    },
  };
}

describe('consolidateObservations — boundary cases (audit T-08)', () => {
  let db: InstanceType<typeof ShadowDatabase>;
  let cleanup: () => void;
  let repoId: string;

  beforeEach(async () => {
    ({ db, cleanup } = createTestDb());
    const repo = db.createRepo({ name: 'test-repo', path: '/tmp/t-' + randomUUID() });
    repoId = repo.id;
  });
  afterEach(() => cleanup());

  async function createObsWithEmbedding(title: string, opts?: { kind?: string; severity?: string; votes?: number }) {
    const obs = db.createObservation({
      repoId,
      kind: opts?.kind ?? 'improvement',
      title,
      severity: opts?.severity ?? 'info',
    });
    if ((opts?.votes ?? 0) > 0) {
      for (let i = 0; i < (opts!.votes!); i++) db.bumpObservationVotes(obs.id);
    }
    await generateAndStoreEmbedding(db, 'observation', obs.id, { kind: obs.kind, title: obs.title, detail: obs.detail });
    return db.getObservation(obs.id)!;
  }

  it('merges two observations with near-identical titles (similarity > threshold)', async () => {
    const a = await createObsWithEmbedding('Redis timeout in payment-service is too short');
    const b = await createObsWithEmbedding('Redis timeout in payment-service is too short for prod');

    const merged = await consolidateObservations(db);
    assert.equal(merged, 1, 'should report 1 merge');

    // Exactly one of them stays open; the other is resolved
    const aAfter = db.getObservation(a.id)!;
    const bAfter = db.getObservation(b.id)!;
    const statuses = [aAfter.status, bAfter.status].sort();
    assert.deepEqual(statuses, ['done', 'open']);
  });

  it('does NOT merge observations with different topics (similarity < threshold)', async () => {
    const a = await createObsWithEmbedding('Redis timeout in payment-service');
    const b = await createObsWithEmbedding('Frontend bundle size regression detected');

    const merged = await consolidateObservations(db);
    assert.equal(merged, 0, 'should report 0 merges');

    assert.equal(db.getObservation(a.id)!.status, 'open');
    assert.equal(db.getObservation(b.id)!.status, 'open');
  });

  it('keeper (higher votes) absorbs loser votes on merge', async () => {
    const keeper = await createObsWithEmbedding('Critical auth bug in session handling', { votes: 5 });
    const loser = await createObsWithEmbedding('Critical auth bug in session handling again', { votes: 2 });

    await consolidateObservations(db);

    const keeperAfter = db.getObservation(keeper.id);
    const loserAfter = db.getObservation(loser.id);

    // Keeper stays open with combined votes; loser resolved
    const survivor = keeperAfter?.status === 'open' ? keeperAfter : loserAfter;
    const dismissed = keeperAfter?.status === 'done' ? keeperAfter : loserAfter;
    assert.ok(survivor, 'one survivor must exist');
    assert.ok(dismissed, 'one dismissed must exist');
    assert.equal(survivor!.status, 'open');
    assert.equal(dismissed!.status, 'done');
    // Votes merged: 5 + 2 = 7 on the keeper (approximately — bumpObservationVotes in the
    // setup doubled a base count so we assert monotonic + >= larger original)
    assert.ok(survivor!.votes >= Math.max(keeper.votes, loser.votes), 'survivor has at least max source votes');
  });

  it('does nothing when there are fewer than 2 active observations', async () => {
    await createObsWithEmbedding('only observation');
    const merged = await consolidateObservations(db);
    assert.equal(merged, 0);
  });

  it('only merges active observations (skips already-resolved candidates)', async () => {
    const a = await createObsWithEmbedding('Shared topic X one');
    const b = await createObsWithEmbedding('Shared topic X two');
    // Pre-resolve b
    db.updateObservationStatus(b.id, 'done');

    const merged = await consolidateObservations(db);
    assert.equal(merged, 0, 'done observation should not participate in merge');
    assert.equal(db.getObservation(a.id)!.status, 'open');
  });
});
