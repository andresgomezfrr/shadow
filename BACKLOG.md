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

### Filtro por repo en Suggestions y Observations pages *(2026-04-08)*
Añadir selector de repo para filtrar sugerencias y observaciones. Ya existe `repo_ids_json` en ambas tablas. Observations ya soporta `repoId` en el backend — falta el UI. Suggestions necesita backend + UI.

### Proteger trust level/score contra escritura vía MCP *(2026-04-08)*
Shadow (el LLM) no debería poder cambiarse su propio trust level o score llamando a `shadow_profile_set`. El trust debe crecer orgánicamente con uso, pero nunca por set manual desde el LLM. Excluir `trust_level` y `trust_score` de los campos permitidos en `profile_set`, o añadir un gate específico.

### Evaluar: trust por repo en vez de global *(2026-04-08)*
Actualmente el trust es un score global. Pero Shadow puede saber mucho de un repo y poco de otro — ¿tiene sentido que el trust sea por repo? Implicaría trust_score en la tabla `repos` en vez de `user_profile`, y gates por repo en los MCP tools. Hablar con Andrés antes de diseñar.

### Títulos de sugerencias no clickables en suggest-deep y suggest-project *(2026-04-08)*
En Activity, los jobs `suggest-deep` y `suggest-project` guardan `suggestionTitles` (solo strings) en su resultado, mientras que `suggest` guarda `suggestionItems` (con id + title). Sin el ID, el dashboard no puede generar links a `/suggestions?highlight=<id>`. Fix: que los handlers de suggest-deep y suggest-project devuelvan `suggestionItems` con IDs como hace suggest.

### Chips de kind en Suggestions con color por tipo *(2026-04-08)*
Los badges de kind (performance, security, code-quality, etc.) usan un color genérico. Cada kind debería tener su propio color como en Observations.

### Renombrar botón "Analyze cross-repo" a "Suggest cross-repo" *(2026-04-08)*
En ProjectDetailPage. El botón lanza `suggest-project`, no un análisis — el nombre actual confunde.

### Progreso visible en jobs multi-repo/multi-project *(2026-04-08)*
Jobs como repo-profile, remote-sync o suggest-deep iteran sobre varios repos/proyectos pero solo muestran una fase genérica. Mostrar progreso tipo "repo-profile: 3/6 repos" o "profiling: shadow" mientras corren. Aprovechar `setPhase` o `activity` para comunicar el item actual y el total.

### Botones de trigger deben reflejar estado queued/running del job *(2026-04-08)*
Al disparar un job desde el dashboard, si ya hay uno encolado o corriendo, el endpoint devuelve 409 pero el botón no lo refleja. Todos los botones que lanzan jobs deben mostrar estado "running" / disabled mientras `hasQueuedOrRunning(type)` sea true. Aplica a: schedule ribbon, botones de ProjectDetailPage (Suggest cross-repo, Profile), ReposPage, y cualquier otro trigger.

---

## Prioridad media — Job system tuning

### Evaluar intervalos de jobs con datos reales
Con Activity visibility, analizar: ¿consolidate LLM parte se ejecuta? ¿reflect produce cambios diarios significativos? ¿digests se consultan? Ajustar intervalos basándose en datos.

### Consolidate timing: no consumir correcciones antes de que otros jobs las vean
Si consolidate corre antes que repo-profile, consume la corrección y repo-profile no la ve. Evaluar si necesita coordinación.

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

### Mejorar sistema de contactos: MCP update + dedup + dashboard *(2026-04-08)*
Tres problemas detectados:
1. **Falta `shadow_contact_update`** — el DB method `updateContact()` existe pero no hay MCP tool. Al pedir actualizar un contacto, el LLM usa `contact_add` y lo duplica.
2. **`contact_add` no deduplica** — `createContact()` no comprueba nombre/email existente. Añadir check con `findContactByName()` (ya existe, no se usa).
3. **TeamPage muestra muy poco** — ContactRecord tiene 11 campos (slackId, notesMd, preferredChannel, lastMentionedAt...) pero la vista solo muestra 4 (name, role, team, email).

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
