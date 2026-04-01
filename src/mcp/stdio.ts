import { createInterface } from 'node:readline';

import type { ShadowConfig } from '../config/load-config.js';
import { createDatabase } from '../storage/database.js';
import { createMcpTools, handleJsonRpcRequest } from './server.js';

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

/**
 * Start a stdio-based MCP server.
 *
 * Reads JSON-RPC messages from stdin (one per line), processes them, and
 * writes responses to stdout.
 */
export async function startStdioMcpServer(config: ShadowConfig): Promise<void> {
  const db = createDatabase(config);
  const tools = createMcpTools(db, config);

  const rl = createInterface({
    input: process.stdin,
    terminal: false,
  });

  function send(response: JsonRpcResponse): void {
    process.stdout.write(JSON.stringify(response) + '\n');
  }

  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed === '') continue;

    let parsed: JsonRpcRequest;
    try {
      parsed = JSON.parse(trimmed) as JsonRpcRequest;
    } catch {
      send({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error: invalid JSON' },
      });
      continue;
    }

    const id = parsed.id ?? null;

    // Handle MCP initialize handshake
    if (parsed.method === 'initialize') {
      send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: 'shadow-mcp',
            version: '0.1.0',
          },
        },
      });
      continue;
    }

    // Handle notifications (no response expected)
    if (parsed.method === 'notifications/initialized') {
      // Acknowledgement of initialization; no response needed
      continue;
    }

    // Delegate to the JSON-RPC handler for tools/list, tools/call, etc.
    const response = (await handleJsonRpcRequest(tools, parsed)) as JsonRpcResponse;
    send(response);
  }

  db.close();
}
