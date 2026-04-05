import { z } from 'zod';

export const ExtractResponseSchema = z.object({
  insights: z.array(z.object({
    kind: z.string().default('pattern'),
    title: z.string(),
    bodyMd: z.string(),
    confidence: z.number().min(0).max(100).default(70),
    tags: z.array(z.string()).default([]),
    layer: z.enum(['core', 'hot', 'warm']).default('hot'),
    scope: z.enum(['personal', 'repo', 'cross-repo']).default('personal'),
  })).default([]),
  profileUpdates: z.object({
    moodHint: z.string().optional(),
    energyLevel: z.string().optional(),
  }).optional(),
});

export const ObserveResponseSchema = z.object({
  observations: z.array(z.object({
    kind: z.enum(['improvement', 'risk', 'opportunity', 'pattern', 'infrastructure', 'cross_project']).default('pattern'),
    title: z.string(),
    detail: z.string().default(''),
    severity: z.enum(['info', 'warning', 'high']).default('info'),
    files: z.array(z.string()).default([]),
    projectNames: z.array(z.string()).default([]),
  })).default([]),
});

export const SuggestResponseSchema = z.object({
  suggestions: z.array(z.object({
    kind: z.string().default('improvement'),
    title: z.string(),
    summaryMd: z.string(),
    reasoningMd: z.string().nullable().default(null),
    impactScore: z.number().min(1).max(5).default(3),
    confidenceScore: z.number().min(0).max(100).default(70),
    riskScore: z.number().min(1).max(5).default(2),
    effort: z.enum(['small', 'medium', 'large']).default('medium'),
    repoId: z.string().nullable().default(null),
  })).default([]),
});

// Phase 2: validation verdicts from code review
export const SuggestValidateResponseSchema = z.object({
  verdicts: z.array(z.object({
    title: z.string(),
    keep: z.boolean(),
    reason: z.string(),
  })).default([]),
});
