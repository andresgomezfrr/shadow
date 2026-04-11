import { z } from 'zod';
import { mcpSchema, type McpTool, type ToolContext } from './types.js';

const ObservationsSchema = z.object({
  repoId: z.string().describe('Filter by repository ID').optional(),
  projectId: z.string().describe('Filter by project ID (returns observations linked to this project via entities)').optional(),
  kind: z.string().describe('Filter by kind: improvement, risk, opportunity, pattern, infrastructure, cross_project').optional(),
  status: z.string().describe('Filter by status: open (default), acknowledged, done, expired, all').optional(),
  limit: z.number().describe('Max results (default 20)').optional(),
  offset: z.number().describe('Offset for pagination (default 0)').optional(),
  detail: z.boolean().describe('Include full detail and context JSON (default false)').optional(),
});

const ObserveSchema = z.object({
  repoId: z.string().describe('Optional repository ID to observe').optional(),
});

const ObservationIdSchema = z.object({
  observationId: z.string().describe('Observation ID'),
});

const ObservationResolveSchema = z.object({
  observationId: z.string().describe('Observation ID to resolve'),
  reason: z.string().describe('Why this observation is being resolved').optional(),
});

export function observationTools(ctx: ToolContext): McpTool[] {
  const { db } = ctx;

  return [
    {
      name: 'shadow_observations',
      description: 'Returns observations with pagination. Default: open, limit 20, compact. Use detail=true for full context. Filter by projectId to see all observations linked to a project.',
      inputSchema: mcpSchema(ObservationsSchema),
      handler: async (params) => {
        const { repoId, projectId, kind, status: rawStatus, limit: rawLimit, offset: rawOffset, detail: rawDetail } = ObservationsSchema.parse(params);
        const status = rawStatus ?? 'open';
        const limit = rawLimit ?? 20;
        const offset = rawOffset ?? 0;
        const detail = rawDetail ?? false;
        const items = db.listObservations({ repoId, status, kind, projectId, limit, offset });
        const total = db.countObservations({ status: status !== 'all' ? status : undefined, kind, projectId });
        // Touch last_seen_at for active/acknowledged observations being queried
        const touchable = items.filter(o => o.status === 'open' || o.status === 'acknowledged');
        if (touchable.length > 0) {
          db.touchObservationsLastSeen(touchable.map(o => o.id));
        }
        if (detail) return { items, total };
        return {
          items: items.map(o => ({
            id: o.id, kind: o.kind, title: o.title, status: o.status,
            severity: o.severity, votes: o.votes, repoIds: o.repoIds,
            entities: o.entities, createdAt: o.createdAt,
          })),
          total,
        };
      },
    },
    {
      name: 'shadow_observe',
      description: 'Trigger an observation cycle. Optionally specify a repoId. Requires trust level >= 2.',
      inputSchema: mcpSchema(ObserveSchema),
      handler: async (params) => {

        const { repoId } = ObserveSchema.parse(params);

        if (repoId) {
          const repo = db.getRepo(repoId);
          if (!repo) {
            return { isError: true, message: `Repository not found: ${repoId}` };
          }
          // Mark repo as observed
          db.updateRepo(repoId, { lastObservedAt: new Date().toISOString() });
          return {
            triggered: true,
            repoId,
            message: `Observation triggered for repo: ${repo.name}`,
          };
        }

        // Observe all repos
        const repos = db.listRepos();
        const now = new Date().toISOString();
        for (const repo of repos) {
          db.updateRepo(repo.id, { lastObservedAt: now });
        }
        return {
          triggered: true,
          repoCount: repos.length,
          message: `Observation triggered for ${repos.length} repositories`,
        };
      },
    },
    {
      name: 'shadow_observation_ack',
      description: 'Acknowledge an observation by ID, marking it as seen. Requires trust level >= 1.',
      inputSchema: mcpSchema(ObservationIdSchema),
      handler: async (params) => {

        const { observationId: id } = ObservationIdSchema.parse(params);
        const obs = db.getObservation(id);
        if (!obs) return { isError: true, message: `Observation not found: ${id}` };
        if (obs.status !== 'open') return { isError: true, message: `Observation is ${obs.status}, not open` };
        db.updateObservationStatus(id, 'acknowledged');
        db.touchObservationLastSeen(id);
        return { ok: true, observationId: id, status: 'acknowledged' };
      },
    },
    {
      name: 'shadow_observation_resolve',
      description: 'Resolve an observation by ID with an optional reason. Requires trust level >= 1.',
      inputSchema: mcpSchema(ObservationResolveSchema),
      handler: async (params) => {

        const { observationId: id, reason } = ObservationResolveSchema.parse(params);
        const obs = db.getObservation(id);
        if (!obs) return { isError: true, message: `Observation not found: ${id}` };
        if (obs.status === 'done') return { isError: true, message: 'Already done' };
        db.updateObservationStatus(id, 'done');
        db.deleteEmbedding('observation_vectors', id);
        db.createFeedback({ targetKind: 'observation', targetId: id, action: 'resolve', note: reason });
        return { ok: true, observationId: id, status: 'done' };
      },
    },
    {
      name: 'shadow_observation_reopen',
      description: 'Reopen a done or acknowledged observation, setting it back to open. Requires trust level >= 1.',
      inputSchema: mcpSchema(ObservationIdSchema),
      handler: async (params) => {

        const { observationId: id } = ObservationIdSchema.parse(params);
        const obs = db.getObservation(id);
        if (!obs) return { isError: true, message: `Observation not found: ${id}` };
        if (obs.status === 'open') return { isError: true, message: 'Already open' };
        db.updateObservationStatus(id, 'open');
        db.touchObservationLastSeen(id);
        return { ok: true, observationId: id, status: 'open' };
      },
    },
  ];
}
