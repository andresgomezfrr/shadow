import { z } from 'zod';

/**
 * Zod conventions for LLM-returned schemas (audit A-12):
 *
 *   - `.optional()` — LLM may OMIT the key entirely. Use for fields the model
 *     might decide aren't relevant to this response (e.g. profileUpdates
 *     when there's no mood signal).
 *
 *   - `.nullable().default(null)` — LLM may emit an explicit `null` value
 *     (or omit). Use for per-item fields that are semantically optional
 *     per-row (e.g. a suggestion's reasoningMd, repoId — "no reason yet",
 *     "not scoped to a repo"). The `.default(null)` also lets us use the
 *     field directly without null-coalescing after parse.
 *
 *   - `.default(X)` — LLM may omit, we coerce to X. Use for required
 *     fields where a sensible fallback exists (confidence=70, kind='pattern').
 *     Prefer defaults over `.optional()` when possible so callers don't
 *     have to handle undefined.
 *
 *   - `.nullable().optional()` — both absent and explicit null are valid,
 *     with no coerced default. Rare; only when downstream needs to
 *     distinguish "LLM didn't say" from "LLM said null".
 *
 * Rule of thumb: prefer `.default()` where sensible, `.nullable().default(null)`
 * for rowlevel optional, `.optional()` for whole-object optional. Avoid
 * `.optional()` on scalar LLM fields — it forces every caller to `?? default`.
 */

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

// Observation cleanup (audit P-03): deterministic apply over LLM-returned list.
// Replaces "tell LLM to call MCP resolve tools" with "pass obs list inline, parse JSON,
// apply resolutions server-side". No MCP roundtrip, hallucinated IDs caught.
export const ObserveCleanupResponseSchema = z.object({
  resolutions: z.array(z.object({
    id: z.string().min(1),
    resolve: z.boolean(),
    reason: z.string().default(''),
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

export const OBSERVE_CLEANUP_FORMAT =
  '{ "resolutions": [{ "id": string (existing observation id), "resolve": true/false, "reason": string }] }';
