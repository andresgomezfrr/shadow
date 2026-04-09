import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase, type ShadowDatabase } from '../storage/database.js';
import { loadConfig } from '../config/load-config.js';
import type { EventBus } from './event-bus.js';
import type { DaemonSharedState } from '../daemon/job-handlers.js';
import { createMcpTools, handleJsonRpcRequest, type McpTool } from '../mcp/server.js';
import { json, html, readBody, parseUrl } from './helpers.js';
import { handleSuggestionRoutes } from './routes/suggestions.js';
import { handleObservationRoutes } from './routes/observations.js';
import { handleRunRoutes } from './routes/runs.js';
import { handleActivityRoutes } from './routes/activity.js';
import { handleJobRoutes } from './routes/jobs.js';
import { handleEntityRoutes } from './routes/entities.js';
import { handleKnowledgeRoutes } from './routes/knowledge.js';
import { handleProfileRoutes } from './routes/profile.js';
import { handleWorkspaceRoutes } from './routes/workspace.js';
import { handleTaskRoutes } from './routes/tasks.js';

const MUTATING_TOOLS = new Set([
  'shadow_memory_teach', 'shadow_memory_forget', 'shadow_memory_update', 'shadow_correct',
  'shadow_observe',
  'shadow_suggest_accept', 'shadow_suggest_dismiss', 'shadow_suggest_snooze',
  'shadow_observation_ack', 'shadow_observation_resolve', 'shadow_observation_reopen',
  'shadow_profile_set', 'shadow_focus', 'shadow_available', 'shadow_soul_update',
  'shadow_repo_add', 'shadow_repo_remove',
  'shadow_project_add', 'shadow_project_remove', 'shadow_project_update',
  'shadow_contact_add', 'shadow_contact_remove',
  'shadow_system_add', 'shadow_system_remove',
  'shadow_relation_add', 'shadow_relation_remove',
  'shadow_task_create', 'shadow_task_update', 'shadow_task_close', 'shadow_task_remove',
  'shadow_events_ack', 'shadow_feedback',
  'shadow_alert_ack', 'shadow_alert_resolve',
]);

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

export async function startWebServer(port: number = 3700, host: string = '127.0.0.1', _existingDb?: ShadowDatabase, eventBus?: EventBus, daemonState?: DaemonSharedState): Promise<{ close: () => void }> {
  const config = loadConfig();
  // Always create own DB connection — sharing with daemon causes "database is not open" errors
  const db = createDatabase(config);

  // MCP tools — lazy-initialized on first /api/mcp request
  let mcpTools: McpTool[] | null = null;

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

      // MCP JSON-RPC endpoint (Streamable HTTP transport)
      if (pathname === '/api/mcp' && req.method === 'POST') {
        const raw = await readBody(req);
        if (!raw) return json(res, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Empty body' } });

        let parsed: unknown;
        try { parsed = JSON.parse(raw); } catch {
          return json(res, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON' } });
        }

        const p = parsed as { method?: string; id?: unknown };

        // MCP initialize handshake (Streamable HTTP transport)
        if (p.method === 'initialize') {
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Mcp-Session-Id',
          });
          return void res.end(JSON.stringify({
            jsonrpc: '2.0', id: p.id ?? null,
            result: {
              protocolVersion: '2025-03-26',
              capabilities: { tools: {} },
              serverInfo: { name: 'shadow-mcp', version: '0.1.0' },
            },
          }));
        }

        // Notification — 202 Accepted with no body (per Streamable HTTP spec)
        if (p.method?.startsWith('notifications/')) {
          res.writeHead(202, {
            'Access-Control-Allow-Origin': '*',
          });
          return void res.end();
        }

        // Lazy-init MCP tools
        if (!mcpTools) {
          mcpTools = createMcpTools(db, config, { daemonState });
        }

        // Delegate to JSON-RPC handler (tools/list, tools/call)
        const response = await handleJsonRpcRequest(mcpTools, parsed);

        // Emit SSE for mutating tool calls
        if (eventBus && p.method === 'tools/call') {
          const toolName = (parsed as { params?: { name?: string } }).params?.name;
          if (toolName && MUTATING_TOOLS.has(toolName)) {
            eventBus.emit({ type: 'mcp:tool_call', data: { tool: toolName, ts: new Date().toISOString() } });
          }
        }

        return json(res, response);
      }

      // MCP GET — server does not offer SSE stream (per Streamable HTTP spec: 405)
      if (pathname === '/api/mcp' && req.method === 'GET') {
        res.writeHead(405, {
          'Allow': 'POST, OPTIONS',
          'Access-Control-Allow-Origin': '*',
        });
        return void res.end();
      }

      // MCP DELETE — session termination (no-op, stateless server)
      if (pathname === '/api/mcp' && req.method === 'DELETE') {
        res.writeHead(405, {
          'Allow': 'POST, OPTIONS',
          'Access-Control-Allow-Origin': '*',
        });
        return void res.end();
      }

      // CORS preflight for MCP endpoint
      if (pathname === '/api/mcp' && req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Mcp-Session-Id',
        });
        return void res.end();
      }

      // SSE event stream — must be before route dispatcher (doesn't end the response)
      if (pathname === '/api/events/stream' && eventBus) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
          'X-Accel-Buffering': 'no',
        });
        res.write(`event: connected\ndata: ${JSON.stringify({ ts: new Date().toISOString() })}\n\n`);
        eventBus.addClient(res);
        req.on('close', () => eventBus.removeClient(res));
        return; // Keep connection open
      }

      // API routes
      if (pathname.startsWith('/api/')) {
        // CORS preflight for API routes
        if (req.method === 'OPTIONS') {
          res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
          });
          return void res.end();
        }

        if (req.method === 'POST' && daemonState?.draining) {
          return void json(res, { error: 'Daemon is shutting down' }, 503);
        }

        const handlers = [
          handleWorkspaceRoutes, handleTaskRoutes,
          handleSuggestionRoutes, handleObservationRoutes, handleRunRoutes,
          handleActivityRoutes, handleJobRoutes, handleEntityRoutes,
          handleKnowledgeRoutes, handleProfileRoutes,
        ];
        for (const handler of handlers) {
          if (await handler(req, res, pathname, params, db, daemonState)) return;
        }
        json(res, { error: 'Not found' }, 404);
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
    server.listen(port, host, () => {
      console.log(`Shadow dashboard: http://${host}:${port}`);
      resolve({
        close: () => { try { server.close(); db.close(); } catch { /* best-effort */ } },
      });
    });
  });
}
