import { z } from 'zod';

export const ModelsSchema = z.object({
  analyze: z.string().default('sonnet'),
  suggest: z.string().default('opus'),
  consolidate: z.string().default('opus'),
  runner: z.string().default('sonnet'),
  thought: z.string().default('haiku'),
  enrichPlan: z.string().default('sonnet'),
  enrichExecute: z.string().default('opus'),
  digestDaily: z.string().default('sonnet'),
  digestWeekly: z.string().default('opus'),
  digestBrag: z.string().default('opus'),
  repoProfile: z.string().default('sonnet'),
  suggestValidate: z.string().default('opus'),
});

export const EffortsSchema = z.object({
  analyze: z.string().default('medium'),
  suggest: z.string().default('high'),
  consolidate: z.string().default('medium'),
  runner: z.string().default('high'),
});

export const ConfigSchema = z.object({
  env: z.enum(['development', 'test', 'production']).default('development'),
  dataDir: z.string().min(1).optional(),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  backend: z.enum(['cli', 'api']).default('cli'),
  claudeBin: z.string().min(1).default('claude'),
  claudeExtraPath: z.string().min(1).optional(),
  runnerTimeoutMs: z.coerce.number().int().positive().default(10 * 60 * 1000),
  heartbeatIntervalMs: z.coerce.number().int().positive().default(15 * 60 * 1000),
  daemonPollIntervalMs: z.coerce.number().int().positive().default(30_000),
  proactivityLevel: z.coerce.number().int().min(1).max(10).default(5),
  personalityLevel: z.coerce.number().int().min(1).max(5).default(4),
  thoughtsEnabled: z.coerce.boolean().default(true),
  thoughtIntervalMinMs: z.coerce.number().int().positive().default(15 * 60 * 1000),
  thoughtIntervalMaxMs: z.coerce.number().int().positive().default(30 * 60 * 1000),
  thoughtDurationMs: z.coerce.number().int().positive().default(60_000),
  models: ModelsSchema.default({
    analyze: 'sonnet',
    suggest: 'opus',
    consolidate: 'opus',
    runner: 'sonnet',
    thought: 'haiku',
    enrichPlan: 'sonnet',
    enrichExecute: 'opus',
    digestDaily: 'sonnet',
    digestWeekly: 'opus',
    digestBrag: 'opus',
    repoProfile: 'sonnet',
    suggestValidate: 'opus',
  }),
  efforts: EffortsSchema.default({
    analyze: 'medium',
    suggest: 'high',
    consolidate: 'medium',
    runner: 'high',
  }),
  locale: z.string().default('es'),
  watcherEnabled: z.coerce.boolean().default(true),
  watcherDebounceMs: z.coerce.number().int().positive().default(30_000),
  watcherMaxWindowMs: z.coerce.number().int().positive().default(5 * 60 * 1000),
  activityHeartbeatMinIntervalMs: z.coerce.number().int().positive().default(3 * 60 * 1000),
  activityHeartbeatMaxIntervalMs: z.coerce.number().int().positive().default(30 * 60 * 1000),
  activityTriggerThreshold: z.coerce.number().int().positive().default(3),
  maxConcurrentRuns: z.coerce.number().int().min(1).max(8).default(2),
  maxConcurrentJobs: z.coerce.number().int().min(1).max(8).default(3),
  maxWatchedRepos: z.coerce.number().int().min(1).max(100).default(30),
  remoteSyncEnabled: z.coerce.boolean().default(true),
  remoteSyncIntervalMs: z.coerce.number().int().positive().default(30 * 60 * 1000),
  remoteSyncBatchSize: z.coerce.number().int().min(1).max(20).default(5),
  enrichmentEnabled: z.coerce.boolean().default(false),
  enrichmentIntervalMs: z.coerce.number().int().positive().default(2 * 60 * 60 * 1000),
  repoProfileEnabled: z.coerce.boolean().default(true),
  repoProfileIntervalMs: z.coerce.number().int().positive().default(24 * 60 * 60 * 1000),
  repoProfileBatchSize: z.coerce.number().int().min(1).max(20).default(5),
  suggestIntervalMs: z.coerce.number().int().positive().default(12 * 60 * 60 * 1000),
  suggestReactiveThreshold: z.coerce.number().int().min(1).default(3),
  suggestReactiveMinGapMs: z.coerce.number().int().positive().default(4 * 60 * 60 * 1000),
});

/** Validates profile fields coming from the API / MCP. */
export const ProfileUpdateSchema = z.object({
  displayName: z.string().max(100).optional(),
  timezone: z.string().max(60).optional(),
  locale: z.string().max(10).optional(),
  proactivityLevel: z.coerce.number().int().min(1).max(10).optional(),
  personalityLevel: z.coerce.number().int().min(1).max(5).optional(),
  models: ModelsSchema.partial().optional(),
  efforts: EffortsSchema.partial().optional(),
}).passthrough();

export type ShadowConfig = z.infer<typeof ConfigSchema> & {
  resolvedDataDir: string;
  resolvedDatabasePath: string;
  resolvedArtifactsDir: string;
};
