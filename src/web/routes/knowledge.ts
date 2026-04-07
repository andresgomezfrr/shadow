import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ShadowDatabase } from '../../storage/database.js';
import type { DaemonSharedState } from '../../daemon/job-handlers.js';
import { json, clampLimit, clampOffset, parseBody, CorrectionSchema } from '../helpers.js';

export async function handleKnowledgeRoutes(
  req: IncomingMessage, res: ServerResponse,
  pathname: string, params: URLSearchParams,
  db: ShadowDatabase,
  _daemonState?: DaemonSharedState,
): Promise<boolean> {

  if (req.method === 'GET') {
    if (pathname === '/api/memories') {
      const q = params.get('q');
      const layer = params.get('layer') ?? undefined;
      const memoryType = params.get('memoryType') ?? undefined;
      const limit = clampLimit(params.get('limit'), 50);
      const offset = clampOffset(params.get('offset'));
      if (q) {
        const results = db.searchMemories(q, { layer, limit: limit ?? 50 });
        const items = results.map((r) => ({ ...r.memory, rank: r.rank, snippet: r.snippet }));
        return json(res, { items, total: items.length }), true;
      }
      const items = db.listMemories({ layer, memoryType, archived: false, limit, offset });
      const total = db.countMemories({ layer, memoryType, archived: false });
      return json(res, { items, total }), true;
    }

    if (pathname === '/api/digests') {
      const kind = params.get('kind') ?? undefined;
      const limit = clampLimit(params.get('limit'), 20);
      const before = params.get('before') ?? undefined;
      const after = params.get('after') ?? undefined;
      const digests = db.listDigests({ kind, limit, before, after });
      return json(res, digests), true;
    }

    if (pathname === '/api/digest/status') {
      const status: Record<string, { status: string; periodStart?: string }> = {};
      for (const kind of ['daily', 'weekly', 'brag']) {
        const job = db.getLastJob(`digest-${kind}`);
        if (job?.status === 'running' || job?.status === 'queued') {
          status[kind] = { status: job.status, periodStart: (job.result as Record<string, string>).periodStart };
        } else {
          status[kind] = { status: 'idle' };
        }
      }
      return json(res, status), true;
    }

    // Enrichment cache: /api/enrichment
    if (pathname === '/api/enrichment') {
      const source = params.get('source') ?? undefined;
      const limit = clampLimit(params.get('limit'), 20);
      const offset = clampOffset(params.get('offset'));
      try {
        const items = db.listEnrichment({ source, limit, offset });
        const total = db.countEnrichment({ source });
        return json(res, { items, total }), true;
      } catch {
        return json(res, { items: [], total: 0 }), true;
      }
    }

    // Soul history: current reflection + archived snapshots
    if (pathname === '/api/soul/history') {
      const all = db.listMemories({ archived: false });
      const current = all.find(m => m.kind === 'soul_reflection');
      // Snapshots are archived memories with kind='soul_snapshot'
      const snapshots = db.rawDb
        .prepare("SELECT id, title, body_md, created_at, archived_at FROM memories WHERE kind = 'soul_snapshot' ORDER BY created_at DESC LIMIT 20")
        .all()
        .map((row: unknown) => {
          const r = row as Record<string, unknown>;
          return { id: String(r.id), title: String(r.title), bodyMd: String(r.body_md), createdAt: String(r.created_at), archivedAt: String(r.archived_at) };
        });
      return json(res, {
        current: current ? { id: current.id, bodyMd: current.bodyMd, updatedAt: current.updatedAt } : null,
        snapshots,
      }), true;
    }
  }

  if (req.method === 'POST') {
    if (pathname === '/api/corrections') {
      const body = await parseBody(req, res, CorrectionSchema);
      if (!body) return true;

      const correctionTitle = body.title || body.body.slice(0, 60) + (body.body.length > 60 ? '...' : '');

      const memory = db.createMemory({
        layer: 'core',
        scope: body.scope,
        kind: 'correction',
        title: correctionTitle,
        bodyMd: body.body,
        tags: [],
        sourceType: 'api',
        confidenceScore: 100,
        relevanceScore: 1.0,
      });

      // Link entities if provided
      if (body.entityType && body.entityId) {
        try {
          const entities = [{ type: body.entityType, id: body.entityId }];
          db.rawDb.prepare('UPDATE memories SET entities_json = ? WHERE id = ?')
            .run(JSON.stringify(entities), memory.id);
        } catch { /* best-effort */ }
      }

      // Generate embedding
      try {
        const { generateAndStoreEmbedding } = await import('../../memory/lifecycle.js');
        await generateAndStoreEmbedding(db, 'memory', memory.id, { kind: memory.kind, title: memory.title, bodyMd: memory.bodyMd });
      } catch { /* best-effort */ }

      return json(res, { ok: true, correction: memory }), true;
    }
  }

  return false;
}
