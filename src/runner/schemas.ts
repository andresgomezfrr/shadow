import { z } from 'zod';

export const ConfidenceEvaluationSchema = z.object({
  confidence: z.enum(['high', 'medium', 'low']),
  doubts: z.array(z.string()).default([]),
});

export type ConfidenceEvaluation = z.infer<typeof ConfidenceEvaluationSchema>;
