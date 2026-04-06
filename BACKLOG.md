# Shadow — Backlog

Actualizado 2026-04-06. Items completados en [COMPLETED.md](COMPLETED.md).

---

## Prioridad media — Refactoring

### Extraer route handlers de web/server.ts
handleApi() monolítico ~400 líneas. Dividir en módulos por dominio (routes/suggestions.ts, routes/runs.ts, etc.)

### Extraer fases de activities.ts en módulos
activities.ts tiene extract, suggest, consolidate, reflect, cleanup. Cada fase en su propio módulo bajo heartbeat/.

### Middleware error handling + body parsing en web server
parseJsonBody con Zod validation. Consistencia en try/catch.

---

## Prioridad media — Tests

### Tests MCP trust gating
Verificar que los 20+ write tools respetan trust gates.

### Tests WorkspacePage filtros + lifecycle
Renderizado por filtro, transiciones de estado. (Renamed from RunsPage)

---

## Prioridad media — Job system tuning

### Evaluar intervalos de jobs con datos reales
Con Activity visibility, analizar: ¿consolidate LLM parte se ejecuta? ¿reflect produce cambios diarios significativos? ¿digests se consultan? Ajustar intervalos basándose en datos.

### Consolidate timing: no consumir correcciones antes de que otros jobs las vean
Si consolidate corre antes que repo-profile, consume la corrección y repo-profile no la ve. Evaluar si necesita coordinación.

---

## Prioridad baja

### Logs del daemon en dashboard
Los `console.error` van a `daemon.stderr.log` pero no son accesibles desde el dashboard. Endpoint `/api/logs` + página.

---

## Long-term — Trust Levels → [`docs/plan-trust-levels.md`](docs/plan-trust-levels.md)

### L4 — proactivo con LLM evaluator
Shadow actúa sin esperar accept. LLM evaluator filtra qué sugerencias merecen auto-ejecución.

### L5 — auto-merge selectivo
Autonomía por repo/scope configurable. Shadow mergea donde tiene permiso.

---

## Long-term — Arquitectura

### Concepto de Tarea/Iniciativa
Agrupación temporal (1-2 semanas) con repos, PRs, docs y tickets.

### Agrupación por repo + búsqueda global en dashboard
Paginación y filtros ya existen. Falta: agrupación visual por repo, barra de búsqueda global.

---

## Long-term — Features (evaluar)

### Circuit breaker para LLM calls
Tras N fallos consecutivos, abrir circuito y saltar calls por cooldown.

### Scoring de señal en conversaciones
Ponderar conversaciones por densidad antes del prompt de analyze.

### Validar completitud env vars → config en startup
Detectar campos del schema Zod sin mapeo a SHADOW_* env var.

### Generar BACKLOG.md desde DB con `shadow backlog`
Comando CLI que genera backlog desde sugerencias pending + observaciones activas.

### `shadow docs check` — drift detection
Comparar CLAUDE.md contra código real: tools count, routes, schema tables.

### LLM Memory Extraction post-Run
Cuando un run completa, analizar el output con LLM para extraer memorias ("este repo necesita X para compilar"). El output se guarda pero no se analiza.

### Suggestion Expiry → Preference Memory
Cuando una sugerencia expira sin respuesta, generar memoria: "usuario ignora sugerencias de tipo X". Feedback implícito que alimenta futuras sugerencias.

### Configurable allowedTools → [`docs/plan-allowed-tools-config.md`](docs/plan-allowed-tools-config.md)
User configura qué MCPs externos puede usar Shadow (GitHub, Slack, Linear).

### Correct button en Observations y Memories pages
Extender CorrectionPanel contextual (ya está en Repos) a observation cards y memory cards.
