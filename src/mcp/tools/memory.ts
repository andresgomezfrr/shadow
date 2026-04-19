import { z } from 'zod';
import { mcpSchema, ok, err, type McpTool, type ToolContext } from './types.js';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const MemorySearchSchema = z.object({
  query: z.string().describe('Search query string'),
  limit: z.number().describe('Maximum number of results (default 10)').optional(),
});

const MemoryTeachSchema = z.object({
  title: z.string().describe('Memory title'),
  body: z.string().describe('Memory body in markdown'),
  layer: z.string().describe('Memory layer (default: working)').optional(),
  scope: z.string().describe('Memory scope (default: global)').optional(),
  kind: z.string().describe('Memory kind: taught, tech_stack, design_decision, workflow, problem_solved, team_knowledge, preference (default: taught)').optional(),
  tags: z.array(z.string()).describe('Tags for searchability').optional(),
  entityType: z.enum(['repo', 'project', 'system']).describe('Type of entity this memory relates to').optional(),
  entityId: z.string().describe('ID of entity this memory relates to').optional(),
});

const MemoryForgetSchema = z.object({
  memoryId: z.string().describe('Memory ID to archive'),
  reason: z.string().describe('Why this memory is being archived').optional(),
});

const MemoryUpdateSchema = z.object({
  memoryId: z.string().describe('Memory ID to update'),
  layer: z.string().describe('New layer: core, hot, warm, cool, cold').optional(),
  body: z.string().describe('New body markdown').optional(),
  kind: z.string().describe('New kind').optional(),
  scope: z.string().describe('New scope').optional(),
  tags: z.array(z.string()).describe('New tags').optional(),
  reason: z.string().describe('Why this memory is being modified').optional(),
});

const MemoryCorrectSchema = z.object({
  title: z.string().describe('Short description of the correction').optional(),
  body: z.string().describe('The correct information that should override what Shadow learned'),
  scope: z.enum(['personal', 'repo', 'project', 'system']).describe('What this correction applies to'),
  entityType: z.enum(['repo', 'project', 'system']).describe('Type of entity being corrected').optional(),
  entityId: z.string().describe('ID of entity being corrected').optional(),
});

