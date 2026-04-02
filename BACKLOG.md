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

---

## Long-term / Arquitectura

### Concepto de Proyecto
Entidad contenedora que agrupa repos, memorias, sugerencias y observaciones. Un proyecto es permanente (ej: "Shadow", "Platform").

### Concepto de Tarea/Iniciativa
Agrupación temporal (1-2 semanas) que incluye repos, PRs, docs y tickets. Ciclo de vida acotado.

### Dos tipos de heartbeat
- **(a) Frecuente** — actividad reciente: conversaciones, interacciones.
- **(b) Mantenimiento** — rota entre repos progresivamente, no revisa todos cada vez. Escala con +40 repos.

### Semantic search (sqlite-vec)
Búsqueda híbrida FTS5 + vector search para memorias.

### UI preparada para escala (+40 repos)
Paginación real, filtros, agrupación, rendimiento en todas las vistas.

### Execute plan — verificación de resultado
Revisar diff generado, correr tests, presentar resumen de cambios. Merge desde dashboard a trust 4+.

### Trust 3: session pre-loaded con archivos relevantes
La sesión de Claude CLI debería incluir los file contents del plan, no solo el texto. Shadow lee los archivos relevantes y los inyecta en el prompt de la sesión.

### Trust 4: ejecución autónoma con review
Accept ejecuta autónomamente: branch, Claude CLI con plan, captura diff. Dashboard muestra diff para review. Approve → commit. Discard → borra branch.

### Trust 5: full autonomy
Branch + implement + test + PR. Si tests pasan → commit + PR. Si fallan → retry una vez. Morning brief muestra PRs completados.

### `shadow teach` — enseñanza interactiva
Comando CLI que abre sesión Claude CLI con los MCP tools de Shadow activos. El usuario enseña interactivamente y Shadow guarda memorias en tiempo real.

### Comunicación externa via MCP servers
Shadow se conecta a Slack, Linear, GitHub vía MCP servers externos. Puede: notificar en Slack, crear issues en Linear, comentar en PRs.

### Multi-repo operations
Sugerencias y runs que afectan múltiples repos simultáneamente. El schema ya soporta `repo_ids_json` pero la UI y el runner solo usan el primary repo.

---

## Deuda técnica

### Tests
Zero test coverage. Mínimo: database CRUD, FTS5 search, heartbeat state machine, observation dedup, suggestion lifecycle, run pipeline.

### Memorias mal clasificadas en core
Revisar criterio del prompt de analyze para layer core vs hot.

### Emoji Guide desactualizada
No refleja el status bar actual.

### Events: clarificar propósito
Los eventos se marcan delivered inmediatamente. Investigar si la página tiene sentido o se solapa con heartbeats/observaciones.

### Status line path frágil
Si cambia la versión de node, el path hardcodeado en el plist se rompe. Hacer dinámico.

### ASCII art mascota en status bar
Evaluar un animalito en one-line ASCII art que reaccione representando a Shadow visualmente.

### `[done]` CLAUDE.md desactualizado
Actualizado: 33 tools, 16 routes, Current State reescrito.
