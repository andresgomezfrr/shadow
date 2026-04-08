# Shadow — Backlog

Actualizado 2026-04-07. Items completados en [COMPLETED.md](COMPLETED.md).

---

## Prioridad media — Tests

### Tests MCP tools
53 tools, 0 tests. La interfaz principal de Shadow con Claude.

### Tests WorkspacePage filtros + lifecycle
Renderizado por filtro, transiciones de estado. (Renamed from RunsPage)

---

## Prioridad media — Sugerencias lifecycle

### Estado "resolved" para sugerencias
Las sugerencias aceptadas e implementadas quedan en "accepted" para siempre (30+ acumuladas). Añadir estado `resolved` para cerrar el ciclo: accepted → implementada → resolved. Actualizar: modelo, engine, MCP tools, dashboard filters, bulk resolve.

---

## Prioridad media — Dashboard UX

### Evaluar: trust por repo en vez de global *(2026-04-08)*
Actualmente el trust es un score global. Pero Shadow puede saber mucho de un repo y poco de otro — ¿tiene sentido que el trust sea por repo? Implicaría trust_score en la tabla `repos` en vez de `user_profile`, y gates por repo en los MCP tools. Hablar con Andrés antes de diseñar.

### Progreso visible en jobs multi-repo/multi-project *(2026-04-08)*
Jobs como repo-profile, remote-sync o suggest-deep iteran sobre varios repos/proyectos pero solo muestran una fase genérica. Mostrar progreso tipo "repo-profile: 3/6 repos" o "profiling: shadow" mientras corren. Aprovechar `setPhase` o `activity` para comunicar el item actual y el total.

### Botones de trigger deben reflejar estado queued/running del job *(2026-04-08)*
Al disparar un job desde el dashboard, si ya hay uno encolado o corriendo, el endpoint devuelve 409 pero el botón no lo refleja. Todos los botones que lanzan jobs deben mostrar estado "running" / disabled mientras `hasQueuedOrRunning(type)` sea true. Aplica a: schedule ribbon, botones de ProjectDetailPage (Suggest cross-repo, Profile), ReposPage, y cualquier otro trigger.

---

### Inyectar contexto de proyecto en heartbeat cuando el repo pertenece a uno *(2026-04-08)*
Al hacer check-in de un repo (heartbeat analyze), si el repo pertenece a un proyecto, incluir el contexto del proyecto (nombre, descripción, repos relacionados, observaciones y sugerencias activas del proyecto) en el prompt de análisis. Actualmente el heartbeat solo ve repos individuales — el contexto de proyecto ayudaría a generar memorias y observaciones más relevantes.

---

## Prioridad media — Job system tuning

### Evaluar intervalos de jobs con datos reales
Con Activity visibility, analizar: ¿consolidate LLM parte se ejecuta? ¿reflect produce cambios diarios significativos? ¿digests se consultan? Ajustar intervalos basándose en datos.

### Consolidate timing: no consumir correcciones antes de que otros jobs las vean
Si consolidate corre antes que repo-profile, consume la corrección y repo-profile no la ve. Evaluar si necesita coordinación.

### Consolidate: auto-fix de memorias mal clasificadas *(2026-04-08)*
Si durante consolidate el LLM detecta memorias con metadata incorrecta (repo equivocado, proyecto mal asignado, labels/kind/scope/layer inapropiados, entities_json incompleto), debería corregirlas automáticamente en vez de solo reorganizar layers. Ejemplos: memoria asociada a repo A que claramente habla de repo B, kind "pattern" que es realmente "improvement", scope incorrecto, o entidades faltantes que se pueden inferir del contenido.

---

## Prioridad media — Infraestructura de datos

### Junction table para knowledge entities *(2026-04-08)*
Reemplazar queries `json_each()` sobre `entities_json` con una tabla de junction `knowledge_entities` indexada. Afecta memorias, observaciones, sugerencias. Necesario para performance a escala (>1000 memorias). Actualmente usamos `json_each()` que hace table scan — funcional pero no escalable.

### MCP server ordering en dashboard *(2026-04-08)*
Drag-drop para reordenar MCP servers en la sección de Enrichment del dashboard. El orden sirve como hint para el LLM de enrichment sobre qué priorizar (ej: primero documentación, luego monitoring). Actualmente el LLM decide solo basándose en las descripciones.

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

### Descripciones de memorias no parsean `\n` correctamente *(2026-04-08)*
En el dashboard, las descripciones de memorias muestran `\n` literal en vez de saltos de línea. El contenido viene con newlines escapados del JSON y no se renderiza como markdown/texto multilínea.

### Evaluar: asegurar entity linking en memorias, observaciones, sugerencias y runs *(2026-04-08)*
No está claro si siempre estamos asociando `entities_json` (repo, proyecto) cuando la información lo permite. Auditar: ¿los jobs de heartbeat/suggest/teach siempre vinculan al repo/proyecto activo? ¿Los runs guardan su repo? ¿Hay entidades huérfanas sin linking? Importante para que los filtros por repo/proyecto funcionen bien.

### Evaluar: dónde trackear tickets de Jira — no son proyectos *(2026-04-08)*
Los tickets de Jira son temporales y no encajan como proyectos de Shadow (que son long-term/sprint/task y agrupan repos+systems). Necesitamos un mejor sitio para trackear work items externos. Opciones a evaluar: entidad nueva (tasks/tickets), relaciones en entity_relations, enrichment_cache, o extensión de runs. Pensar qué ciclo de vida tienen y cómo se relacionan con proyectos y repos.

### Soporte monorepo: un repo, múltiples proyectos con path prefixes *(2026-04-08)*
Un monorepo puede contener cientos de servicios/proyectos independientes (ej: 1400+ subdirectorios con BUILD.bazel como frontera). Shadow necesita:
1. **Path prefixes por proyecto** — vincular un proyecto a un subdirectorio del repo (`repo/service-a → Proyecto A`). Así observaciones, memorias y sugerencias se asocian al proyecto correcto dentro del monorepo.
2. **Detección de fronteras** — reconocer markers de proyecto (BUILD.bazel, package.json, pom.xml, go.mod, Cargo.toml) como delimitadores.
3. **Heartbeat scoping** — al analizar actividad de un monorepo, filtrar commits/diffs por path prefix del proyecto activo.
4. **Entity linking granular** — `entities_json` debería poder apuntar a repo+path, no solo repo.
Impacta: project detection, heartbeat extract, suggest, entity linking, dashboard filters.

### Agrupación por repo + búsqueda global en dashboard
Paginación y filtros ya existen. Falta: agrupación visual por repo, barra de búsqueda global.

---

## Long-term — Features (evaluar)

### Evaluar: custom Claude agents para jobs *(2026-04-08)*
Los jobs actuales usan prompts ad-hoc vía CLI/Agent SDK. Evaluar usar agentes de Claude personalizados (con system prompt, tools, y personalidad propios) para cada tipo de job. Podría mejorar consistencia y permitir iterar prompts por separado.

### Circuit breaker para LLM calls
Tras N fallos consecutivos, abrir circuito y saltar calls por cooldown.

### Scoring de señal en conversaciones
Ponderar conversaciones por densidad antes del prompt de analyze.

### Seguridad: CSP headers + rate limiting
Dashboard sin Content-Security-Policy. Sin rate limiting en API/MCP. Bajo riesgo (localhost only).

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