const MemoryListSchema = z.object({
  layer: z.string().describe('Filter by layer: core, hot, warm, cool, cold').optional(),
  scope: z.string().describe('Filter by scope: personal, repo, team, system, cross-repo').optional(),
  limit: z.number().describe('Max results (default 20)').optional(),
  offset: z.number().describe('Offset for pagination (default 0)').optional(),
  detail: z.boolean().describe('Include full bodyMd (default false)').optional(),
});

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export function memoryTools(ctx: ToolContext): McpTool[] {
  const { db } = ctx;

  return [
    // -----------------------------------------------------------------------
    // shadow_memory_search
    // -----------------------------------------------------------------------
    {
      name: 'shadow_memory_search',
      description: 'Search Shadow\'s memory store using full-text search (FTS5) with ranking by relevance and access count. Use when the user references something you\'ve previously learned ("remember when...", "what did I tell you about X") or when you need background context for a task.',
      inputSchema: mcpSchema(MemorySearchSchema),
      handler: async (params) => {
        const { query, limit } = MemorySearchSchema.parse(params);
        return ok(db.searchMemories(query, { limit: limit ?? 10 }));
      },
    },

    // -----------------------------------------------------------------------
    // shadow_memory_teach
    // -----------------------------------------------------------------------
    {
      name: 'shadow_memory_teach',
      description: 'Teach Shadow something new by creating a memory entry (tech stack, design decision, workflow, preference, team knowledge). Use when the user shares a fact that should persist across sessions. Link to an entity via entityType/entityId when the knowledge is repo/project/system-scoped. Requires trust level >= 1.',
      inputSchema: mcpSchema(MemoryTeachSchema),
      handler: async (params) => {

        const { title, body, layer, scope, kind, tags, entityType, entityId } = MemoryTeachSchema.parse(params);

        const { applyBondDelta } = await import('../../profile/bond.js');
        const memory = db.createMemory({
          layer: layer ?? 'working',
          scope: scope ?? 'global',
          kind: kind ?? 'taught',
          title,
          bodyMd: body,
          tags: tags ?? [],
          sourceType: 'mcp',
        });

        // Link to entity if provided
        if (entityType && entityId) {
          db.updateMemory(memory.id, { entities: [{ type: entityType, id: entityId }] });
        } else if (params.entityType || params.entityId) {
          console.error(`[mcp:teach] Entity params received but not parsed: entityType=${params.entityType} entityId=${params.entityId}`);
        }

        // Bond: teaching recomputes bond axes (depth grows)
        try { applyBondDelta(db, 'memory_taught'); } catch { /* ignore */ }
        return ok(entityType && entityId ? (db.getMemory(memory.id) ?? memory) : memory);
      },
    },

    // -----------------------------------------------------------------------
    // shadow_memory_forget
    // -----------------------------------------------------------------------
    {
      name: 'shadow_memory_forget',
      description: 'Archive a memory by ID with an optional reason — Shadow stops using it in future recall. Use when the user says a memory is wrong, outdated, or irrelevant; the reason is captured as feedback for future dedup. Requires trust level >= 1.',
      inputSchema: mcpSchema(MemoryForgetSchema),
      handler: async (params) => {

        const { memoryId, reason } = MemoryForgetSchema.parse(params);
        const memory = db.getMemory(memoryId);
        if (!memory) return err(`Memory not found: ${memoryId}`);

        db.updateMemory(memoryId, { archivedAt: new Date().toISOString() });
        db.deleteEmbedding('memory_vectors', memoryId);
        db.createFeedback({ targetKind: 'memory', targetId: memoryId, action: 'archive', note: reason });
        return ok({ archived: memoryId, title: memory.title });
      },
    },

    // -----------------------------------------------------------------------
    // shadow_memory_update
    // -----------------------------------------------------------------------
    {
      name: 'shadow_memory_update',
      description: 'Update an existing memory in place: change layer (hot/warm/cool/cold/core), body, kind, scope, or tags. Use when the user refines existing knowledge without creating a new entry, or when promoting a memory to core so it never decays. Requires trust level >= 1.',
      inputSchema: mcpSchema(MemoryUpdateSchema),
      handler: async (params) => {

        const { memoryId, layer, body, kind, scope, tags, reason } = MemoryUpdateSchema.parse(params);
        const memory = db.getMemory(memoryId);
        if (!memory) return err(`Memory not found: ${memoryId}`);

        const updates: Record<string, unknown> = {};
        if (layer) updates.layer = layer;
        if (body) updates.bodyMd = body;
        if (kind) updates.kind = kind;
        if (scope) updates.scope = scope;
        if (tags) updates.tags = tags;
        if (Object.keys(updates).length === 0) return err('No updates provided');

        db.updateMemory(memoryId, updates as Parameters<typeof db.updateMemory>[1]);
        db.createFeedback({ targetKind: 'memory', targetId: memoryId, action: 'modify', note: reason ?? `updated: ${Object.keys(updates).join(', ')}` });
        return ok({ memoryId, updated: Object.keys(updates) });
      },
    },

    // -----------------------------------------------------------------------
    // shadow_memory_list
    // -----------------------------------------------------------------------
    {
      name: 'shadow_memory_list',
      description: 'List memories with pagination, filterable by layer (core/hot/warm/cool/cold) and scope. Default: limit 20, compact (no body); pass detail=true for full bodyMd. Use when browsing what Shadow has learned rather than doing targeted search.',
      inputSchema: mcpSchema(MemoryListSchema),
      handler: async (params) => {
        const { layer, scope, limit, offset, detail } = MemoryListSchema.parse(params);
        const effectiveLimit = limit ?? 20;
        const effectiveOffset = offset ?? 0;
        const effectiveDetail = detail ?? false;

        const items = db.listMemories({ layer, scope, archived: false, limit: effectiveLimit, offset: effectiveOffset });
        const total = db.countMemories({ layer, archived: false });
        if (effectiveDetail) return ok({ items, total });
        return ok({
          items: items.map(m => ({
            id: m.id, layer: m.layer, kind: m.kind, title: m.title,
            scope: m.scope, tags: m.tags, confidenceScore: m.confidenceScore,
            accessCount: m.accessCount, entities: m.entities, createdAt: m.createdAt,
          })),
          total,
        });
      },
    },

    // -----------------------------------------------------------------------
    // shadow_correct
    // -----------------------------------------------------------------------
    {
      name: 'shadow_correct',
      description: 'Correct wrong information Shadow has learned. Creates a permanent correction that overrides learned knowledge and will be enforced by the consolidation job.',
      inputSchema: mcpSchema(MemoryCorrectSchema),
      handler: async (params) => {

        const parsed = MemoryCorrectSchema.parse(params);
        const title = parsed.title || parsed.body.slice(0, 60) + (parsed.body.length > 60 ? '...' : '');

        const memory = db.createMemory({
          layer: 'core',
          scope: parsed.scope,
          kind: 'correction',
          title,
          bodyMd: parsed.body,
          tags: [],
          sourceType: 'mcp',
          confidenceScore: 100,
          relevanceScore: 1.0,
        });

        // Link entities if provided
        if (parsed.entityType && parsed.entityId) {
          try {
            const entities = [{ type: parsed.entityType as 'repo' | 'project' | 'system', id: parsed.entityId }];
            db.updateMemory(memory.id, { entities });
          } catch { /* best-effort */ }
        }

        // Generate embedding for semantic matching in enforceCorrections
        try {
          const { generateAndStoreEmbedding } = await import('../../memory/lifecycle.js');
          await generateAndStoreEmbedding(db, 'memory', memory.id, { kind: memory.kind, title: memory.title, bodyMd: memory.bodyMd });
        } catch { /* best-effort */ }

        // Bond: correcting recomputes axes (depth + alignment grow)
        try {
          const { applyBondDelta } = await import('../../profile/bond.js');
          applyBondDelta(db, 'memory_taught');
        } catch { /* ignore */ }

        // Chronicle milestone: first_correction
        try {
          const row = db.rawDb
            .prepare(`SELECT COUNT(*) AS n FROM memories WHERE kind = 'correction' AND archived_at IS NULL`)
            .get() as { n: number };
          if (row.n === 1) {
            const { triggerChronicleMilestone } = await import('../../analysis/chronicle.js');
            triggerChronicleMilestone(db, 'first_correction', {
              title: memory.title,
              data: { scope: parsed.scope, body: parsed.body.slice(0, 200) },
            }).catch((e) => console.error('[chronicle] first_correction hook failed:', e));
          }
        } catch (e) { console.error('[chronicle] first_correction hook failed:', e); }

        return ok({ correction: { id: memory.id, title: memory.title, kind: memory.kind, layer: memory.layer } });
      },
    },
  ];
}
