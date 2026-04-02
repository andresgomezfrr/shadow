# Plan: Trust Level Redesign

## Overview

Trust levels define how much autonomy Shadow has. The progression is about **who initiates, who implements, and who approves** — not about blocking features.

## Levels

### L1-2 — Observer/Advisor (0-35)
- Accept sugerencia → **plan completo** (con archivos + memorias + contexto)
- Open session disponible — tú implementas con contexto
- Shadow **no ejecuta** — solo genera planes
- Razón: Shadow aún no te conoce lo suficiente para ejecutar con calidad

### L3 — Assistant (35-60)
- Accept → plan completo → puedes:
  - **Open session** — tú implementas
  - **Execute** — Shadow implementa en worktree, crea branch `shadow/xxx`, deja **draft PR** o branch con diff
- Review obligatorio. Shadow nunca mergea en L3.
- El plan incluye archivos leídos, memorias relevantes, observaciones relacionadas

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

| Nivel | Quién inicia | Qué produce | Quién mergea |
|---|---|---|---|
| L1-2 | Tú (accept) | Plan completo + Open session | Tú (manual) |
| L3 | Tú (accept) | Branch + diff / draft PR | Tú (review) |
| L4 | Shadow (filtrado por evaluator) | PR ready + tests verdes | Tú (review) |
| L5 | Shadow | PR + merge donde permitido | Shadow (permisos) / Tú (resto) |

## Prerequisitos
- Feedback loop completo (ver plan-feedback-loop.md)
- Job system (ver plan-job-system.md)
- GitHub MCP integration (para PRs)
