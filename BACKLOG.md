# Shadow — Backlog

Actualizado 2026-04-13. Items completados en [COMPLETED.md](COMPLETED.md).

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

### Stale run detector mata runs activos prematuramente *(2026-04-14)*
El stale detector en `src/daemon/runtime.ts:676-686` tiene un timeout hardcoded de 10min, pero el runner timeout real es 30min (`runnerTimeoutMs`). El detector no consulta si el run tiene un proceso activo en `RunQueue.active` — solo mira `status='running'` + elapsed time en DB. Resultado: runs legítimamente lentos (multi-repo, plan mode con mucho contexto) son matados a los 10min con `errorSummary="Stale: exceeded 10min timeout"`. Ref: run `1e4dea01`. Fix: (1) usar `config.runnerTimeoutMs` en vez del hardcoded 10min, (2) consultar `RunQueue.active` antes de marcar como stale — si el runner lo tiene en su map, está vivo y no es stale.

### Plan vacío no se trata como fallo *(2026-04-14)*
Cuando un plan run completa con exit code 0 pero `capturePlanFromSession` no encuentra plan (Claude no escribió a `~/.claude/plans/`) y `result.output` es vacío, el runner guarda `resultSummaryMd = ""` y marca el run como `planned`. La confidence eval corre sobre una string vacía y genera doubts, pero el run queda en estado `planned` sin plan real. Ref: run `7a426733`. Fix: en `src/runner/service.ts` después de la captura del plan (~L228), si `effectivePlan` es vacío/whitespace, tratar como fallo (`status=failed`, `errorSummary="Plan mode produced no output"`). No correr confidence eval sin plan.

### Ejecución paralela de runs (plan + execute)
Actualmente el runner procesa 1 run a la vez — los demás se quedan en `queued` hasta que termina. Permitir concurrencia configurable (N runs simultáneos) para plan y execute. Evaluar: límite por defecto, impacto en SQLite WAL contention, y si el JobQueue necesita un semaphore o pool.

### Repos sin suggest-deep inicial quedan excluidos del scheduler *(2026-04-14)*
El scheduler periódico de `suggest-deep` en `runtime.ts:645` hace `if (!lastDeep) continue` — solo re-programa repos que ya tuvieron un primer scan. El primer scan se dispara desde `repo-profile` (`profiling.ts:59-69`), pero si ese trigger se pierde (network, darkwake, `break` tras el primero), el repo queda permanentemente excluido del ciclo de sugerencias. Fix: tratar repos sin `lastDeep` como candidatos con `daysSince = Infinity`, no saltarlos.

### Observaciones linkeadas a repo incorrecto no generan sugerencias *(2026-04-14)*
Las observaciones generadas por el heartbeat pueden linkar entity type `repo` a un repo distinto del que realmente tratan (e.g. linkan a un repo de monitoring cuando la observación es sobre el servicio). El suggest normal (`notify.ts` / `activitySuggest`) filtra observaciones por entity type `repo` → esas observaciones no alimentan sugerencias del repo correcto. Dos problemas: (1) el LLM de heartbeat no siempre asocia el `repo_id` correcto en `entities_json`, (2) el pipeline de sugerencias debería considerar también links por `project`, no solo por `repo`, para capturar observaciones cross-repo.

### revalidate-suggestion falla cuando el LLM responde narrativo en vez de JSON *(2026-04-14)*
El prompt de revalidate pide "FINAL message must be ONLY a JSON object" pero cuando el LLM investiga con herramientas (Read, Grep) y concluye que la sugerencia ya está resuelta, a veces responde con análisis narrativo con code blocks en vez de JSON. `extractJson` en `src/backend/json-repair.ts:6-18` usa la heurística "primer `{` hasta último `}`" que captura `{` de code fences (TypeScript objects) confundiéndolos con el JSON de respuesta. El job se marca como `completed` con `error: "Parse failed"` pero no reintenta ni aplica fallback. Fix propuesto: (1) si `extractJson` falla, hacer un segundo intento con regex que busque específicamente el patrón `{"verdict":` para distinguir el JSON de respuesta del código citado, (2) si no hay JSON válido en el output, reintentar la LLM call una vez con prompt reforzado ("respond ONLY with JSON, no markdown"), (3) marcar el job como `failed` en vez de `completed` con error silencioso para que sea visible en Activity como fallo real.

