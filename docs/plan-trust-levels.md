# Plan: Trust Level Redesign

## Overview

Trust levels define how much autonomy Shadow has. The progression is about **who initiates, who implements, and who approves** — not about blocking features.

## Levels

### L1-2 — Observer/Advisor (0-35)
- Accept sugerencia → **plan completo** (Claude usa MCP + filesystem para generar plan detallado)
- **Open session** — tú implementas con contexto (briefing + MCP tools)
- **Execute** — disponible como acción manual. Shadow implementa en worktree + branch. Pero tú decides cuándo pulsar.
- Shadow propone, tú decides qué hacer con la propuesta.

### L3 — Assistant (35-60)
- Accept → genera plan → **auto-execute si no tiene dudas**
- Shadow evalúa su propio plan: `{ confidence: 'high' | 'medium' | 'low', doubts: string[] }`
- **Sin dudas (confidence high)** → auto-execute en worktree + branch. Te deja el branch/draft PR listo.
- **Con dudas** → se comporta como L2. Deja el plan en `completed`, espera tu input.
- Shadow nunca mergea en L3. Review obligatorio.
- Las dudas pueden ser: archivo no encontrado, cambio multi-repo ambiguo, observaciones contradictorias, test command desconocido.
- TODO: diseñar mecanismo de feedback para responder dudas de Shadow (¿chat en el dashboard? ¿nota en el run?)

### L4 — Partner (60-85)
- Shadow actúa **proactivamente** — no espera accept
- **LLM evaluator** filtra qué sugerencias merecen auto-ejecución:
  - impact × confidence / risk threshold
  - ¿Es segura? (no toca auth, no borra datos, no cambia infra)
  - ¿Tiene tests?
- Solo las que pasan el filtro se auto-ejecutan
- Las demás esperan accept como en L3
- Resultado: **PR ready for review**, tests verdes

### L5 — Shadow (85-100)
- **Autonomía selectiva por repo/scope**:
  - Config: `shadow config auto-merge --repo shadow --enabled`
  - Dentro de repo: limitar por tipo (solo lint/types, no features)
- Shadow mergea donde tiene permiso explícito
- Donde no tiene permiso → se comporta como L4
- Morning brief: "Mergeé 3 fixes en shadow. 1 PR abierto en platform."

## Resumen

| Nivel | Quién inicia | Quién ejecuta | Condición | Quién mergea |
|---|---|---|---|---|
| L1-2 | Tú (accept) | Tú (open session) o Shadow (execute manual) | Tú decides | Tú |
| L3 | Tú (accept) | Shadow (auto si sin dudas) o tú (si dudas) | confidence=high + no doubts | Tú (review) |
| L4 | Shadow (proactivo) | Shadow (filtrado por evaluator) | evaluator pass | Tú (review) |
| L5 | Shadow | Shadow | evaluator + permisos | Shadow (donde permitido) / Tú (resto) |

## Prerequisitos
- ✅ Feedback loop completo
- ✅ Job system
- ✅ Runner con MCP delegation
- Para L3: confidence/doubts en plan output
- Para L4: LLM evaluator job, GitHub MCP integration
- Para L5: auto-merge config per repo
