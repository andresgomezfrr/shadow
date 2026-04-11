# Shadow — Backlog

Actualizado 2026-04-11. Items completados en [COMPLETED.md](COMPLETED.md).

---

## Auditoría #2 — Pendiente (2026-04-11)

### P3: Tablas sin mecanismo de limpieza
`interactions`, `event_queue`, `llm_usage`, `jobs`, `feedback` crecen sin límite. Sin retention policy ni cleanup job. Implementar como job type `cleanup` (IO, daily). Bajo impacto actual, relevante a largo plazo.

---

## Prioridad media — Tests

### Tests WorkspacePage filtros + lifecycle
Renderizado por filtro, transiciones de estado del feed unificado y context panel.

---

## Prioridad media — Runner

### Pendiente de evaluar
- **Auto-accept de planes**: planes de alta confidence que se auto-ejecutan sin revisión. Necesita UI para configurar umbral y tipos de sugerencia que pueden auto-aceptarse.
- **Plan demasiado largo**: repos con archivos grandes pueden saturar contexto. Evaluar file size hints en briefing o exclusión de archivos grandes.
- **Timeout de planes**: 15min puede ser corto para repos grandes con Opus. Evaluar si necesita timeout diferenciado para plan vs execute.

---

## Prioridad media — Workspace & Runs

### Detectar PRs creados fuera de Shadow
Si un run tiene worktree pero no prUrl, detectar si existe un PR con `gh pr list --head shadow/{id}`.

### Warning de worktree huerfano en workspace
Si un run terminal tiene `worktreePath` pero el directorio ya no existe, mostrar warning visual.

---

## Prioridad media — Dashboard UX

### Evaluar: trust por repo en vez de global *(2026-04-08)*
Trust global vs per-repo. Shadow puede saber mucho de un repo y poco de otro. Hablar antes de diseñar.

---

## Prioridad media — Job system tuning

### Evaluar intervalos de jobs con datos reales
Analizar: ¿consolidate produce cambios? ¿reflect produce cambios significativos? ¿digests se consultan?

### Consolidate timing: no consumir correcciones antes de que otros jobs las vean
Si consolidate corre antes que repo-profile, consume la corrección y repo-profile no la ve.

---

## Prioridad media — Infraestructura de datos

### MCP server ordering en dashboard *(2026-04-08)*
Drag-drop para reordenar MCP servers en Enrichment. El orden como hint para el LLM.

---

## Prioridad baja

### Logs del daemon en dashboard
Los `console.error` van a `daemon.stderr.log` pero no son accesibles desde el dashboard.

---

## Long-term — Autonomy evolution

### L5 — auto-merge selectivo
Autonomía por repo/scope configurable. Shadow mergea donde tiene permiso. Requiere evaluación post-L4.

### Trust gamification redesign
Trust uncapped de 5, nuevos niveles, enfoque gamificación/veteranía en vez de capability gating. Score + deltas ya se mantienen.

---

## Long-term — Arquitectura

### Evaluar: asegurar entity linking en memorias, observaciones, sugerencias y runs *(2026-04-08)*
Auditar si siempre estamos asociando `entities_json` cuando la información lo permite.

### Soporte monorepo: un repo, múltiples proyectos con path prefixes *(2026-04-08)*
Path prefixes por proyecto, detección de fronteras (BUILD.bazel, package.json), heartbeat scoping, entity linking granular.

### Agrupación por repo + búsqueda global en dashboard
Agrupación visual por repo, barra de búsqueda global.

---

## Long-term — Features (evaluar)

### Circuit breaker para LLM calls
Tras N fallos consecutivos, abrir circuito y saltar calls por cooldown.

### Scoring de señal en conversaciones
Ponderar conversaciones por densidad antes del prompt de analyze.

### Seguridad: CSP headers + rate limiting
Dashboard sin Content-Security-Policy. Sin rate limiting en API/MCP.

### `shadow docs check` — drift detection
Comparar CLAUDE.md contra código real: tools count, routes, schema tables.

### LLM Memory Extraction post-Run
Cuando un run completa, analizar output con LLM para extraer memorias.

### Suggestion Expiry → Preference Memory
Sugerencia expirada sin respuesta → memoria de preferencia implícita.

### Configurable allowedTools → [`docs/plan-allowed-tools-config.md`](docs/plan-allowed-tools-config.md)
User configura qué MCPs externos puede usar Shadow.

### Correct button en Observations y Memories pages
Extender CorrectionPanel contextual a observation cards y memory cards.