### Pendiente de evaluar
- **Plan demasiado largo**: repos con archivos grandes pueden saturar contexto. Evaluar file size hints en briefing o exclusión de archivos grandes.

---

## Prioridad media — Workspace & Runs

### Detectar PRs creados fuera de Shadow
Si un run tiene worktree pero no prUrl, detectar si existe un PR con `gh pr list --head shadow/{id}`.

---

## Prioridad media — Digests

### Digest/Morning no se actualizan tras re-ejecutar job
Escenario: job de digest falla con timeout ("Process timed out"), se relanza manualmente para el día anterior, el job ejecuta OK pero ni la página de Digests ni el Morning reflejan el resultado nuevo. Posibles causas: (1) el digest se inserta con period_start/period_end que no matchea la query del día anterior, (2) la UI cachea o filtra por fecha de forma que excluye digests regenerados, (3) el morning page usa una query distinta que no recoge el digest actualizado. Investigar query boundaries, upsert vs insert duplicado, y si el frontend refetch es correcto.

---

## Prioridad media — Dashboard UX

### Mostrar sesiones de plan y execute en el Journey
El Journey muestra los steps (plan, execution, PR) pero no expone las sesiones de Claude Code asociadas a cada fase. Sería útil ver en cada step un enlace/referencia a la sesión que generó ese resultado — tanto la sesión de plan como la de ejecución — para poder inspeccionar el transcript o resumirla desde el dashboard.

### Mejorar UX de attempts en el Journey (retry de runs)
La sección "Execution attempts" en `RunJourney.tsx` es demasiado escueta cuando hay múltiples intentos. Problemas: (1) cada attempt es una línea plana sin enlace — no se puede hacer drill-down al child run para ver su detalle, (2) solo se muestra el `errorSummary` del último attempt activo, los errores de attempts anteriores desaparecen, (3) los attempts archivados se muestran tachados sin contexto de por qué fallaron, (4) no hay diferenciación visual clara entre el attempt activo y los anteriores. Mejorar: añadir link clickable por attempt que navegue al child run, mostrar error colapsable por attempt fallido, y mejor jerarquía visual activo vs anteriores.

### Enlace al dashboard en la status line
Añadir un icono/enlace clickable en la status line de Claude Code (`scripts/statusline.sh`) que al pinchar abra el navegador con el dashboard (`localhost:3700`). Evaluar si la status line soporta links clickables o si se necesita otro mecanismo (e.g. atajo de teclado, output con URL que el terminal renderice como link).

### Unificar spinner de runs en RunsPage con el del Workspace
La RunsPage usa `animate-pulse` en un dot de 2x2px (`RunPipeline.tsx:11`) para el estado `running`, mientras que el Workspace usa el `RunSpinner` de `FeedRunCard.tsx:8-12` (border-spinner circular 3.5x3.5 con keyframe `rotation`). Extraer `RunSpinner` a un componente compartido y usarlo también en `RunPipeline` y en el Journey (`RunJourney.tsx:223`) para consistencia visual.

### Nota de cierre al cerrar una tarea
`shadow_task_close` no acepta comentario ni razón de cierre. Permitir un `closedNote` opcional (como ya tienen los runs) para indicar el estado final: movido a backlog, implementado, descartado, etc. Reflejar en el MCP tool, la API, y la UI del Workspace.

### Mostrar related suggestions en la página Tasks
El journey del Workspace muestra las sugerencias relacionadas de una tarea, pero la vista de detalle en la página Tasks no. Añadir la misma sección de related suggestions al detalle de tarea en Tasks.

### Mostrar múltiples PRs en descripción de tareas
Cuando una tarea tiene más de un run con PR asociado, la UI solo muestra 1 PR. Mostrar todas las PRs vinculadas (lista o badges) en la tarjeta/detalle de la tarea en Workspace.

