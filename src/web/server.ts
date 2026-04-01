import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase, type ShadowDatabase } from '../storage/database.js';
import { loadConfig } from '../config/load-config.js';

function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data));
}

function html(res: ServerResponse, body: string): void {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(body);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

function parseUrl(req: IncomingMessage): { pathname: string; params: URLSearchParams } {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  return { pathname: url.pathname, params: url.searchParams };
}

async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  params: URLSearchParams,
  db: ShadowDatabase,
): Promise<void> {
  // --- GET routes ---
  if (req.method === 'GET') {
    if (pathname === '/api/status') {
      const profile = db.ensureProfile();
      const memoriesCount = db.listMemories().length;
      const pendingSuggestions = db.countPendingSuggestions();
      const reposCount = db.listRepos().length;
      const contactsCount = db.listContacts().length;
      const systemsCount = db.listSystems().length;
      const lastHeartbeat = db.getLastHeartbeat();
      const usage = db.getUsageSummary('day');
      return json(res, {
        profile,
        counts: {
          memories: memoriesCount,
          pendingSuggestions,
          repos: reposCount,
          contacts: contactsCount,
          systems: systemsCount,
        },
        usage,
        lastHeartbeat,
      });
    }

    if (pathname === '/api/memories') {
      const q = params.get('q');
      const layer = params.get('layer') ?? undefined;
      if (q) {
        const results = db.searchMemories(q, { layer, limit: 50 });
        return json(res, results.map((r) => ({ ...r.memory, rank: r.rank, snippet: r.snippet })));
      }
      const memories = db.listMemories({ layer, archived: false });
      return json(res, memories);
    }

    if (pathname === '/api/suggestions') {
      const status = params.get('status') ?? undefined;
      const suggestions = db.listSuggestions({ status });
      return json(res, suggestions);
    }

    if (pathname === '/api/observations') {
      const limit = parseInt(params.get('limit') ?? '20', 10);
      const observations = db.listObservations({ limit });
      return json(res, observations);
    }

    if (pathname === '/api/contacts') {
      const team = params.get('team') ?? undefined;
      const contacts = db.listContacts({ team });
      return json(res, contacts);
    }

    if (pathname === '/api/systems') {
      const kind = params.get('kind') ?? undefined;
      const systems = db.listSystems({ kind });
      return json(res, systems);
    }

    if (pathname === '/api/usage') {
      const period = (params.get('period') ?? 'week') as 'day' | 'week' | 'month';
      const usage = db.getUsageSummary(period);
      return json(res, usage);
    }

    if (pathname === '/api/heartbeats') {
      // ShadowDatabase only exposes getLastHeartbeat(); access internal db for listing
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const internal = (db as any).database;
      const rows = internal
        .prepare('SELECT * FROM heartbeats ORDER BY started_at DESC LIMIT 20')
        .all() as Record<string, unknown>[];
      const heartbeats = rows.map((r) => ({
        id: String(r.id),
        phase: String(r.phase),
        activity: r.activity != null ? String(r.activity) : null,
        reposObserved: r.repos_observed_json ? JSON.parse(String(r.repos_observed_json)) : [],
        observationsCreated: Number(r.observations_created ?? 0),
        suggestionsCreated: Number(r.suggestions_created ?? 0),
        durationMs: r.duration_ms != null ? Number(r.duration_ms) : null,
        startedAt: String(r.started_at),
        finishedAt: r.finished_at != null ? String(r.finished_at) : null,
      }));
      return json(res, heartbeats);
    }

    if (pathname === '/api/repos') {
      const repos = db.listRepos();
      return json(res, repos);
    }

    if (pathname === '/api/daily-summary') {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const sinceIso = todayStart.toISOString();
      const profile = db.ensureProfile();
      const repos = db.listRepos();
      const observations = db.listObservations({ limit: 100 });
      const todayObs = observations.filter((o) => o.createdAt > sinceIso);
      const memories = db.listMemories({ archived: false });
      const todayMemories = memories.filter((m) => m.createdAt > sinceIso);
      const suggestions = db.listSuggestions({ status: 'pending' });
      const usage = db.getUsageSummary('day');
      const events = db.listPendingEvents();
      return json(res, {
        date: todayStart.toISOString().split('T')[0],
        profile,
        activity: {
          observationsToday: todayObs.length,
          memoriesCreatedToday: todayMemories.length,
          pendingSuggestions: suggestions.length,
          pendingEvents: events.length,
        },
        topObservations: todayObs.slice(0, 10),
        pendingSuggestions: suggestions.slice(0, 20),
        repos: repos.map((r) => ({ id: r.id, name: r.name, path: r.path, lastObservedAt: r.lastObservedAt })),
        tokens: { input: usage.totalInputTokens, output: usage.totalOutputTokens, calls: usage.totalCalls },
      });
    }

    if (pathname === '/api/events') {
      const events = db.listPendingEvents();
      return json(res, events);
    }

    if (pathname === '/api/runs') {
      const status = params.get('status') ?? undefined;
      const repoId = params.get('repoId') ?? undefined;
      const runs = db.listRuns({ status, repoId });
      return json(res, runs);
    }
  }

  // --- POST routes ---
  if (req.method === 'POST') {
    const match = pathname.match(/^\/api\/suggestions\/([^/]+)\/(accept|dismiss)$/);
    if (match) {
      const [, id, action] = match;
      const now = new Date().toISOString();
      if (action === 'accept') {
        db.updateSuggestion(id, { status: 'accepted', resolvedAt: now });
      } else {
        db.updateSuggestion(id, { status: 'dismissed', resolvedAt: now });
      }
      const updated = db.getSuggestion(id);
      return json(res, updated);
    }

    if (pathname === '/api/profile') {
      const body = JSON.parse(await readBody(req));
      const numericFields = ['proactivityLevel', 'personalityLevel', 'trustLevel', 'trustScore', 'bondLevel'];
      const updates: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(body)) {
        updates[key] = numericFields.includes(key) ? Number(value) : value;
      }
      db.updateProfile('default', updates);
      const updated = db.ensureProfile();
      return json(res, updated);
    }

    if (pathname === '/api/focus') {
      const body = JSON.parse(await readBody(req));
      if (body.mode === 'focus') {
        let focusUntil: string | null = null;
        if (body.duration) {
          const durMatch = String(body.duration).match(/^(\d+)\s*(h|m)$/i);
          if (durMatch) {
            const ms = durMatch[2].toLowerCase() === 'h' ? Number(durMatch[1]) * 3600000 : Number(durMatch[1]) * 60000;
            focusUntil = new Date(Date.now() + ms).toISOString();
          }
        }
        db.updateProfile('default', { focusMode: 'focus', focusUntil });
      } else {
        db.updateProfile('default', { focusMode: null, focusUntil: null });
      }
      return json(res, db.ensureProfile());
    }
  }

  // --- CORS preflight ---
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return void res.end();
  }

  json(res, { error: 'Not found' }, 404);
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

