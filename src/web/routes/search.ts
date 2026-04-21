import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import type { ShadowDatabase } from '../../storage/database.js';
import type { DaemonSharedState } from '../../daemon/job-handlers.js';
import { json, clampLimit } from '../helpers.js';
import { log } from '../../log.js';

const LOOKUP_TYPES = ['memory', 'observation', 'suggestion', 'run', 'task', 'project', 'system', 'repo', 'contact'] as const;
const LookupTypeSchema = z.enum(LOOKUP_TYPES);

type SearchItem = {
  id: string;
  title: string;
  subtitle: string;
  route: string;
  score?: number;
};

type SearchGroup = {
  type: 'memory' | 'observation' | 'suggestion' | 'task' | 'run' | 'project' | 'system' | 'repo' | 'contact';
  label: string;
  items: SearchItem[];
};

function truncate(s: string, n: number): string {
  if (!s) return '';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export async function handleSearchRoutes(
  req: IncomingMessage, res: ServerResponse,
  pathname: string, params: URLSearchParams,
  db: ShadowDatabase,
  _daemonState?: DaemonSharedState,
): Promise<boolean> {
  if (req.method !== 'GET') return false;

  // --- Individual lookup by id for deep-link prefetch ---
  if (pathname === '/api/lookup') {
    const typeRaw = params.get('type');
    const id = params.get('id');
    if (!typeRaw || !id) {
      return json(res, { error: 'type and id required' }, 400), true;
    }
    const parsed = LookupTypeSchema.safeParse(typeRaw);
    if (!parsed.success) {
      return json(res, { error: `unknown type: ${typeRaw}. Expected: ${LOOKUP_TYPES.join(', ')}` }, 400), true;
    }
    const type = parsed.data;
    let record: unknown = null;
    try {
      switch (type) {
        case 'memory': record = db.getMemory(id); break;
        case 'observation': record = db.getObservation(id); break;
        case 'suggestion': record = db.getSuggestion(id); break;
        case 'run': record = db.getRun(id); break;
        case 'task': record = db.getTask(id); break;
        case 'project': record = db.getProject(id); break;
        case 'system': record = db.getSystem(id); break;
        case 'repo': record = db.getRepo(id); break;
        case 'contact': record = db.getContact(id); break;
      }
    } catch (e) {
      log.error('[lookup]', e instanceof Error ? e.message : e);
      return json(res, { error: 'lookup failed' }, 500), true;
    }
    if (!record) return json(res, { error: 'not found' }, 404), true;
    return json(res, { item: record }), true;
  }

  if (pathname !== '/api/search') return false;

  const q = (params.get('q') ?? '').trim();
  const limit = clampLimit(params.get('limit'), 4);

  if (!q) {
    return json(res, { groups: [] }), true;
  }

  const groups: SearchGroup[] = [];

  // --- Knowledge entities (hybrid / vector search) ---
  const { hybridSearch, vectorSearch } = await import('../../memory/search.js');

  // Memories
  try {
    const memResults = await hybridSearch({
      db: db.rawDb, query: q,
      ftsTable: 'memories_fts', vecTable: 'memory_vectors', mainTable: 'memories',
      limit, filters: { archived: false },
    });
    const items: SearchItem[] = [];
    for (const r of memResults) {
      const m = db.getMemory(r.id);
      if (!m) continue;
      items.push({
        id: m.id,
        title: m.title,
        subtitle: `${m.kind} · ${m.layer}`,
        route: `/memories?highlight=${m.id}`,
        score: r.score,
      });
    }
    if (items.length > 0) groups.push({ type: 'memory', label: 'Memories', items });
  } catch (e) {
    log.error('[search] memories:', e instanceof Error ? e.message : e);
  }

  // Observations
  try {
    let obsResults: Array<{ id: string; score: number }> = [];
    try {
      obsResults = await hybridSearch({
        db: db.rawDb, query: q,
        ftsTable: 'observations_fts', vecTable: 'observation_vectors', mainTable: 'observations',
        limit,
      });
    } catch {
      const v = await vectorSearch({ db: db.rawDb, text: q, vecTable: 'observation_vectors', limit });
      obsResults = v.map(r => ({ id: r.id, score: r.similarity }));
    }
    const items: SearchItem[] = [];
    for (const r of obsResults) {
      const o = db.getObservation(r.id);
      if (!o) continue;
      items.push({
        id: o.id,
        title: o.title,
        subtitle: `${o.kind} · ${o.severity} · ${o.status}`,
        route: `/observations?highlight=${o.id}`,
        score: r.score,
      });
    }
    if (items.length > 0) groups.push({ type: 'observation', label: 'Observations', items });
  } catch (e) {
    log.error('[search] observations:', e instanceof Error ? e.message : e);
  }

  // Suggestions
  try {
    const sugResults = await vectorSearch({ db: db.rawDb, text: q, vecTable: 'suggestion_vectors', limit });
    const items: SearchItem[] = [];
    for (const r of sugResults) {
      const s = db.getSuggestion(r.id);
      if (!s) continue;
      items.push({
        id: s.id,
        title: s.title,
        subtitle: `${s.kind} · ${s.status}`,
        route: `/suggestions?highlight=${s.id}`,
        score: r.similarity,
      });
    }
    if (items.length > 0) groups.push({ type: 'suggestion', label: 'Suggestions', items });
  } catch (e) {
    log.error('[search] suggestions:', e instanceof Error ? e.message : e);
  }

  // --- Structural entities (SQL LIKE / in-memory filter) ---
  const pattern = `%${q.replace(/[%_]/g, '\\$&')}%`;
  const lowerQ = q.toLowerCase();

  // Tasks — LIKE on title
  try {
    const rows = db.rawDb.prepare(
      `SELECT id, title, status FROM tasks WHERE title LIKE ? ESCAPE '\\' AND archived = 0 ORDER BY updated_at DESC LIMIT ?`
    ).all(pattern, limit) as Array<{ id: string; title: string; status: string }>;
    const items: SearchItem[] = rows.map(r => ({
      id: r.id,
      title: r.title,
      subtitle: r.status,
      route: `/workspace?filter=task&item=${r.id}&itemType=task`,
    }));
    if (items.length > 0) groups.push({ type: 'task', label: 'Tasks', items });
  } catch (e) {
    log.error('[search] tasks:', e instanceof Error ? e.message : e);
  }

  // Runs — LIKE on prompt
  try {
    const rows = db.rawDb.prepare(
      `SELECT id, prompt, status FROM runs WHERE prompt LIKE ? ESCAPE '\\' AND archived = 0 ORDER BY created_at DESC LIMIT ?`
    ).all(pattern, limit) as Array<{ id: string; prompt: string; status: string }>;
    const items: SearchItem[] = rows.map(r => ({
      id: r.id,
      title: truncate(r.prompt, 80),
      subtitle: r.status,
      route: `/runs?highlight=${r.id}`,
    }));
    if (items.length > 0) groups.push({ type: 'run', label: 'Runs', items });
  } catch (e) {
    log.error('[search] runs:', e instanceof Error ? e.message : e);
  }

  // Projects — in-memory filter
  try {
    const all = db.listProjects({});
    const items: SearchItem[] = all
      .filter(p => p.name.toLowerCase().includes(lowerQ))
      .slice(0, limit)
      .map(p => ({
        id: p.id,
        title: p.name,
        subtitle: `${p.kind} · ${p.status}`,
        route: `/projects/${p.id}`,
      }));
    if (items.length > 0) groups.push({ type: 'project', label: 'Projects', items });
  } catch (e) {
    log.error('[search] projects:', e instanceof Error ? e.message : e);
  }

  // Systems — in-memory filter
  try {
    const all = db.listSystems({});
    const items: SearchItem[] = all
      .filter(s => s.name.toLowerCase().includes(lowerQ))
      .slice(0, limit)
      .map(s => ({
        id: s.id,
        title: s.name,
        subtitle: s.kind,
        route: `/systems/${s.id}`,
      }));
    if (items.length > 0) groups.push({ type: 'system', label: 'Systems', items });
  } catch (e) {
    log.error('[search] systems:', e instanceof Error ? e.message : e);
  }

  // Repos — in-memory filter
  try {
    const all = db.listRepos();
    const items: SearchItem[] = all
      .filter(r => r.name.toLowerCase().includes(lowerQ))
      .slice(0, limit)
      .map(r => ({
        id: r.id,
        title: r.name,
        subtitle: r.defaultBranch,
        route: `/repos`,
      }));
    if (items.length > 0) groups.push({ type: 'repo', label: 'Repos', items });
  } catch (e) {
    log.error('[search] repos:', e instanceof Error ? e.message : e);
  }

  // Contacts — in-memory filter
  try {
    const all = db.listContacts({});
    const items: SearchItem[] = all
      .filter(c => c.name.toLowerCase().includes(lowerQ))
      .slice(0, limit)
      .map(c => ({
        id: c.id,
        title: c.name,
        subtitle: [c.role, c.team].filter(Boolean).join(' · ') || 'contact',
        route: `/team`,
      }));
    if (items.length > 0) groups.push({ type: 'contact', label: 'Team', items });
  } catch (e) {
    log.error('[search] contacts:', e instanceof Error ? e.message : e);
  }

  return json(res, { groups }), true;
}