### Radar: labels de ejes se salen del SVG *(2026-04-14)*
En `BondRadar.tsx`, los labels se posicionan a 125% del radio (`pointAt(i, 125)`). Con `size=300` y `radius=96px`, los textos largos como "Momentum 54" o "Alignment 51" exceden el viewBox `0 0 300 300` y se recortan. Fix: ampliar el viewBox con padding (e.g. `-30 -30 360 360`), o reducir el radio, o recalcular la posición de labels dinámicamente según la longitud del texto.

### Depth axis no crece: memorias de jobs no cuentan *(2026-04-14)*
`computeDepthAxis` en `src/profile/bond.ts` solo cuenta memorias con `kind IN ('taught','correction','knowledge_summary','soul_reflection')`. Pero los jobs automatizados (heartbeat, consolidation, enrichment) crean memorias con kinds como `convention`, `preference`, `infrastructure`, `workflow`, etc. que no están en esa lista. Post-reset solo hay memorias de esos kinds → depth = 0 permanentemente. Evaluar: (1) ampliar la lista de kinds elegibles, (2) que consolidation produzca `knowledge_summary`, (3) que `shadow_memory_teach` desde MCP siempre use `taught` independientemente del kind que pida el LLM. Lo más limpio probablemente es (1) — reconocer que todas las memorias no-efímeras representan depth.

### Chronicle "The Path": badges se recortan por arriba *(2026-04-14)*
En `PathVisualizer.tsx`, los circles de tier (`w-11 h-11`) con el badge emoji y el label superior se cortan visualmente por la parte superior del contenedor. El `flex items-center` con `overflow-x-auto` no deja espacio vertical suficiente para el contenido completo de cada nodo. Fix: añadir padding-top al contenedor, o cambiar `items-center` por `items-start` con margen, o dar `min-h` explícito al wrapper de cada tier.

### Eventos de observaciones se re-crean infinitamente *(2026-04-14)*
Bug confirmado. En `src/analysis/notify.ts:42-48`, el dedup de `observation_notable` solo consulta `listPendingEvents()` (delivered=0). Cuando el usuario marca los eventos como leídos (delivered=1), el siguiente heartbeat no los ve y re-crea un evento para cada observación high/critical que siga en `open`. Resultado: una observación puede acumular 91+ eventos (verificado en DB). Fix: el dedup debe consultar **todos** los eventos para esa observación (no solo pending), o usar un flag en la propia observación (`notifiedAt`) para no re-notificar.

### Evaluar: bond por repo en vez de global *(2026-04-08)*
Bond global vs per-repo. Shadow puede saber mucho de un repo y poco de otro. Hablar antes de diseñar.

---

## Prioridad media — Infraestructura de datos

### MCP server ordering en dashboard *(2026-04-08)*
Drag-drop para reordenar MCP servers en Enrichment. El orden como hint para el LLM.

---

## Prioridad baja

### Guard de detección de suspend/sleep para Linux
`isSystemAwake()` en `src/daemon/runtime.ts` usa `pmset -g assertions` (macOS-only). En Linux falla silenciosamente y retorna `true` (fail-open), así que el daemon no distingue full-wake de suspend y schedula jobs durante sleep. Implementar detección equivalente en Linux (p.ej. `systemd-inhibit --list`, `/sys/power/state`, o suscripción a DBus `org.freedesktop.login1` PrepareForSleep). Añadir platform guard que elija la estrategia correcta por OS.


### Logs del daemon en dashboard
Los `console.error` van a `daemon.stderr.log` pero no son accesibles desde el dashboard.

### `tsc` no limpia `dist/` tras renames de módulo
`npm run build` llama a `tsc` directo, que NO borra archivos del dist correspondientes a sources ya eliminados. Descubierto en v49: el rename de `src/heartbeat/` → `src/analysis/` (commit anterior) dejó `dist/heartbeat/` con `profile/trust.js` importando desde un path muerto, y como el MCP server del daemon carga desde `dist/`, el `shadow_memory_teach` tool falló con `Cannot find module 'profile/trust.js'` tras `shadow daemon restart` pese a tener el TS source limpio. Workaround actual: correr `npm run clean && npm run build` tras cualquier rename de módulo. Fix opciones: (a) hacer que `npm run build` llame `clean` antes de `tsc`, (b) migrar a un bundler que hace tree-shake (esbuild/tsup), (c) añadir `tsc --build --clean` prestep. Opción (a) es la más pragmática.