export async function startWebServer(port: number = 3700, _existingDb?: ShadowDatabase): Promise<void> {
  const config = loadConfig();
  // Always create own DB connection — sharing with daemon causes "database is not open" errors
  const db = createDatabase(config);

  const __dirname = dirname(fileURLToPath(import.meta.url));

  // React dashboard (built by Vite)
  const srcDashboardDir = resolve(__dirname, '..', '..', 'src', 'web', 'dashboard', 'dist');
  const distDashboardDir = resolve(__dirname, 'dashboard', 'dist');
  const dashboardDir = existsSync(srcDashboardDir) ? srcDashboardDir : (existsSync(distDashboardDir) ? distDashboardDir : null);

  // Legacy fallback
  const srcHtmlPath = resolve(__dirname, '..', '..', 'src', 'web', 'public', 'index.html');
  const distHtmlPath = resolve(__dirname, 'public', 'index.html');
  const legacyHtmlPath = existsSync(srcHtmlPath) ? srcHtmlPath : distHtmlPath;

  const server = createServer(async (req, res) => {
    try {
      const { pathname, params } = parseUrl(req);

      if (pathname.startsWith('/api/')) {
        await handleApi(req, res, pathname, params, db);
        return;
      }

      // Serve React SPA if built
      if (dashboardDir) {
        const filePath = resolve(dashboardDir, pathname === '/' ? 'index.html' : pathname.slice(1));
        if (existsSync(filePath) && statSync(filePath).isFile()) {
          const ext = extname(filePath);
          const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
          const content = readFileSync(filePath);
          res.writeHead(200, { 'Content-Type': contentType });
          res.end(content);
          return;
        }
        // SPA fallback — serve index.html for client-side routing
        const indexPath = resolve(dashboardDir, 'index.html');
        if (existsSync(indexPath)) {
          html(res, readFileSync(indexPath, 'utf8'));
          return;
        }
      }

      // Legacy dashboard fallback
      const indexHtml = readFileSync(legacyHtmlPath, 'utf8');
      html(res, indexHtml);
    } catch (err) {
      console.error('Shadow web error:', err);
      json(res, { error: 'Internal server error' }, 500);
    }
  });

  server.listen(port, () => {
    console.log(`Shadow dashboard: http://localhost:${port}`);
  });
}
