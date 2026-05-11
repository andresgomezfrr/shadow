import { ZodError } from 'zod';
import type { ShadowDatabase } from '../storage/database.js';
import type { ShadowConfig } from '../config/load-config.js';
import type { UserProfileRecord } from '../storage/models.js';

import type { McpTool, McpToolAnnotations, ToolContext } from './tools/types.js';
import type { DaemonSharedState } from '../daemon/job-handlers.js';
import { listResources, readResource, type McpResource } from './resources.js';
import { listPrompts, getPrompt, type McpPrompt } from './prompts.js';
export type { McpTool, McpToolAnnotations } from './tools/types.js';
export { createMcpResources, type McpResource } from './resources.js';
export { createMcpPrompts, type McpPrompt } from './prompts.js';

import { statusTools } from './tools/status.js';
import { memoryTools } from './tools/memory.js';
import { observationTools } from './tools/observations.js';
import { suggestionTools } from './tools/suggestions.js';
import { entityTools } from './tools/entities.js';
import { profileTools } from './tools/profile.js';
import { dataTools } from './tools/data.js';
import { taskTools } from './tools/tasks.js';
import { workspaceTools } from './tools/workspace.js';
import { repoHealthTools } from './tools/repo-health.js';
import { recapTools } from './tools/recap.js';

// ---------------------------------------------------------------------------
// Tool assembly
// ---------------------------------------------------------------------------

export function createMcpTools(db: ShadowDatabase, config: ShadowConfig, opts?: { daemonState?: DaemonSharedState }): McpTool[] {
  function getTrustLevel(): number {
    // Legacy name kept for ToolContext back-compat; returns bond tier now
    const profile = db.getProfile('default');
    return profile?.bondTier ?? 0;
  }

  function deriveMood(): string {
    const recent = db.listRecentInteractions(10);
    if (recent.length === 0) return 'neutral';
    const sentiments = recent.map(i => i.sentiment).filter(Boolean);
    const positive = sentiments.filter(s => s === 'positive').length;
    const negative = sentiments.filter(s => s === 'negative').length;
    if (positive > negative + 2) return 'positive';
    if (negative > positive + 2) return 'concerned';
    return 'neutral';
  }

  function deriveGreeting(profile: UserProfileRecord): string {
    if (profile.focusMode === 'focus') return 'focus_mode_active';
    const lastInteraction = db.listRecentInteractions(1)[0];
    if (!lastInteraction) return 'first_session_ever';
    const hoursSince = (Date.now() - new Date(lastInteraction.createdAt).getTime()) / (1000 * 60 * 60);
    if (hoursSince > 24) return `back_after_${Math.round(hoursSince)}h`;
    if (hoursSince > 8) return 'new_day';
    if (hoursSince > 2) return `back_after_${Math.round(hoursSince)}h`;
    return 'continuing_session';
  }

  const trustNames: Record<number, string> = {
    1: 'observer', 2: 'advisor', 3: 'assistant', 4: 'partner', 5: 'shadow',
  };

  const ctx: ToolContext = { db, config, getTrustLevel, deriveMood, deriveGreeting, trustNames, daemonState: opts?.daemonState };

  return [
    ...statusTools(ctx),
    ...memoryTools(ctx),
    ...observationTools(ctx),
    ...suggestionTools(ctx),
    ...entityTools(ctx),
    ...profileTools(ctx),
    ...dataTools(ctx),
    ...taskTools(ctx),
    ...workspaceTools(ctx),
    ...repoHealthTools(ctx),
    ...recapTools(ctx),
  ];
}

// ---------------------------------------------------------------------------
// Annotation inference (MCP spec 2025-06-18)
// ---------------------------------------------------------------------------

// Sufijos del nombre del tool → hint por defecto. Aplicado post-assembly en
// emitToolList(). El override explícito declarado en cada tool gana siempre.
//
// Las listas se evalúan en orden: destructive antes que read-only, mutating
// antes que default. Si un nombre no encaja en ninguna lista, queda sin hints
// inferidos (la spec dice "hints" — ausencia ≠ negación).
const READONLY_SUFFIXES = /(_list|_view|_search|_get|_query|_status|_available|_focus|_check_in|_alerts|_systems|_repos|_contacts|_observations|_suggestions|_tasks|_digests|_digest|_relations?|_projects|_events|_summary|_profile|_detail|_soul|_usage|_config|_active_projects)$/;
const DESTRUCTIVE_SUFFIXES = /(_remove|_archive|_close|_delete|_stop|_forget|_resolve|_dismiss|_ack)$/;
const MUTATING_SUFFIXES = /(_create|_add|_update|_set|_write|_teach|_observe|_correct|_feedback|_accept|_snooze|_reopen|_run|_execute|_reset)$/;