### MCP STDIO server no se reinicia con `shadow daemon restart`
El MCP server STDIO que Claude Code arranca al inicio de cada sesión queda pegado a esa sesión. `shadow daemon restart` solo reinicia el daemon web (puerto 3700) + launchd background jobs, pero el STDIO MCP server no. Si hay un rename mid-session (p.ej. el `trust.ts` → `bond.ts` de hoy), las dynamic imports cacheadas en el STDIO MCP server siguen apuntando al path viejo y las MCP tool calls fallan hasta reiniciar Claude Code. Impacto bajo en sesiones normales, material durante refactors grandes. Fix opciones: (a) detectar cambios en `src/` y auto-reiniciar el MCP server, (b) añadir un `shadow mcp restart` CLI que envíe señal al MCP STDIO process, (c) aceptar la limitación y documentar el workaround (restart Claude Code tras refactors de módulos importados dinámicamente). Opción (c) probablemente suficiente — es un caso raro.

---

## Long-term — Autonomy evolution

### L5 — auto-merge selectivo
Autonomía por repo/scope configurable. Shadow mergea donde tiene permiso. Requiere evaluación post-L4.

### Unlockables content (v49 follow-up)
8 placeholder slots seeded en v49 con `kind='placeholder'` y `title='???'`. Ir llenándolos con contenido real (ghost variants, status phrase pools, theme overrides, badge emojis) vía direct DB update o futura MCP tool `shadow_unlock_define`.

### Drop v49 legacy columns (v50 cleanup)
Después de al menos un mes en v49, dropear `user_profile.trust_level`, `trust_score`, `bond_level`, `suggestions.required_trust_level`, `interactions.trust_delta`. Todos están unused desde v49 pero se mantuvieron por la convención ADD-only de las migraciones anteriores.

---

## Long-term — Arquitectura

### Evaluar: asegurar entity linking en memorias, observaciones, sugerencias y runs *(2026-04-08)*
Auditar si siempre estamos asociando `entities_json` cuando la información lo permite.

### Soporte monorepo: un repo, múltiples proyectos con path prefixes *(2026-04-08)*
Path prefixes por proyecto, detección de fronteras (BUILD.bazel, package.json), heartbeat scoping, entity linking granular.

---

## Long-term — Features (evaluar)

### Circuit breaker para MCP servers en enrichment
El enrichment pipeline (`src/analysis/enrichment.ts`) no tiene tracking de fallos por servidor. Cada run incluye todos los MCP servers habilitados aunque fallen consistentemente — el LLM no sabe que un server falló la vez anterior y gasta budget reintentando. Implementar per-server failure tracking (in-memory o DB), excluir servers con circuito abierto del prompt y `allowedTools`, auto-recover tras cooldown configurable. Extensible a circuit breaker genérico para todas las LLM calls.

### Incluir enrichment_cache en hybrid search (FTS5 + vec0)
`shadow_search` y `/api/search` solo consultan memories, observations y suggestions. Los datos de enrichment tienen embeddings generados (`enrichment_vectors` vec0 table existe) pero nunca se consultan — son write-only desde la perspectiva de búsqueda. Falta: (1) crear `enrichment_fts` virtual table + sync triggers en nueva migración, (2) añadir `'enrichment'` al `SearchSchema` en `src/mcp/tools/data.ts`, (3) añadir branch en handler de `shadow_search` y en `src/web/routes/search.ts`, (4) merge en RRF scoring existente. El vector infrastructure ya está — es wiring, no arquitectura nueva.

### Cap de resultSummaryMd en runs
`src/runner/service.ts:271` persiste `resultSummaryMd` sin truncar. Plans complejos pueden alcanzar decenas de KB y los runs se acumulan sin pruning. El contenido completo ya se escribe en `summary.md` en el artifact directory, haciendo el campo DB parcialmente redundante para outputs largos. Truncar a un max configurable (e.g. 128KB) manteniendo la cola (más útil para diagnóstico), con marker de truncación.

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
