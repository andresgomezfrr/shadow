import { z } from 'zod';

export const ModelsSchema = z.object({
  analyze: z.string().default('sonnet'),
  suggest: z.string().default('opus'),
  consolidate: z.string().default('opus'),
  runner: z.string().default('opus'),
  thought: z.string().default('haiku'),
  enrich: z.string().default('opus'),
  digestDaily: z.string().default('sonnet'),
  digestWeekly: z.string().default('opus'),
  digestBrag: z.string().default('opus'),
  repoProfile: z.string().default('sonnet'),
  suggestValidate: z.string().default('opus'),
  suggestDeep: z.string().default('opus'),
  suggestProject: z.string().default('opus'),
  projectProfile: z.string().default('opus'),
  mcpDiscover: z.string().default('sonnet'),
  revalidate: z.string().default('opus'),
  chronicleLore: z.string().default('opus'),
  chronicleDaily: z.string().default('haiku'),
  // Heartbeat phases — previously hardcoded as 'opus' in src/analysis/extract.ts
  summarize: z.string().default('opus'),
  extract: z.string().default('opus'),
  observe: z.string().default('opus'),
  // Reflect phases — previously hardcoded in src/analysis/reflect.ts (audit cd2062ef)
  reflectDelta: z.string().default('sonnet'),
  reflectEvolve: z.string().default('opus'),
  // Memory maintenance — previously hardcoded in src/memory/corrections.ts
  correctionEnforce: z.string().default('opus'),
  memoryMerge: z.string().default('opus'),
  // Mood phrase — previously hardcoded in src/analysis/extract.ts
  moodPhrase: z.string().default('haiku'),
  // PR draft generation — previously hardcoded in src/web/routes/runs.ts
  draftPr: z.string().default('sonnet'),
});

export const EffortsSchema = z.object({
  analyze: z.string().default('medium'),
  suggest: z.string().default('high'),
  consolidate: z.string().default('high'),
  runner: z.string().default('high'),
  suggestDeep: z.string().default('high'),
  suggestProject: z.string().default('high'),
  projectProfile: z.string().default('high'),
  enrich: z.string().default('high'),
  revalidate: z.string().default('high'),
});

export const ConfigSchema = z.object({
  env: z.enum(['development', 'test', 'production']).default('development'),
  dataDir: z.string().min(1).optional(),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  backend: z.enum(['cli', 'api']).default('cli'),
  claudeBin: z.string().min(1).default('claude'),
  claudeExtraPath: z.string().min(1).optional(),
  runnerTimeoutMs: z.coerce.number().int().positive().default(30 * 60 * 1000),
  // Analysis-layer LLM calls (heartbeat extract/summarize/observe, consolidate,
  // reflect) use this timeout instead of inheriting runnerTimeoutMs. Heartbeat
  // phases process long conversation transcripts and need more breathing room
  // than a runner execution (audit A-05).
  analysisTimeoutMs: z.coerce.number().int().positive().default(15 * 60 * 1000),
  heartbeatIntervalMs: z.coerce.number().int().positive().default(30 * 60 * 1000),
  daemonPollIntervalMs: z.coerce.number().int().positive().default(30_000),
  proactivityLevel: z.coerce.number().int().min(1).max(10).default(5),
  thoughtsEnabled: z.coerce.boolean().default(true),
  thoughtIntervalMinMs: z.coerce.number().int().positive().default(15 * 60 * 1000),
  thoughtIntervalMaxMs: z.coerce.number().int().positive().default(30 * 60 * 1000),
  thoughtDurationMs: z.coerce.number().int().positive().default(60_000),
  models: ModelsSchema.default({
    analyze: 'sonnet',
    suggest: 'opus',
    consolidate: 'opus',
    runner: 'opus',
    thought: 'haiku',
    enrich: 'opus',
    digestDaily: 'sonnet',
    digestWeekly: 'opus',
    digestBrag: 'opus',
    repoProfile: 'sonnet',
    suggestValidate: 'opus',
    suggestDeep: 'opus',
    suggestProject: 'opus',
    projectProfile: 'opus',
    mcpDiscover: 'sonnet',
    revalidate: 'opus',
    chronicleLore: 'opus',
    chronicleDaily: 'haiku',
    summarize: 'opus',
    extract: 'opus',
    observe: 'opus',
    reflectDelta: 'sonnet',
    reflectEvolve: 'opus',
    correctionEnforce: 'opus',
    memoryMerge: 'opus',
    moodPhrase: 'haiku',
    draftPr: 'sonnet',
  }),
  efforts: EffortsSchema.default({
    analyze: 'medium',
    suggest: 'high',
    consolidate: 'high',
    runner: 'high',
    suggestDeep: 'high',
    suggestProject: 'high',
    projectProfile: 'high',
    enrich: 'high',
    revalidate: 'high',
  }),
  locale: z.string().default('es'),
  watcherEnabled: z.coerce.boolean().default(true),
  watcherDebounceMs: z.coerce.number().int().positive().default(30_000),
  watcherMaxWindowMs: z.coerce.number().int().positive().default(5 * 60 * 1000),
  activityHeartbeatMinIntervalMs: z.coerce.number().int().positive().default(3 * 60 * 1000),
  activityHeartbeatMaxIntervalMs: z.coerce.number().int().positive().default(30 * 60 * 1000),
  activityTriggerThreshold: z.coerce.number().int().positive().default(3),
  webBindHost: z.string().default('127.0.0.1'),
  maxConcurrentRuns: z.coerce.number().int().min(1).max(8).default(3),
  maxConcurrentJobs: z.coerce.number().int().min(1).max(8).default(3),
  maxWatchedRepos: z.coerce.number().int().min(1).max(100).default(30),
  remoteSyncEnabled: z.coerce.boolean().default(true),
  remoteSyncIntervalMs: z.coerce.number().int().positive().default(30 * 60 * 1000),
  remoteSyncBatchSize: z.coerce.number().int().min(1).max(20).default(5),
  enrichmentEnabled: z.coerce.boolean().default(false),
  enrichmentIntervalMs: z.coerce.number().int().positive().default(6 * 60 * 60 * 1000),
  repoProfileEnabled: z.coerce.boolean().default(true),
  repoProfileIntervalMs: z.coerce.number().int().positive().default(24 * 60 * 60 * 1000),
  repoProfileBatchSize: z.coerce.number().int().min(1).max(20).default(5),
  suggestIntervalMs: z.coerce.number().int().positive().default(12 * 60 * 60 * 1000),
  suggestReactiveThreshold: z.coerce.number().int().min(1).default(1),
  suggestReactiveMinGapMs: z.coerce.number().int().positive().default(1 * 60 * 60 * 1000),
  suggestDeepMinCommits: z.coerce.number().int().min(1).default(20),
  suggestDeepActiveIntervalDays: z.coerce.number().int().min(1).default(7),
  suggestDeepDormantIntervalDays: z.coerce.number().int().min(1).default(30),
  suggestDeepDormantThresholdDays: z.coerce.number().int().min(1).default(14),
  suggestProjectMinGapDays: z.coerce.number().int().min(1).default(7),
  projectProfileMinGapMs: z.coerce.number().int().positive().default(4 * 60 * 60 * 1000),
});

