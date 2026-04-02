import { z } from 'zod';

export const ModelsSchema = z.object({
  analyze: z.string().default('sonnet'),
  suggest: z.string().default('opus'),
  consolidate: z.string().default('sonnet'),
  runner: z.string().default('sonnet'),
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
  models: ModelsSchema.default({
    analyze: 'sonnet',
    suggest: 'opus',
    consolidate: 'sonnet',
    runner: 'sonnet',
  }),
  efforts: EffortsSchema.default({
    analyze: 'medium',
    suggest: 'high',
    consolidate: 'medium',
    runner: 'high',
  }),
  locale: z.string().default('es'),
});

export type ShadowConfig = z.infer<typeof ConfigSchema> & {
  resolvedDataDir: string;
  resolvedDatabasePath: string;
  resolvedArtifactsDir: string;
};
