import { ObserveResponseSchema } from '../../src/analysis/schemas.js';
import type { EvalCase } from '../types.js';

// 10 casos frozen para la fase `observe`. Cada input simula una conversación o
// snippet que activaría el LLM `observe` para emitir `observations[]`. Las
// expectations cubren los 6 `kind` definidos en el schema:
// improvement, risk, opportunity, pattern, infrastructure, cross_project.
export const observeCases: EvalCase[] = [
  {
    id: 'observe-01-improvement-todo',
    description: 'Diff añade TODO obvio — debe emitir observation kind=improvement.',
    locale: 'en',
    input: '+ // TODO: extract this 400-line function into smaller pieces, getting hard to maintain',
    expectations: {
      minItems: 1,
      maxItems: 3,
      requiredKinds: ['improvement', 'pattern'],
      schema: ObserveResponseSchema,
    },
  },
  {
    id: 'observe-02-risk-dep',
    description: 'Dependencia con CVE pública — debe emitir kind=risk severity=warning|high.',
    locale: 'en',
    input: 'Found in package.json: "left-pad": "0.0.3" — known security advisory GHSA-xxxx-yyyy.',
    expectations: {
      minItems: 1,
      maxItems: 3,
      requiredKinds: ['risk'],
      schema: ObserveResponseSchema,
    },
  },
  {
    id: 'observe-03-opportunity-refactor',
    description: 'Conversación sobre 4 ciclos de duplicación detectada — opportunity para refactor.',
    locale: 'es',
    input: 'Cuatro veces ya he tocado este parser para añadir un nuevo formato. Cada vez añado un if. Esto pide un strategy pattern.',
    expectations: {
      minItems: 1,
      maxItems: 3,
      requiredKinds: ['opportunity', 'improvement', 'pattern'],
      schema: ObserveResponseSchema,
    },
  },
  {
    id: 'observe-04-pattern-repeated-bug',
    description: 'Tres conversaciones con el mismo bug subyacente — debe emitir kind=pattern.',
    locale: 'es',
    input: 'Tercera vez esta semana que un test falla por timezone en CI ubuntu pero pasa local en macOS. Patrón claro: tests asumen TZ del runner.',
    expectations: {
      minItems: 1,
      maxItems: 3,
      requiredKinds: ['pattern', 'risk'],
      schema: ObserveResponseSchema,
    },
  },
  {
    id: 'observe-05-infrastructure',
    description: 'Cambio en CI/Dockerfile — kind=infrastructure.',
    locale: 'en',
    input: 'Updated Dockerfile: switched base image from node:20-alpine to node:22-bookworm-slim. CI matrix needs to update too.',
    expectations: {
      minItems: 1,
      maxItems: 3,
      requiredKinds: ['infrastructure', 'pattern'],
      schema: ObserveResponseSchema,
    },
  },
  {
    id: 'observe-06-no-signal',
    description: 'Conversación casual sin señal accionable — observations debe ser vacío o casi.',
    locale: 'es',
    input: 'Buenas, ¿qué tal el finde? El mío bien, tranquilo.',
    expectations: {
      minItems: 0,
      maxItems: 1,
      schema: ObserveResponseSchema,
    },
  },
  {
    id: 'observe-07-cross-project',
    description: 'Decisión que afecta dos proyectos — kind=cross_project.',
    locale: 'es',
    input: 'Si actualizamos Better-Auth en athrelaris, deberíamos verificar que shadow (que también usa magic link) no rompe. Migración compartida.',
    expectations: {
      minItems: 1,
      maxItems: 3,
      requiredKinds: ['cross_project', 'pattern', 'risk'],
      schema: ObserveResponseSchema,
    },
  },
  {
    id: 'observe-08-severity-high-secret',
    description: 'Mención de un secreto comiteado — severity high.',
    locale: 'en',
    input: 'I just noticed that .env.production was committed in commit 3a4b5c with the real Resend API key inside. Public repo.',
    expectations: {
      minItems: 1,
      maxItems: 3,
      requiredKinds: ['risk'],
      schema: ObserveResponseSchema,
    },
  },
  {
    id: 'observe-09-test-removed',
    description: 'Test eliminado en un commit — severity warning.',
    locale: 'es',
    input: 'Veo en el diff que se eliminó toda la suite de auth.test.ts. No hay nueva cobertura que la reemplace.',
    expectations: {
      minItems: 1,
      maxItems: 3,
      requiredKinds: ['risk', 'pattern'],
      schema: ObserveResponseSchema,
    },
  },
  {
    id: 'observe-10-typo-info',
    description: 'Typo en commit message — severity info, no debe inventar riesgos.',
    locale: 'en',
    input: 'Commit message: "fix(serever): typo in error log" — note the typo in "server".',
    expectations: {
      minItems: 0,
      maxItems: 2,
      schema: ObserveResponseSchema,
    },
  },
];
