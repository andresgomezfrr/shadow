import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
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
      const config = loadConfig();
      let nextHeartbeatAt: string | null = null;
      try {
        const statePath = resolve(config.resolvedDataDir, 'daemon.json');
        if (existsSync(statePath)) {
          const raw = JSON.parse(readFileSync(statePath, 'utf-8'));
          nextHeartbeatAt = raw.nextHeartbeatAt ?? null;
        }
      } catch { /* ignore */ }
      const profile = db.ensureProfile();
      const memoriesCount = db.listMemories().length;
      const pendingSuggestions = db.countPendingSuggestions();
      const reposCount = db.listRepos().length;
      const contactsCount = db.listContacts().length;
      const systemsCount = db.listSystems().length;
      const lastHeartbeat = db.getLastHeartbeat();
      const usage = db.getUsageSummary('day');
      const activeObservations = db.listObservations({ status: 'active' }).length;
      const runsToReview = db.listRuns({ status: 'completed' }).length;
      return json(res, {
        profile,
        counts: {
          memories: memoriesCount,
          pendingSuggestions,
          activeObservations,
          runsToReview,
          repos: reposCount,
          contacts: contactsCount,
          systems: systemsCount,
        },
        usage,
        lastHeartbeat,
        nextHeartbeatAt,
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
      const status = params.get('status') ?? 'all';
      const repoId = params.get('repoId') ?? undefined;
      const observations = db.listObservations({ limit, status, repoId });
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
      const limit = parseInt(params.get('limit') ?? '30', 10);
      const heartbeats = db.listHeartbeats(limit);
      return json(res, heartbeats);
    }

    if (pathname === '/api/jobs') {
      const type = params.get('type') ?? undefined;
      const limit = parseInt(params.get('limit') ?? '30', 10);
      const jobs = db.listJobs({ type, limit });
      return json(res, jobs);
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
      const observations = db.listObservations({ status: 'active', limit: 100 });
      const todayObs = observations.filter((o) => o.createdAt > sinceIso);
      const memories = db.listMemories({ archived: false });
      const todayMemories = memories.filter((m) => m.createdAt > sinceIso);
      const suggestions = db.listSuggestions({ status: 'pending' });
      const usage = db.getUsageSummary('day');
      const events = db.listPendingEvents();
      const runsToReview = db.listRuns({ status: 'completed' });
      const lastHeartbeat = db.getLastHeartbeat();
      return json(res, {
        date: todayStart.toISOString().split('T')[0],
        profile,
        activity: {
          observationsToday: todayObs.length,
          memoriesCreatedToday: todayMemories.length,
          pendingSuggestions: suggestions.length,
          runsToReview: runsToReview.length,
          pendingEvents: events.length,
        },
        topObservations: todayObs.slice(0, 10),
        recentMemories: todayMemories.slice(0, 5).map((m) => ({ id: m.id, title: m.title, kind: m.kind, layer: m.layer, createdAt: m.createdAt })),
        runsToReview: runsToReview.slice(0, 5),
        pendingSuggestions: suggestions.slice(0, 20),
        repos: repos.map((r) => ({ id: r.id, name: r.name, path: r.path, lastObservedAt: r.lastObservedAt })),
        tokens: { input: usage.totalInputTokens, output: usage.totalOutputTokens, calls: usage.totalCalls },
        lastHeartbeat: lastHeartbeat ? { startedAt: lastHeartbeat.startedAt, phases: lastHeartbeat.phases, observationsCreated: lastHeartbeat.observationsCreated } : null,
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

    if (pathname === '/api/feedback-state') {
      const targetKind = params.get('targetKind');
      if (!targetKind) return json(res, { error: 'Missing targetKind' }, 400);
      const all = db.listFeedback(targetKind, 200);
      const state: Record<string, string> = {};
      for (const f of all) {
        if (!f.action.startsWith('thumbs_')) continue;
        if (!state[f.targetId]) state[f.targetId] = f.action;
      }
      return json(res, state);
    }
  }

  // --- POST routes ---
  if (req.method === 'POST') {
    const match = pathname.match(/^\/api\/suggestions\/([^/]+)\/(accept|dismiss)$/);
    if (match) {
      const [, id, action] = match;
      if (action === 'accept') {
        const { acceptSuggestion } = await import('../suggestion/engine.js');
        const result = acceptSuggestion(db, id);
        if (!result.ok) return json(res, { error: 'Cannot accept — suggestion not pending' }, 400);
        const updated = db.getSuggestion(id);
        return json(res, { ...updated, runId: result.runCreated });
      } else {
        const { dismissSuggestion } = await import('../suggestion/engine.js');
        let note: string | undefined;
        try { const body = JSON.parse(await readBody(req)); note = body.note; } catch { /* no body is ok */ }
        dismissSuggestion(db, id, note);
        const updated = db.getSuggestion(id);
        return json(res, updated);
      }
    }

    const obsMatch = pathname.match(/^\/api\/observations\/([^/]+)\/(acknowledge|resolve|reopen)$/);
    if (obsMatch) {
      const [, obsId, action] = obsMatch;
      const obs = db.getObservation(obsId);
      if (!obs) return json(res, { error: 'Not found' }, 404);
      const statusMap: Record<string, string> = { acknowledge: 'acknowledged', resolve: 'resolved', reopen: 'active' };
      db.updateObservationStatus(obsId, statusMap[action]);
      let obsNote: string | undefined;
      try { const body = JSON.parse(await readBody(req)); obsNote = body.note; } catch { /* ok */ }
      if (action !== 'reopen') db.createFeedback({ targetKind: 'observation', targetId: obsId, action, note: obsNote });
      return json(res, db.getObservation(obsId));
    }

    // --- Run actions ---
    const runArchiveMatch = pathname.match(/^\/api\/runs\/([^/]+)\/archive$/);
    if (runArchiveMatch) {
      const [, runId] = runArchiveMatch;
      const run = db.getRun(runId);
      if (!run) return json(res, { error: 'Run not found' }, 404);
      db.updateRun(runId, { archived: true });
      return json(res, { ok: true });
    }

    const runMatch = pathname.match(/^\/api\/runs\/([^/]+)\/(execute|session|discard|executed-manual)$/);
    if (runMatch) {
      const [, runId, action] = runMatch;
      const run = db.getRun(runId);
      if (!run) return json(res, { error: 'Run not found' }, 404);

      if (action === 'discard') {
        if (run.status !== 'completed') return json(res, { error: 'Run must be completed' }, 400);
        let discardNote: string | undefined;
        try { const body = JSON.parse(await readBody(req)); discardNote = body.note; } catch { /* ok */ }
        db.updateRun(runId, { status: 'discarded' });
        db.createFeedback({ targetKind: 'run', targetId: runId, action: 'discard', note: discardNote });
        return json(res, { ok: true, status: 'discarded' });
      }

      if (action === 'executed-manual') {
        if (run.status !== 'completed') return json(res, { error: 'Run must be completed' }, 400);
        db.updateRun(runId, { status: 'executed_manual' });
        return json(res, { ok: true, status: 'executed_manual' });
      }

      if (run.status !== 'completed') return json(res, { error: 'Run must be completed' }, 400);

      if (action === 'execute') {
        const childRun = db.createRun({
          repoId: run.repoId,
          repoIds: run.repoIds,
          suggestionId: run.suggestionId,
          parentRunId: run.id,
          kind: 'execution',
          prompt: `Implement the following plan. Write the actual code changes.\n\n${run.resultSummaryMd}`,
        });
        db.updateRun(runId, { status: 'executed' });
        return json(res, { runId: childRun.id, status: 'queued' });
      }

      if (action === 'session') {
        // If the run already has a sessionId, return it
        if (run.sessionId) {
          const repo = db.getRepo(run.repoId);
          const repoPath = repo?.path ?? process.cwd();
          return json(res, { sessionId: run.sessionId, command: `cd ${repoPath} && claude --resume ${run.sessionId}` });
        }
        // Create a new session by running claude with --print to seed it (async, doesn't block web server)
        const config = loadConfig();
        const { spawn: spawnChild } = await import('node:child_process');
        const { randomUUID } = await import('node:crypto');
        const sessionId: string = randomUUID();
        const prompt = `You are Shadow, helping implement a plan. Here is the context:\n\n## Plan\n${run.resultSummaryMd}\n\n## Original suggestion\n${run.prompt}\n\nReady to help implement this. What would you like to start with?`;
        const env: Record<string, string> = { ...process.env as Record<string, string> };
        const claudeBin = config.claudeBin ?? 'claude';
        if (config.claudeExtraPath) env.PATH = `${config.claudeExtraPath}:${env.PATH ?? ''}`;
        const repo = db.getRepo(run.repoId);
        const cwd = repo?.path ?? process.cwd();

        const result = await new Promise<{ stdout: string }>((resolve) => {
          const child = spawnChild(claudeBin, [
            '--print', '--output-format', 'json',
            '--system-prompt', 'You are Shadow, an engineering companion. Help the user implement the plan step by step.',
            '--session-id', sessionId,
            prompt,
          ], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
          const chunks: Buffer[] = [];
          child.stdout.on('data', (d: Buffer) => chunks.push(d));
          const timer = setTimeout(() => child.kill('SIGTERM'), 120_000);
          child.on('close', () => { clearTimeout(timer); resolve({ stdout: Buffer.concat(chunks).toString('utf8') }); });
          child.on('error', () => { clearTimeout(timer); resolve({ stdout: '' }); });
        });

        let finalSessionId = sessionId;
        try {
          const out = JSON.parse(result.stdout || '{}') as { session_id?: string };
          if (out.session_id) finalSessionId = out.session_id;
        } catch { /* use generated */ }
        db.updateRun(runId, { sessionId: finalSessionId });
        return json(res, { sessionId: finalSessionId, command: `cd ${cwd} && claude --resume ${finalSessionId}` });
      }
    }

    if (pathname === '/api/profile') {
      const body = JSON.parse(await readBody(req));
      const numericFields = ['proactivityLevel', 'personalityLevel', 'trustLevel', 'trustScore', 'bondLevel'];
      const updates: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(body)) {
        updates[key] = numericFields.includes(key) ? Number(value) : value;
      }
      // Merge preferences instead of overwriting
      if (updates.preferences && typeof updates.preferences === 'object') {
        const current = db.ensureProfile();
        const merged = { ...(current.preferences as Record<string, unknown>), ...(updates.preferences as Record<string, unknown>) };
        updates.preferencesJson = merged;
        delete updates.preferences;
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

    if (pathname === '/api/feedback') {
      const body = JSON.parse(await readBody(req));
      const { targetKind, targetId, action, note } = body;
      if (!targetKind || !targetId || !action) return json(res, { error: 'Missing targetKind, targetId, or action' }, 400);
      db.createFeedback({ targetKind, targetId, action, note });
      return json(res, { ok: true });
    }

    if (pathname === '/api/heartbeat/trigger') {
      // Block if a heartbeat is already running
      const lastHb = db.getLastHeartbeat();
      if (lastHb && !lastHb.finishedAt) {
        return json(res, { error: 'Heartbeat already running', phase: lastHb.phase }, 409);
      }
      const config = loadConfig();
      const triggerPath = resolve(config.resolvedDataDir, 'heartbeat-trigger');
      if (existsSync(triggerPath)) {
        return json(res, { error: 'Heartbeat already queued' }, 409);
      }
      writeFileSync(triggerPath, new Date().toISOString(), 'utf-8');
      return json(res, { triggered: true });
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

export async function startWebServer(port: number = 3700, _existingDb?: ShadowDatabase): Promise<{ close: () => void }> {
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

  return new Promise<{ close: () => void }>((resolve) => {
    server.listen(port, () => {
      console.log(`Shadow dashboard: http://localhost:${port}`);
      resolve({
        close: () => { try { server.close(); db.close(); } catch { /* best-effort */ } },
      });
    });
  });
}
