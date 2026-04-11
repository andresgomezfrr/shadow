import { z } from 'zod';
import type { ShadowDatabase } from '../storage/database.js';

// --- Schemas ---

export const AutoPlanRulesSchema = z.object({
  enabled: z.boolean().default(false),
  effortMax: z.enum(['small', 'medium', 'large']).default('medium'),
  riskMax: z.number().int().min(1).max(5).default(3),
  impactMin: z.number().int().min(1).max(5).default(3),
  confidenceMin: z.number().int().min(0).max(100).default(60),
  minAgeHours: z.number().positive().default(5),
  kinds: z.array(z.string()).default([]), // empty = all kinds allowed
  repoIds: z.array(z.string()).default([]), // empty = none (opt-in per repo)
  maxPerJob: z.number().int().min(1).max(10).default(3),
});

export const AutoExecuteRulesSchema = z.object({
  enabled: z.boolean().default(false),
  effortMax: z.enum(['small', 'medium', 'large']).default('small'),
  riskMax: z.number().int().min(1).max(5).default(2),
  impactMin: z.number().int().min(1).max(5).default(3),
  confidenceMin: z.number().int().min(0).max(100).default(70),
  kinds: z.array(z.string()).default(['refactor', 'improvement']),
  repoIds: z.array(z.string()).default([]), // empty = none (opt-in per repo)
  maxPerJob: z.number().int().min(1).max(10).default(3),
  // NOTE: confidence eval gate (high + 0 doubts) is HARDCODED, not configurable
});

export const AutonomyConfigSchema = z.object({
  planRules: AutoPlanRulesSchema.default(() => AutoPlanRulesSchema.parse({})),
  executeRules: AutoExecuteRulesSchema.default(() => AutoExecuteRulesSchema.parse({})),
});

export type AutoPlanRules = z.infer<typeof AutoPlanRulesSchema>;
export type AutoExecuteRules = z.infer<typeof AutoExecuteRulesSchema>;
export type AutonomyConfig = z.infer<typeof AutonomyConfigSchema>;

// --- Effort helpers ---

const EFFORT_ORDER: Record<string, number> = { small: 0, medium: 1, large: 2 };

export function effortWithinLimit(estimated: string, max: string): boolean {
  return (EFFORT_ORDER[estimated] ?? 1) <= (EFFORT_ORDER[max] ?? 1);
}

// --- Config loader ---

export function loadAutonomyConfig(db: ShadowDatabase): AutonomyConfig {
  const profile = db.ensureProfile();
  const prefs = profile.preferences as Record<string, unknown>;
  const raw = prefs?.autonomy ?? {};
  return AutonomyConfigSchema.parse(raw);
}
