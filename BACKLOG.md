# Shadow — Backlog

Actualizado 2026-04-11. Items completados en [COMPLETED.md](COMPLETED.md).

---

## Auditoría #2 — Hallazgos (2026-04-11)

### P0: jobs.ts JSON parse silencioso
`src/web/routes/jobs.ts:60` — `.catch(() => ({}))` traga JSON malformado en job trigger. Usar `parseOptionalBody` con schema Zod como ya hace el digest trigger en L72.

### P1: job-handlers.ts split (1266 líneas)
`src/daemon/job-handlers.ts` — 15 handlers en un archivo. Pasó umbral 1000-1500. Split propuesto: `handlers/suggest.ts` (~573), `handlers/profiling.ts` (~229), core lifecycle se queda (~464).

### P2: Focus duration sin bounds
`src/mcp/tools/profile.ts:91` — `parseInt(match[1])` acepta valores absurdos ("999999h"). Clamp a 168h (1 semana).

### P2: Zero ErrorBoundary en dashboard
Ningún ErrorBoundary en todo el dashboard React. Un crash en cualquier componente tumba la app.

### P2: useApi sin estado de error
`src/web/dashboard/src/hooks/useApi.ts` — devuelve `{ data, loading, refresh }` sin error state. Network errors indistinguibles de "vacío".

### P2: 3 catch blocks en runs.ts deberían loguear
`src/web/routes/runs.ts` L263, L377, L458 — catches silenciosos donde el error es diagnóstico útil (session ID parse, git diff, LLM title generation).

---

## Prioridad media — Tests

### Tests MCP tools
66 tools, 0 tests. La interfaz principal de Shadow con Claude.

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

### Heartbeat dedup para observations resueltas que reaparecen
Cuando `checkDuplicate()` encuentra match con observation resuelta, incrementar `votes` en vez de crear nueva.

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

### Junction table para knowledge entities *(2026-04-08)*
Reemplazar `json_each()` sobre `entities_json` con tabla de junction indexada. Necesario para performance a escala (>1000 memorias).

### MCP server ordering en dashboard *(2026-04-08)*
Drag-drop para reordenar MCP servers en Enrichment. El orden como hint para el LLM.

---

## Prioridad baja

### Logs del daemon en dashboard
Los `console.error` van a `daemon.stderr.log` pero no son accesibles desde el dashboard.

---

## Long-term — Trust Levels → [`docs/plan-trust-levels.md`](docs/plan-trust-levels.md)

### L4 — proactivo con LLM evaluator
Shadow actúa sin esperar accept. LLM evaluator filtra qué sugerencias merecen auto-ejecución.

### L5 — auto-merge selectivo
Autonomía por repo/scope configurable. Shadow mergea donde tiene permiso.

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
