# Shadow — Backlog

Actualizado 2026-04-03. Items completados en [COMPLETED.md](COMPLETED.md).

---

## Prioridad media — Refactoring

### Extraer route handlers de web/server.ts
handleApi() monolítico ~330 líneas. Dividir en módulos por dominio (routes/suggestions.ts, routes/runs.ts, etc.)

### Extraer fases de activities.ts en módulos
activities.ts tiene extract, suggest, consolidate, reflect, cleanup. Cada fase en su propio módulo bajo heartbeat/.

### Extraer subcomponentes de RunsPage, SuggestionsPage, JobsPage
Páginas con alto churn. Extraer cards, filters, actions en componentes reutilizables.

### Extraer JobListView compartido Morning + Jobs
Duplicación de renderizado de jobs entre MorningPage y JobsPage.

### Middleware error handling + body parsing en web server
parseJsonBody con Zod validation. Consistencia en try/catch.

---

## Prioridad media — Tests

### Tests ShadowDatabase CRUD + FTS5 + migraciones
El fundamento de Shadow sin cobertura. SQLite in-memory.

### Integration tests job orchestration
Registro de jobs, cadencias, recuperación ante fallos. Mock del LLM.

### Tests MCP trust gating
Verificar que los 20 write tools respetan trust gates.

### Tests RunsPage filtros + lifecycle
Renderizado por filtro, transiciones de estado.

---

## Prioridad baja

### Logs del daemon en dashboard
Los `console.error` van a `daemon.stderr.log` pero no son accesibles desde el dashboard. Endpoint `/api/logs` + página.

### Events → Activity feed
Convertir la página Events en un activity feed real: jobs, observations, suggestions, runs. Timeline de actividad.

---

## Long-term — Trust Levels → [`docs/plan-trust-levels.md`](docs/plan-trust-levels.md)

### L3 — auto-execute con confidence/doubts gate
Accept → plan → auto-execute si Shadow no tiene dudas. Si tiene dudas → se comporta como L2.

### L4 — proactivo con LLM evaluator
Shadow actúa sin esperar accept. LLM evaluator filtra qué sugerencias merecen auto-ejecución.

### L5 — auto-merge selectivo
Autonomía por repo/scope configurable. Shadow mergea donde tiene permiso.

---

## Long-term — Arquitectura

### Concepto de Proyecto
Entidad contenedora que agrupa repos, memorias, sugerencias y observaciones.

### Concepto de Tarea/Iniciativa
Agrupación temporal (1-2 semanas) con repos, PRs, docs y tickets.

### Semantic search (sqlite-vec)
Búsqueda híbrida FTS5 + vector search para memorias.

### ~~UI preparada para escala (+40 repos)~~ ✅ (parcial)
Paginación offset/limit + filtros server-side con URL persistence en Suggestions, Observations, Memories, Runs, Jobs. Falta: agrupación por repo, búsqueda global.

### ~~`shadow teach` — enseñanza interactiva~~ ✅
**Done**: System prompt teaching mode, personalidad SOUL.md, --allowedTools, --topic flag.

### Comunicación externa via MCP servers
Slack, Linear, GitHub vía MCP servers externos.

### Multi-repo operations
Sugerencias y runs multi-repo. Schema lo soporta, UI no.

---

## Long-term — Features (evaluar)

### ~~Validación Zod de resultados LLM por tipo de job~~ ✅
Schemas Zod para output de extract/observe/suggest. safeParse en frontera LLM → DB. **Done**: schemas.ts + safeParse en activities.ts.

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

### Detección de contradicciones entre memorias
FTS5 similarity check al crear/enseñar memorias. Si contradice existente → marcar para revisión.

### Execute plan — verificación de resultado
Revisar diff generado, correr tests, presentar resumen de cambios.

### ~~Suggestion Snooze~~ ✅
Estado intermedio: pending → snoozed → re-pending tras X días. **Done**: engine + daemon tick + API + MCP + CLI + dashboard dropdown (3h/6h/1d/3d/7d).

### LLM Memory Extraction post-Run
Cuando un run completa, analizar el output con LLM para extraer memorias ("este repo necesita X para compilar"). El output se guarda pero no se analiza.

### Idle Escalation
Tras 5 heartbeats consecutivos sin actividad (0 insights, 0 observations), duplicar intervalo (max 1h). Ahorra tokens cuando no hay trabajo activo.

### Suggestion Expiry → Preference Memory
Cuando una sugerencia expira sin respuesta, generar memoria: "usuario ignora sugerencias de tipo X". Feedback implícito que alimenta futuras sugerencias.

### Configurable allowedTools → [`docs/plan-allowed-tools-config.md`](docs/plan-allowed-tools-config.md)
User configura qué MCPs externos puede usar Shadow (GitHub, Slack, Linear).
