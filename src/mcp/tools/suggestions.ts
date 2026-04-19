import { z } from 'zod';
import { mcpSchema, ok, err, type McpTool, type ToolContext } from './types.js';

const SuggestionsSchema = z.object({
  status: z.string().default('open').describe('Filter by status: open (default), accepted, dismissed, snoozed'),
  projectId: z.string().describe('Filter by project ID (returns suggestions linked to this project via entities)').optional(),
  repoId: z.string().describe('Filter by repository ID').optional(),
  limit: z.number().default(20).describe('Max results (default 20)'),
  offset: z.number().default(0).describe('Offset for pagination (default 0)'),
  detail: z.boolean().default(false).describe('Include full summaryMd and reasoningMd (default false)'),
});

const SuggestAcceptSchema = z.object({
  suggestionId: z.string().describe('The suggestion ID to accept'),
  category: z.string().default('execute').describe('Accept category: execute (run via runner, default), manual (already implemented), planned (add to backlog)'),
});

const SuggestDismissSchema = z.object({
  suggestionId: z.string().describe('The suggestion ID to dismiss'),
  note: z.string().describe('Optional feedback note explaining the dismissal').optional(),
  category: z.string().describe('Dismiss category: premature, over_engineering, already_handled, not_relevant, low_value, duplicate, wont_do').optional(),
});

const SuggestSnoozeSchema = z.object({
  suggestionId: z.string().describe('The suggestion ID to snooze'),
  hours: z.number().default(72).describe('Hours to snooze (default: 72 = 3 days)'),
});

export function suggestionTools(ctx: ToolContext): McpTool[] {
  const { db } = ctx;

  return [
    {
      name: 'shadow_suggestions',
      description: 'Returns suggestions with pagination. Default: open, limit 20, compact (no body). Use detail=true for full response. Filter by projectId to see suggestions linked to a project.',
      inputSchema: mcpSchema(SuggestionsSchema),
      handler: async (params) => {
        const { status, projectId, repoId, limit, offset, detail } = SuggestionsSchema.parse(params);
        const items = db.listSuggestions({ status, repoId, projectId, limit, offset });
        const total = db.countSuggestions({ status, repoId, projectId });
        if (detail) return ok({ items, total });
        return ok({
          items: items.map(s => ({
            id: s.id, kind: s.kind, title: s.title, status: s.status,
            impactScore: s.impactScore, confidenceScore: s.confidenceScore,
            repoIds: s.repoIds, entities: s.entities, createdAt: s.createdAt,
          })),
          total,
        });
      },
    },
    {
      name: 'shadow_suggest_accept',
      description: 'Accept a suggestion by ID with a category: execute (default — runs via the runner), manual (already implemented), planned (add to backlog as a task). Use when the user approves a suggestion and wants it acted on. Requires trust level >= 1.',
      inputSchema: mcpSchema(SuggestAcceptSchema),
      handler: async (params) => {

        const { suggestionId, category } = SuggestAcceptSchema.parse(params);
        const suggestion = db.getSuggestion(suggestionId);
        if (!suggestion) {
          return err(`Suggestion not found: ${suggestionId}`);
        }

        const { acceptSuggestion } = await import('../../suggestion/engine.js');
        const result = acceptSuggestion(db, suggestionId, category);
        if (!result.ok) return err('Cannot accept — suggestion not open');

        return ok({ accepted: true, suggestionId, runCreated: result.runCreated });
      },
    },
    {
      name: 'shadow_suggest_dismiss',
      description: 'Dismiss a suggestion by ID with an optional note and category (premature, over_engineering, already_handled, not_relevant, low_value, duplicate, wont_do). Use when the user rejects a suggestion; feedback is captured so dedup blocks similar future suggestions. Requires trust level >= 1.',
      inputSchema: mcpSchema(SuggestDismissSchema),
      handler: async (params) => {

        const { suggestionId, note, category } = SuggestDismissSchema.parse(params);
        const suggestion = db.getSuggestion(suggestionId);
        if (!suggestion) {
          return err(`Suggestion not found: ${suggestionId}`);
        }

        const { dismissSuggestion } = await import('../../suggestion/engine.js');
        const result = await dismissSuggestion(db, suggestionId, note, category);
        if (!result.ok) return err('Cannot dismiss — suggestion not open');

        return ok({ dismissed: true, suggestionId });
      },
    },
    {
      name: 'shadow_suggest_snooze',
      description: 'Snooze a suggestion for a given number of hours (default 72) — hides it until the snooze expires, then it reopens. Use when the user wants to defer a suggestion without rejecting it. Requires trust level >= 1.',
      inputSchema: mcpSchema(SuggestSnoozeSchema),
      handler: async (params) => {

        const { suggestionId, hours } = SuggestSnoozeSchema.parse(params);
        const suggestion = db.getSuggestion(suggestionId);
        if (!suggestion) {
          return err(`Suggestion not found: ${suggestionId}`);
        }

        const { snoozeSuggestion } = await import('../../suggestion/engine.js');
        const until = new Date(Date.now() + hours * 3600_000).toISOString();
        const result = snoozeSuggestion(db, suggestionId, until);
        if (!result.ok) return err('Cannot snooze — suggestion not open');

        return ok({ snoozed: true, suggestionId, until });
      },
    },
  ];
}
