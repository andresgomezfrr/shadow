import { z } from 'zod';
import { mcpSchema, type McpTool, type ToolContext } from './types.js';

const SuggestionsSchema = z.object({
  status: z.string().describe('Filter by status: open (default), accepted, dismissed, snoozed').optional(),
  projectId: z.string().describe('Filter by project ID (returns suggestions linked to this project via entities)').optional(),
  repoId: z.string().describe('Filter by repository ID').optional(),
  limit: z.number().describe('Max results (default 20)').optional(),
  offset: z.number().describe('Offset for pagination (default 0)').optional(),
  detail: z.boolean().describe('Include full summaryMd and reasoningMd (default false)').optional(),
});

const SuggestAcceptSchema = z.object({
  suggestionId: z.string().describe('The suggestion ID to accept'),
  category: z.string().describe('Accept category: execute (run via runner, default), manual (already implemented), planned (add to backlog)').optional(),
});

const SuggestDismissSchema = z.object({
  suggestionId: z.string().describe('The suggestion ID to dismiss'),
  note: z.string().describe('Optional feedback note explaining the dismissal').optional(),
  category: z.string().describe('Dismiss category: premature, over_engineering, already_handled, not_relevant, low_value, duplicate, wont_do').optional(),
});

const SuggestSnoozeSchema = z.object({
  suggestionId: z.string().describe('The suggestion ID to snooze'),
  hours: z.number().describe('Hours to snooze (default: 72 = 3 days)').optional(),
});

export function suggestionTools(ctx: ToolContext): McpTool[] {
  const { db } = ctx;

  return [
    {
      name: 'shadow_suggestions',
      description: 'Returns suggestions with pagination. Default: open, limit 20, compact (no body). Use detail=true for full response. Filter by projectId to see suggestions linked to a project.',
      inputSchema: mcpSchema(SuggestionsSchema),
      handler: async (params) => {
        const { status: rawStatus, projectId, repoId, limit: rawLimit, offset: rawOffset, detail: rawDetail } = SuggestionsSchema.parse(params);
        const status = rawStatus ?? 'open';
        const limit = rawLimit ?? 20;
        const offset = rawOffset ?? 0;
        const detail = rawDetail ?? false;
        const items = db.listSuggestions({ status, repoId, projectId, limit, offset });
        const total = db.countSuggestions({ status, repoId, projectId });
        if (detail) return { items, total };
        return {
          items: items.map(s => ({
            id: s.id, kind: s.kind, title: s.title, status: s.status,
            impactScore: s.impactScore, confidenceScore: s.confidenceScore,
            repoIds: s.repoIds, entities: s.entities, createdAt: s.createdAt,
          })),
          total,
        };
      },
    },
    {
      name: 'shadow_suggest_accept',
      description: 'Accept a suggestion by ID. Requires trust level >= 1.',
      inputSchema: mcpSchema(SuggestAcceptSchema),
      handler: async (params) => {

        const { suggestionId, category: rawCategory } = SuggestAcceptSchema.parse(params);
        const category = rawCategory ?? 'execute';
        const suggestion = db.getSuggestion(suggestionId);
        if (!suggestion) {
          return { isError: true, message: `Suggestion not found: ${suggestionId}` };
        }

        const { acceptSuggestion } = await import('../../suggestion/engine.js');
        const result = acceptSuggestion(db, suggestionId, category);
        if (!result.ok) return { isError: true, message: 'Cannot accept — suggestion not open' };

        return { accepted: true, suggestionId, runCreated: result.runCreated };
      },
    },
    {
      name: 'shadow_suggest_dismiss',
      description: 'Dismiss a suggestion by ID with an optional note. Requires trust level >= 1.',
      inputSchema: mcpSchema(SuggestDismissSchema),
      handler: async (params) => {

        const { suggestionId, note, category } = SuggestDismissSchema.parse(params);
        const suggestion = db.getSuggestion(suggestionId);
        if (!suggestion) {
          return { isError: true, message: `Suggestion not found: ${suggestionId}` };
        }

        const { dismissSuggestion } = await import('../../suggestion/engine.js');
        const result = await dismissSuggestion(db, suggestionId, note, category);
        if (!result.ok) return { isError: true, message: 'Cannot dismiss — suggestion not open' };

        return { dismissed: true, suggestionId };
      },
    },
    {
      name: 'shadow_suggest_snooze',
      description: 'Snooze a suggestion for a given number of hours. Requires trust level >= 1.',
      inputSchema: mcpSchema(SuggestSnoozeSchema),
      handler: async (params) => {

        const { suggestionId, hours: rawHours } = SuggestSnoozeSchema.parse(params);
        const hours = rawHours ?? 72;
        const suggestion = db.getSuggestion(suggestionId);
        if (!suggestion) {
          return { isError: true, message: `Suggestion not found: ${suggestionId}` };
        }

        const { snoozeSuggestion } = await import('../../suggestion/engine.js');
        const until = new Date(Date.now() + hours * 3600_000).toISOString();
        const result = snoozeSuggestion(db, suggestionId, until);
        if (!result.ok) return { isError: true, message: 'Cannot snooze — suggestion not open' };

        return { snoozed: true, suggestionId, until };
      },
    },
  ];
}