/**
 * Whitelist of known `preferences` keys (audit W-07). Unknown keys arriving
 * via the API get silently stripped (`.strip()` on the schema) rather than
 * going into the generic `jsonb` bucket forever — that was the previous
 * behaviour with `z.record(z.string(), z.unknown())`. Keeps the preferences
 * column disciplined and self-documenting: if you grep this schema, you
 * know the entire surface area.
 *
 * Grouped:
 *   - enrichment.*    — external MCP enrichment feature flags + runtime filters
 *   - thought.*       — background thought generation tunables
 *   - models / efforts — per-phase LLM overrides (also exposed at top-level on
 *                        ProfileUpdateSchema for legacy reasons; either works)
 *   - autonomy        — per-repo auto-plan/auto-execute config
 *   - dailyTokenBudget — global LLM spend cap; see A-10
 *   - enrichmentServerOrder — UI-22: persisted order for the settings UI
 *   - _fieldConfidence — internal (shadow_profile_set writes it to remember
 *                        which fields the user explicitly set vs inferred)
 */
export const PreferencesSchema = z.object({
  enrichmentEnabled: z.boolean().optional(),
  enrichmentIntervalMin: z.number().int().min(1).optional(),
  enrichmentDisabledServers: z.array(z.string()).optional(),
  enrichmentDisabledProjects: z.array(z.string()).optional(),
  enrichmentServerOrder: z.array(z.string()).optional(),
  thoughtsEnabled: z.boolean().optional(),
  thoughtIntervalMinMs: z.number().int().min(1000).optional(),
  thoughtIntervalMaxMs: z.number().int().min(1000).optional(),
  thoughtDurationMs: z.number().int().min(1000).optional(),
  dailyTokenBudget: z.number().int().min(0).optional(),
  models: z.record(z.string(), z.string()).optional(),
  efforts: z.record(z.string(), z.string()).optional(),
  autonomy: z.record(z.string(), z.unknown()).optional(),
  _fieldConfidence: z.record(z.string(), z.number()).optional(),
}).strip();

/** Validates profile fields coming from the API / MCP. */
export const ProfileUpdateSchema = z.object({
  displayName: z.string().max(100).optional(),
  timezone: z.string().max(60).optional(),
  locale: z.string().max(10).optional(),
  proactivityLevel: z.coerce.number().int().min(1).max(10).optional(),
  models: ModelsSchema.partial().optional(),
  efforts: EffortsSchema.partial().optional(),
  preferences: PreferencesSchema.optional(),
}).strip();

/**
 * Daily token ceiling across all LLM calls. Lives inside profile.preferences
 * under this key. When exceeded, deferrable jobs (consolidate, reflect,
 * digests, chronicle lore, suggest-deep, enrichment) skip with a logged
 * reason. Critical jobs (heartbeat, runner execution, user-initiated MCP)
 * are never gated. 0 disables the cap. See audit A-10.
 */
export const DAILY_TOKEN_BUDGET_PREF_KEY = 'dailyTokenBudget';
export const DAILY_TOKEN_BUDGET_DEFAULT = 1_000_000;

export type ShadowConfig = z.infer<typeof ConfigSchema> & {
  resolvedDataDir: string;
  resolvedDatabasePath: string;
  resolvedArtifactsDir: string;
};
