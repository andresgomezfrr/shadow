import { toJSONSchema, type ZodType } from 'zod';

import type { ShadowDatabase } from '../../storage/database.js';
import type { ShadowConfig } from '../../config/load-config.js';
import type { UserProfileRecord } from '../../storage/models.js';
import type { DaemonSharedState } from '../../daemon/job-handlers.js';

export type McpTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (params: Record<string, unknown>) => Promise<unknown>;
};

export type ToolContext = {
  db: ShadowDatabase;
  config: ShadowConfig;
  getTrustLevel: () => number;
  deriveMood: () => string;
  deriveGreeting: (profile: UserProfileRecord) => string;
  trustNames: Record<number, string>;
  daemonState?: DaemonSharedState;
};

/** Convert a Zod schema to JSON Schema for MCP, stripping the $schema key. */
export function mcpSchema(schema: ZodType): Record<string, unknown> {
  const { $schema, ...rest } = toJSONSchema(schema) as Record<string, unknown>;
  return rest;
}

// ---------------------------------------------------------------------------
// Unified tool return shape (audit M-03)
// ---------------------------------------------------------------------------

/**
 * Every MCP tool returns this discriminated union. Consumers can narrow on
 * `result.ok` and TypeScript gives them `data` / `error` accordingly.
 *
 * Previously each tool picked its own shape: `{ok, ...data}`, `{isError, message}`,
 * bare records, `{items, total}`, `{task, message}`. Callers couldn't write a
 * single error-handling pattern. This envelope makes the contract explicit.
 */
export type ToolResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/** Success wrapper. Use instead of building `{ok: true, data}` inline. */
export const ok = <T>(data: T): { ok: true; data: T } => ({ ok: true, data });

/** Error wrapper. Use instead of building `{ok: false, error}` or `{isError}`. */
export const err = (error: string): { ok: false; error: string } => ({ ok: false, error });
