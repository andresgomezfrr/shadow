import type { ShadowDatabase } from '../storage/database.js';
import type { ShadowConfig } from '../config/load-config.js';
import type { UserProfileRecord } from '../storage/models.js';

import type { McpTool, ToolContext } from './tools/types.js';
export type { McpTool } from './tools/types.js';

import { statusTools } from './tools/status.js';
import { memoryTools } from './tools/memory.js';
import { observationTools } from './tools/observations.js';
import { suggestionTools } from './tools/suggestions.js';
import { entityTools } from './tools/entities.js';
import { profileTools } from './tools/profile.js';
import { dataTools } from './tools/data.js';

// ---------------------------------------------------------------------------
// Tool assembly
// ---------------------------------------------------------------------------

export function createMcpTools(db: ShadowDatabase, config: ShadowConfig): McpTool[] {
  function getTrustLevel(): number {
    const profile = db.getProfile('default');
    return profile?.trustLevel ?? 0;
  }

  function trustGate(required: number): { ok: true } | { ok: false; error: unknown } {
    const current = getTrustLevel();
    if (current < required) {
      return {
        ok: false,
        error: {
          isError: true,
          message: `Insufficient trust level: current ${current}, required >= ${required}`,
        },
      };
    }
    return { ok: true };
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

  const ctx: ToolContext = { db, config, getTrustLevel, trustGate, deriveMood, deriveGreeting, trustNames };

  return [
    ...statusTools(ctx),
    ...memoryTools(ctx),
    ...observationTools(ctx),
    ...suggestionTools(ctx),
    ...entityTools(ctx),
    ...profileTools(ctx),
    ...dataTools(ctx),
  ];
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
): Promise<unknown> {
  const req = request as JsonRpcRequest;
  const id = req.id ?? null;

  if (req.method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
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
