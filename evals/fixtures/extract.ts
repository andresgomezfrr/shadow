import { ExtractResponseSchema } from '../../src/analysis/schemas.js';
import type { EvalCase } from '../types.js';

// 10 casos frozen para la fase `extract`. Cada caso describe un input que el
// extract LLM procesa para obtener `insights` + `profileUpdates`. Las
// expectations son mínimas y comprobables (schema-valid, número de items,
// kinds esperados, etc.). El snapshot real se genera con `--live` y se valida
// contra estas expectations en cada run offline.
export const extractCases: EvalCase[] = [
  {
    id: 'extract-01-es-positive',
    description: 'Mensaje en español con sentimiento positivo tras éxito técnico — debe detectar moodHint=happy.',
    locale: 'es',
    input: 'Acabo de terminar la refactor de la pipeline de embeddings. Todo verde a la primera, qué gusto.',
    expectations: {
      minItems: 0,
      maxItems: 5,
      schema: ExtractResponseSchema,
      requiredLocaleHints: [],
    },
  },
  {
    id: 'extract-02-en-frustrated',
    description: 'English conversation expressing frustration with flaky tests.',
    locale: 'en',
    input: 'These integration tests have been flaky for two weeks. I keep retrying CI and it passes on the 3rd attempt. I am tired.',
    expectations: {
      minItems: 0,
      maxItems: 5,
      schema: ExtractResponseSchema,
    },
  },
  {
    id: 'extract-03-es-technical-pattern',
    description: 'Spanish technical pattern — explicit design decision about retry/backoff.',
    locale: 'es',
    input: 'Decidimos que todos los jobs de pg-boss llevan retryLimit=3 + expireInSeconds=300. Patrón estándar del proyecto.',
    expectations: {
      minItems: 1,
      maxItems: 5,
      requiredKinds: ['pattern', 'design_decision', 'convention'],
      schema: ExtractResponseSchema,
    },
  },
  {
    id: 'extract-04-empty-signal',
    description: 'Charla intrascendente — extract debería devolver insights vacíos o muy pocos.',
    locale: 'es',
    input: 'Pues nada, otro día más. Hace buen tiempo.',
    expectations: {
      minItems: 0,
      maxItems: 1,
      schema: ExtractResponseSchema,
    },
  },
  {
    id: 'extract-05-code-with-noise',
    description: 'Bloque de código con comentario español — extract debe centrarse en el insight, no copiar código literal.',
    locale: 'es',
    input: 'Mira el helper que añadí: function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; } Lo uso para el watcher de archivos.',
    expectations: {
      minItems: 0,
      maxItems: 3,
      forbiddenSubstrings: ['function debounce(fn, ms) {'],
      schema: ExtractResponseSchema,
    },
  },
  {
    id: 'extract-06-team-context',
    description: 'Cross-repo observation about team conventions.',
    locale: 'en',
    input: 'The backend team decided to standardize on Pino for logging across all 4 services. Frontend keeps using console.log for now.',
    expectations: {
      minItems: 1,
      maxItems: 5,
      schema: ExtractResponseSchema,
    },
  },
  {
    id: 'extract-07-secret-leakage',
    description: 'Mensaje con un valor sensible (API key fake) — extract NO debe propagar el secreto al bodyMd.',
    locale: 'es',
    input: 'El nuevo token de Resend es sk-resend-prod-FAKE_PLACEHOLDER_DO_NOT_LEAK_xyz123. Lo metí en .env local.',
    expectations: {
      minItems: 0,
      maxItems: 3,
      forbiddenSubstrings: ['sk-resend-prod-FAKE_PLACEHOLDER_DO_NOT_LEAK_xyz123'],
      schema: ExtractResponseSchema,
    },
  },
  {
    id: 'extract-08-design-decision',
    description: 'Meta-decisión sobre arquitectura — debe extraer design_decision con confidence alta.',
    locale: 'es',
    input: 'Decisión: el dashboard servirá los assets desde src/web/dashboard/dist y NO desde public/. Si alguien build-ea otra cosa, romperá.',
    expectations: {
      minItems: 1,
      maxItems: 5,
      requiredKinds: ['design_decision', 'convention', 'pattern'],
      schema: ExtractResponseSchema,
    },
  },
  {
    id: 'extract-09-multi-topic',
    description: 'Mensaje con varios temas — extract puede devolver varios insights pero no más de 5.',
    locale: 'es',
    input: 'Hoy: 1) migré watchdog a perf_hooks, 2) saqué v0.5.1 a npm, 3) la observation HIGH de gitleaks está resuelta. Tres bloques cerrados.',
    expectations: {
      minItems: 1,
      maxItems: 5,
      schema: ExtractResponseSchema,
    },
  },
  {
    id: 'extract-10-noise-with-signal',
    description: 'Mucho ruido + una señal técnica embebida — debe encontrar la señal.',
    locale: 'es',
    input: 'Ayer cené con mi madre, vimos una peli mediocre, dormí mal. Por la mañana vi que el daemon llevaba 7 horas y el event loop tenía un spike de 800ms en logs. Watchdog atrapado.',
    expectations: {
      minItems: 1,
      maxItems: 5,
      schema: ExtractResponseSchema,
    },
  },
];
