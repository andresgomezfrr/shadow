import { z } from 'zod';

import type { McpTool, ToolContext } from './types.js';
import { mcpSchema, ok } from './types.js';
import { buildRecap } from '../../analysis/recap.js';

const RecapSchema = z.object({
  hours: z.coerce.number().int().min(1).max(720).default(24),
});

export function recapTools(ctx: ToolContext): McpTool[] {
  return [
    {
      name: 'shadow_recap',
      description: 'Ad-hoc activity summary over the last N hours (default 24, max 720=30d). Groups audit events by action, interface, actor and target kind. Stats only — does NOT call the LLM. Different from `shadow_digest` (daily, narrative). Use after a pause or context switch to see what changed.',
      inputSchema: mcpSchema(RecapSchema),
      handler: async (params) => {
        const { hours } = RecapSchema.parse(params);
        return ok(buildRecap(ctx.db, hours));
      },
    },
  ];
}