export function inferAnnotations(name: string): McpToolAnnotations {
  if (DESTRUCTIVE_SUFFIXES.test(name)) {
    return { destructiveHint: true, idempotentHint: false };
  }
  if (READONLY_SUFFIXES.test(name)) {
    return { readOnlyHint: true, idempotentHint: true };
  }
  if (MUTATING_SUFFIXES.test(name)) {
    return { readOnlyHint: false, idempotentHint: false };
  }
  return {};
}

function resolveAnnotations(tool: McpTool): McpToolAnnotations {
  const inferred = inferAnnotations(tool.name);
  // Override explícito de la tool gana — pero solo para los campos declarados.
  // Los demás siguen los defaults inferidos.
  return { ...inferred, ...(tool.annotations ?? {}) };
}

function hasAnyHint(a: McpToolAnnotations): boolean {
  return a.readOnlyHint !== undefined
    || a.destructiveHint !== undefined
    || a.idempotentHint !== undefined
    || a.openWorldHint !== undefined;
}

// ---------------------------------------------------------------------------
// JSON-RPC handler
// ---------------------------------------------------------------------------

type JsonRpcRequest = {
  jsonrpc: string;
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  jsonrpc: string;
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

export async function handleJsonRpcRequest(
  tools: McpTool[],
  request: unknown,
  resources: McpResource[] = [],
  prompts: McpPrompt[] = [],
): Promise<unknown> {
  const req = request as JsonRpcRequest;
  const id = req.id ?? null;

  if (req.method === 'prompts/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: { prompts: listPrompts(prompts) },
    } satisfies JsonRpcResponse;
  }

  if (req.method === 'prompts/get') {
    const params = req.params ?? {};
    const name = params.name as string | undefined;
    const args = (params.arguments as Record<string, unknown>) ?? {};
    if (!name) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32602, message: 'Missing prompt name in params.name' },
      } satisfies JsonRpcResponse;
    }
    try {
      const result = await getPrompt(prompts, name, args);
      return {
        jsonrpc: '2.0',
        id,
        result,
      } satisfies JsonRpcResponse;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32602, message },
      } satisfies JsonRpcResponse;
    }
  }

  if (req.method === 'resources/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: { resources: listResources(resources) },
    } satisfies JsonRpcResponse;
  }

  if (req.method === 'resources/read') {
    const params = req.params ?? {};
    const uri = params.uri as string | undefined;
    if (!uri) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32602, message: 'Missing uri in params.uri' },
      } satisfies JsonRpcResponse;
    }
    try {
      const contents = await readResource(resources, uri);
      return {
        jsonrpc: '2.0',
        id,
        result: { contents: [contents] },
      } satisfies JsonRpcResponse;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32602, message },
      } satisfies JsonRpcResponse;
    }
  }

  if (req.method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        tools: tools.map((t) => {
          const annotations = resolveAnnotations(t);
          const entry: Record<string, unknown> = {
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          };
          if (hasAnyHint(annotations)) entry.annotations = annotations;
          return entry;
        }),
      },
    } satisfies JsonRpcResponse;
  }

  if (req.method === 'tools/call') {
    const params = req.params ?? {};
    const toolName = params.name as string | undefined;
    const toolArgs = (params.arguments as Record<string, unknown>) ?? {};

    if (!toolName) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32602, message: 'Missing tool name in params.name' },
      } satisfies JsonRpcResponse;
    }

    const tool = tools.find((t) => t.name === toolName);
    if (!tool) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Tool not found: ${toolName}` },
      } satisfies JsonRpcResponse;
    }

    try {
      const result = await tool.handler(toolArgs);
      return {
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] },
      } satisfies JsonRpcResponse;
    } catch (err) {
      if (err instanceof ZodError) {
        const detail = err.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32602, message: `Invalid params — ${detail}` },
        } satisfies JsonRpcResponse;
      }
      const message = err instanceof Error ? err.message : String(err);
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32603, message: `Tool execution failed: ${message}` },
      } satisfies JsonRpcResponse;
    }
  }

  return {
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `Method not found: ${req.method}` },
  } satisfies JsonRpcResponse;
}
