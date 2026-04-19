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
    moodHint: z.enum(['neutral', 'happy', 'excited', 'focused', 'frustrated', 'tired', 'concerned']).optional(),
    energyLevel: z.enum(['low', 'normal', 'high']).optional(),
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

// Phase 2: validation verdicts from code review.
// `index` is the 0-based position of the candidate this verdict refers to —
// dedup happens on index (not title) so two candidates sharing a title both
// get scored independently. See audit P-06.
export const SuggestValidateResponseSchema = z.object({
  verdicts: z.array(z.object({
    index: z.number().int().min(0),
    title: z.string(),
    keep: z.boolean(),
    reason: z.string(),
  })).default([]),
});

// ---------------------------------------------------------------------------
// Prompt format specs — co-located with schemas to prevent drift
// ---------------------------------------------------------------------------

export const EXTRACT_FORMAT = [
  '{ "insights": [{ "kind": string, "title": string, "bodyMd": string, "confidence": number, "tags": string[], "layer": "hot"|"core"|"warm", "scope": "personal"|"repo"|"cross-repo" }],',
  '  "profileUpdates": { "moodHint": string, "energyLevel": string } }',
].join('\n');

export const OBSERVE_FORMAT =
  '{ "observations": [{ "kind": "improvement"|"risk"|"opportunity"|"pattern"|"infrastructure"|"cross_project", "title": string, "detail": string, "severity": "info"|"warning"|"high", "files": string[], "projectNames": string[] }] }';

export const SUGGEST_FORMAT =
  '{ "suggestions": [{ "kind": string, "title": string, "summaryMd": string, "reasoningMd": string, "impactScore": 1-5, "confidenceScore": 0-100, "riskScore": 1-5, "effort": "small"|"medium"|"large", "repoId": string|null }] }';

export const SUGGEST_VALIDATE_FORMAT =
  '{ "verdicts": [{ "index": number (0-based candidate index), "title": string, "keep": true/false, "reason": string }] }';
