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
  trustGate: (required: number) => { ok: true } | { ok: false; error: { isError: true; message: string } };
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
