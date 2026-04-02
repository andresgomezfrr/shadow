# Shadow — Backlog

Actualizado 2026-04-02.

---

## Prioridad alta

### `[done]` Analyze prompt con contexto de observaciones existentes
### `[done]` Feedback loop: dismiss/accept enriquecen futuras sugerencias
### `[done]` Observaciones auto-resolve por condición
### `[done]` Run result truncado a 500 chars

---

## Prioridad media

### `[done]` Sugerencias operativas no son útiles
### `[done]` Sugerencias aceptadas/dismissed influyen en futuras
### `[done]` Dashboard — markdown rendering
### `[done]` Dashboard — sidebar badges con contadores
### `[done]` Morning page mejorada
### `[done]` Memorias con trazabilidad al heartbeat

### `[done]` Markdown en MemoriesPage + body expandible
Body renderizado con Markdown component. Expand muestra: body, tags, scope, confidence, source (type + heartbeat ID), accesses, dates.

### `[done]` Suggestions — filtro por kind
Segundo nivel de FilterTabs derivado dinámicamente de los kinds presentes. Solo aparece si hay más de 1 kind. Filtrado client-side.

---

## Prioridad baja

### Logs del daemon en dashboard
Los `console.error` del heartbeat van a `daemon.stderr.log` pero no son accesibles desde el dashboard. Endpoint `/api/logs` + página.

### `[done]` KeepAlive genera procesos zombie
Plist ahora usa `KeepAlive.Crashed: true` — solo relanza en crash, no tras stop limpio.

### `[done]` patterns.ts dead code
Eliminado. 104 líneas de dead code removidas.

### `[done]` logLevel config sin usar
Eliminado el único debug block. Config se mantiene en schema para futuro uso.

### `[done]` Prompts demasiado complejos — split analyze en 2 llamadas
Analyze dividido en Extract (memories + mood, effort medium) y Observe (observations + auto-resolve, effort medium). Cada prompt focado, menos reglas, mejor calidad.

### `[done]` Effort level configurable por fase
`--effort` flag en CLI adapter. Defaults: analyze=medium, suggest=high, consolidate=medium, runner=high. Configurable via env vars y dashboard profile.

### `[done]` MCP tool shadow_memory_update
Permite cambiar layer, body, tags, kind, scope de una memoria existente. Ya no hace falta SQL directo.

---

## Long-term / Arquitectura

### `[done]` 🔴 Feedback loop completo → [`docs/plan-feedback-loop.md`](docs/plan-feedback-loop.md)
Tabla `feedback` (migration v9). Razón en: resolve observación, dismiss sugerencia, discard run, archive/modify memoria. 👍/👎 toggle buttons con persistencia. Feedback se pasa a extract + observe prompts.

### `[done]` 🔴 Job system → [`docs/plan-job-system.md`](docs/plan-job-system.md)
Tabla `jobs` (migration v10), scheduler en daemon. Jobs: heartbeat (15min), suggest (reactivo), consolidate (6h), reflect (24h). Heartbeats table dropped. Dashboard Jobs con filter tabs + schedule header.

### `[done]` 🔴 Trust L2 complete → [`docs/plan-trust-levels.md`](docs/plan-trust-levels.md)
L2: plan completo (Claude MCP + filesystem), Open Session con briefing rico, Execute manual en worktree + branch. **Pendiente: L3 auto-execute con confidence/doubts gate, L4 proactivo, L5 auto-merge.**

### `[done]` 🟡 Reflect job
Job diario (Opus + effort high). Sintetiza feedback + memorias + observaciones → soul reflection. Se inyecta en extract/observe prompts. MCP tools: shadow_feedback, shadow_soul, shadow_soul_update.

### 🟡 Concepto de Proyecto
Entidad contenedora que agrupa repos, memorias, sugerencias y observaciones. Un proyecto es permanente (ej: "Shadow", "Platform").

### 🟡 Concepto de Tarea/Iniciativa
Agrupación temporal (1-2 semanas) que incluye repos, PRs, docs y tickets. Ciclo de vida acotado.

### 🟡 Semantic search (sqlite-vec)
Búsqueda híbrida FTS5 + vector search para memorias.

### 🟡 UI preparada para escala (+40 repos)
Paginación real, filtros, agrupación, rendimiento en todas las vistas.

### 🟡 Execute plan — verificación de resultado
Revisar diff generado, correr tests, presentar resumen de cambios. Draft PR / branch con diff review en dashboard.

### 🟡 `shadow teach` — enseñanza interactiva
Comando CLI que abre sesión Claude CLI con los MCP tools de Shadow activos. El usuario enseña interactivamente y Shadow guarda memorias en tiempo real.

### 🟡 Comunicación externa via MCP servers
Shadow se conecta a Slack, Linear, GitHub vía MCP servers externos. Puede: notificar en Slack, crear issues en Linear, comentar en PRs.

### 🟡 Multi-repo operations
Sugerencias y runs que afectan múltiples repos simultáneamente. El schema ya soporta `repo_ids_json` pero la UI y el runner solo usan el primary repo.

---

## Deuda técnica

### Tests
Zero test coverage. Mínimo: database CRUD, FTS5 search, heartbeat state machine, observation dedup, suggestion lifecycle, run pipeline.

### `[done]` Memorias mal clasificadas en core
4 archivadas (obsoletas/duplicados), 8 movidas a hot (bug fixes, detalles de implementación). Prompt afinado: "core = lo que necesitarías si reescribes desde cero". Default a hot cuando hay duda.

### `[done]` Emoji Guide desactualizada
Actualizada: status line example corregido (mood+energy antes de trust), tokens eliminados de notificaciones.

### Events → Activity feed
Convertir la página Events (actualmente vacía — eventos se marcan delivered inmediatamente) en un activity feed real: heartbeats, observations creadas, suggestions aceptadas, runs completados. Tipo timeline de actividad. Página oculta del sidebar hasta que se implemente.

### `[done]` Status line path frágil
Plist ya no hardcodea node path. Scripts usan tsx binstub con fallback a npx. Hooks resuelven paths relativos al proyecto.

### `[done]` ASCII art mascota en status bar
Ghost mascot `{•‿•}` con 13 estados, 3 variantes cada uno (micro-animaciones), colores ANSI por estado (purple/cyan/yellow/green/red/dim). Reemplaza el emoji de actividad. "Shadow" removido del texto — la cara ES Shadow.

### `[done]` CLAUDE.md desactualizado
Actualizado: 37 tools (17 read + 19 write L1 + 1 write L2), 15 routes, Current State reescrito con job system, reflect, feedback loop, ghost mascot.
