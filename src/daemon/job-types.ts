/**
 * Canonical job-type registry — consumed by the CLI (`shadow job list`), the
 * web route that triggers jobs (`POST /api/jobs/trigger/:type`), and anywhere
 * else that needs the list of valid types or their priorities.
 *
 * Adding a new job type here + registering its handler in
 * `daemon/job-handlers.ts#buildHandlerRegistry` is the full lift. The web
 * route picks it up automatically.
 */
export const JOB_TYPES: Record<string, { priority: number; description: string }> = {
  heartbeat:              { priority: 10, description: 'analyze recent activity (4-phase)' },
  suggest:                { priority: 8,  description: 'generate suggestions from observations' },
  'suggest-deep':         { priority: 6,  description: 'full codebase review for suggestions' },
  'suggest-project':      { priority: 5,  description: 'cross-repo project analysis' },
  reflect:                { priority: 5,  description: 'evolve soul reflection' },
  consolidate:            { priority: 3,  description: 'memory layer maintenance + merge' },
  'repo-profile':         { priority: 3,  description: 'generate repo profile' },
  'project-profile':      { priority: 4,  description: 'generate project profile' },
  'remote-sync':          { priority: 2,  description: 'git ls-remote + selective fetch' },
  'pr-sync':              { priority: 3,  description: 'detect PR merge/close for awaiting_pr runs' },
  'context-enrich':       { priority: 4,  description: 'query external MCP servers' },
  'mcp-discover':         { priority: 2,  description: 'discover MCP server capabilities' },
  'digest-daily':         { priority: 5,  description: 'generate daily standup digest' },
  'digest-weekly':        { priority: 5,  description: 'generate weekly digest' },
  'digest-brag':          { priority: 5,  description: 'generate brag doc' },
  'revalidate-suggestion': { priority: 3, description: 'revalidate open suggestions' },
  'auto-plan':            { priority: 4,  description: 'revalidate mature suggestions and create plan runs' },
  'auto-execute':         { priority: 4,  description: 'execute planned runs with high confidence' },
  cleanup:                { priority: 2,  description: 'purge interactions/event_queue/llm_usage/jobs older than 90d; rollup llm_usage_daily' },
  'version-check':        { priority: 1,  description: 'check for new Shadow releases' },
  'metrics-snapshot':     { priority: 1,  description: 'daily snapshot of bond axes + memory layers into observability_metrics' },
};

export const JOB_TYPE_NAMES: readonly string[] = Object.freeze(Object.keys(JOB_TYPES));

export type JobTypeName = keyof typeof JOB_TYPES;
