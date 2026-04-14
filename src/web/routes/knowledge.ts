import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ShadowDatabase } from '../../storage/database.js';
import type { DaemonSharedState } from '../../daemon/job-handlers.js';
import { json, readBody, clampLimit, clampOffset, parseBody, CorrectionSchema } from '../helpers.js';

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
      const periodStart = params.get('periodStart') ?? undefined;
      const digests = db.listDigests({ kind, limit, before, after, periodStart });
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

    // Enrichment servers: discovered MCP servers with enabled/disabled status + descriptions
    if (pathname === '/api/enrichment/servers') {
      const { discoverMcpServerNames } = await import('../../observation/mcp-discovery.js');
      const discovered = discoverMcpServerNames();
      const profile = db.ensureProfile();
      const prefs = profile.preferences as Record<string, unknown> | undefined;
      const disabled = (prefs?.enrichmentDisabledServers as string[] | undefined) ?? [];

      // Load descriptions from mcp-discover job cache
      const descriptions = db.listEnrichment({ source: 'mcp-discover' });
      const descMap = new Map(descriptions.map(d => [d.entityName, d]));

      const servers = discovered.map(name => {
        const desc = descMap.get(name);
        return {
          name,
          enabled: !disabled.includes(name),
          description: desc?.summary ?? null,
          toolCount: (desc?.detail as Record<string, unknown> | undefined)?.toolCount as number ?? null,
          defaultTtl: (desc?.detail as Record<string, unknown> | undefined)?.defaultTtl as string ?? null,
          enrichmentHint: (desc?.detail as Record<string, unknown> | undefined)?.enrichmentHint as string ?? null,
        };
      });
      return json(res, { servers }), true;
    }

    // Enrichment projects: list all projects with enrichment enabled/disabled status
    if (pathname === '/api/enrichment/projects') {
      const profile = db.ensureProfile();
      const prefs = profile.preferences as Record<string, unknown> | undefined;
      const disabled = (prefs?.enrichmentDisabledProjects as string[] | undefined) ?? [];
      const projects = db.listProjects({}).map(p => ({
        id: p.id,
        name: p.name,
        status: p.status,
        enabled: !disabled.includes(p.name),
      }));
      return json(res, { projects, disabledProjects: disabled }), true;
    }

    // Enrichment cache: /api/enrichment
    if (pathname === '/api/enrichment') {
      const source = params.get('source') ?? undefined;
      const entityType = params.get('entityType') ?? undefined;
      const entityId = params.get('entityId') ?? undefined;
      const limit = clampLimit(params.get('limit'), 20);
      const offset = clampOffset(params.get('offset'));
      try {
        const items = db.listEnrichment({ source, entityType, entityId, limit, offset });
        const total = db.countEnrichment({ source, entityType, entityId });
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
    // Toggle enrichment server enabled/disabled
    if (pathname === '/api/enrichment/servers') {
      let body: { name: string; enabled: boolean };
      try { body = JSON.parse(await readBody(req)) as { name: string; enabled: boolean }; } catch { return json(res, { error: 'Invalid JSON' }, 400), true; }
      if (!body.name || typeof body.enabled !== 'boolean') return json(res, { error: 'name and enabled required' }, 400), true;

      const profile = db.ensureProfile();
      const prefs = { ...(profile.preferences as Record<string, unknown>) };
      const disabled = new Set((prefs.enrichmentDisabledServers as string[] | undefined) ?? []);
      if (body.enabled) {
        disabled.delete(body.name);
      } else {
        disabled.add(body.name);
      }
      prefs.enrichmentDisabledServers = Array.from(disabled);
      db.updateProfile('default', { preferencesJson: prefs });
      return json(res, { ok: true, name: body.name, enabled: body.enabled }), true;
    }

    // Toggle enrichment project enabled/disabled
    if (pathname === '/api/enrichment/projects') {
      let body: { name: string; enabled: boolean };
      try { body = JSON.parse(await readBody(req)) as { name: string; enabled: boolean }; } catch { return json(res, { error: 'Invalid JSON' }, 400), true; }
      if (!body.name || typeof body.enabled !== 'boolean') return json(res, { error: 'name and enabled required' }, 400), true;

      const profile = db.ensureProfile();
      const prefs = { ...(profile.preferences as Record<string, unknown>) };
      const disabled = new Set((prefs.enrichmentDisabledProjects as string[] | undefined) ?? []);
      if (body.enabled) {
        disabled.delete(body.name);
      } else {
        disabled.add(body.name);
      }
      prefs.enrichmentDisabledProjects = Array.from(disabled);
      db.updateProfile('default', { preferencesJson: prefs });
      return json(res, { ok: true, name: body.name, enabled: body.enabled }), true;
    }

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
          db.updateMemory(memory.id, { entities });
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
