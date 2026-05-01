import type { z } from 'zod';

export type EvalPhase = 'extract' | 'observe';

export type EvalExpectations = {
  minItems?: number;
  maxItems?: number;
  requiredKinds?: string[];
  forbiddenSubstrings?: string[];
  requiredLocaleHints?: string[];
  // Si está presente, debe parsear el snapshot completo sin error.
  schema?: z.ZodTypeAny;
};

export type EvalCase = {
  id: string;
  description: string;
  locale: 'es' | 'en';
  input: string;
  expectations: EvalExpectations;
};

export type EvalCheck = {
  name: string;
  ok: boolean;
  detail?: string;
};

export type EvalResult = {
  id: string;
  status: 'pass' | 'fail' | 'missing-snapshot';
  checks: EvalCheck[];
};
