# Shadow — Completed Items

Historical record of completed backlog items.

---

## Session 2026-04-08/09 (backlog cleanup + suggest lifecycle)

- **Suggestion kind colors extracted to shared module** — `utils/suggestion-colors.ts` with `SUG_KIND_COLORS`, `SUG_KIND_OPTIONS`, `SUG_KIND_COLOR_DEFAULT`. Same pattern as `observation-colors.ts`. SuggestionsPage imports from shared module.
- **"Analyze cross-repo" → "Suggest cross-repo"** — Button text in ProjectDetailPage corrected to match actual job type (suggest-project).
- **LiveStatusBar/ActivityEntry color consistency** — Already resolved: both use shared `JOB_TYPE_COLORS` from `job-colors.ts`. Removed from backlog.
- **Repo + project filters in Suggestions/Observations** — Exposed repoId/projectId in API routes, client, and dashboard UI. Select dropdowns appear when >1 repo or >=1 project.
- **Clickable suggestion titles in suggest-deep/suggest-project** — Handlers now return `suggestionItems` (with IDs) instead of `suggestionTitles` (strings). ActivityEntry renders clickable links.
- **Trust protection** — `ProfileUpdateSchema` changed from `.passthrough()` to `.strip()` — unknown fields (trustLevel, trustScore) silently dropped.
- **Contacts system improved** — New `shadow_contact_update` MCP tool. `contact_add` deduplicates by name. TeamPage shows all fields (slackId, preferredChannel, notesMd, lastMentionedAt) with expandable cards.

## Audit 2026-04-06/07 (comprehensive codebase audit)

Full audit report: [`AUDIT-2026-04-06.md`](AUDIT-2026-04-06.md). ~100 findings, all actionable items resolved.

**P0 fixes (data loss prevention):**
- JSONL rotation: atomic rename-then-append pattern (no more lost hook writes)
- Runner worktree cleanup after completion (was leaking disk indefinitely)

**P1 bug fixes (20):**
- Migrations sorted by version before applying
- pendingActivityCount resets each daemon tick
- detectWorkHours uses Intl.DateTimeFormat with user timezone
- MCP pagination: native DB filters for kind/projectId (was post-filter JS with limit:100)
- Trust gate error properly typed
- listObservations LIMIT/OFFSET wrapped in Number()
- Thought loop retries on DB error (was dying silently)
- remote-sync lastFetchedAt only on success
- execSync → execFileSync in repo-watcher (no shell spawning)
- Focus mode: single canonical isFocusModeActive() (was 3 divergent checks)
- drainAll kills remaining jobs after timeout
- Agent SDK passes pack.allowedTools (was hardcoded [])
- schedules.ts: Intl.DateTimeFormat timezone (was fragile toLocaleString anti-pattern)
- N+1 in project detail: native projectId filters for observations/suggestions
- HeartbeatRecord → JobRecord migration completed (dashboard type mismatch fixed)
- repo_add validates path is directory + git repo

**Dead code removed:**
- observeAllRepos, activityObserve, killActiveChild, llmActive variable, legacy layer constants, heartbeat DB methods + mapper, cosineSimilarity re-export, discoverMcpServers unexported

**API hardening:**
- Zod validation on 10 POST endpoints (parseBody/parseOptionalBody helpers)
- clampLimit (max 200) + clampOffset (min 0) on all pagination
- activity/summary uses native startedAfter DB filter (was limit:500 + JS filter)

**Config completeness:**
- 18 config fields + 10 models + 3 efforts mapped to SHADOW_* env vars
- SQLite PRAGMAs: synchronous=NORMAL, temp_store=MEMORY

**God class refactors (4):**
- server.ts 1316 → 203 lines + 8 route modules (`web/routes/*.ts`) + helpers.ts
- activities.ts 1278 → 5 lines barrel + 6 phase modules (`analysis/*.ts`) + shared.ts; directory renamed heartbeat/ → analysis/
- database.ts 2145 → 372 lines façade + 7 domain stores (`storage/stores/*.ts`) + mappers.ts
- cli.ts 1807 → 56 lines dispatcher + 6 command modules (`cli/cmd-*.ts`)

**Documentation:**
- CLAUDE.md fully updated with new project structure, 53 tools, dashboard routes, analysis/ directory, storage/stores/, web/routes/, cli/cmd-*
- AUDIT-2026-04-06.md: full audit report

**FTS5 dedup:** sanitizeFtsQuery extracted to memory/search.ts, reused from database.ts
**removeEntityReferences:** wrapped in transaction (was N+1)
**ORDER BY tiebreakers:** id ASC added to paginated queries

## Session 2026-04-07 (MCP centralization + plugin)

- **Centralize MCP server in daemon** — MCP tools now execute inside the daemon via `POST /api/mcp` (Streamable HTTP transport). Eliminates the ephemeral `npx tsx mcp serve` process: no more dual-writer SQLite, tsx cache bugs, or startup overhead. DaemonSharedState passed to ToolContext for live access (replaces daemon.json disk reads). SSE `mcp:tool_call` events emitted on mutating tool calls for real-time dashboard updates. `mcp serve` kept as stdio fallback.
- **Claude Code plugin validation** — Fixed `hooks.json` format (added `"hooks"` wrapper), added missing UserPromptSubmit + Stop hooks with portable scripts (`scripts/user-prompt.sh`, `scripts/stop.sh`). Inlined mcpServers in `plugin.json` (HTTP transport). Fixed hooks path (`./hooks/hooks.json` relative to plugin root). `claude plugin validate` passes.
- **Getting Started guide** — `GETTING_STARTED.md` with prerequisites, installation steps, MCP registration (HTTP + plugin), verification, first steps, architecture diagram, configuration reference.

## Session 2026-04-06 (job system stabilization + suggest v3)

- **Parallel job execution** — JobQueue class mirroring RunQueue pattern. maxConcurrentJobs=3 LLM + IO unlimited. Per-job adapter tracking via AsyncLocalStorage. 10 handlers extracted from runtime.ts → job-handlers.ts. Runtime main loop simplified from ~400 to ~80 lines.
- **Activity page** — Unified jobs+runs timeline replacing Jobs+Usage+Events pages. LiveStatusBar (SSE real-time), MetricCards, ScheduleRibbon (grouped by function: Analysis/Knowledge/Sync/Digests), per-type expanded views with PhasePipeline visual, deep links Activity↔resources.
- **Workspace** — Renamed from Runs. Same UX, new name reflecting future evolution to developer view.
- **Sidebar restructured** — 15 → 12 items grouped by intention (Action/System/Configure). Removed Dashboard, Jobs, Usage, Events from nav.
- **Digests reader** — Prev/Next navigation, tabs (Daily/Weekly/Brag), regenerate, created/updated timestamps. Backfill for missed days/weeks on wake.
- **Repos page redesign** — Structured profile cards (Overview, Active Areas, Suggestion Guidance). Summary field added to repo-profile prompt + README signal.
- **Corrections system** — `kind: 'correction'` memories consumed by consolidate. loadPendingCorrections injected in extract + repo-profile prompts. enforceCorrections archives/edits contradicting memories via LLM. Promotes correction to `taught` after processing. CorrectionPanel (global sidebar + contextual on repo cards). MCP tool `shadow_correct`.
- **Memory merge in consolidate** — LLM-evaluated combination of similar memories (Opus high). 4 phases: layer-maintenance → corrections → merge → meta-patterns. Trivial dedup for exact title duplicates. No artificial cap (20% safeguard). 246→192 memories consolidated.
- **Suggest v3** — 3 specialized jobs: `suggest` (incremental, reactive post-heartbeat, threshold 1), `suggest-deep` (full codebase review with tool access, Opus high), `suggest-project` (cross-repo analysis for multi-repo projects).
- **Project profile** — New `project-profile` job synthesizing cross-repo context. Reactive after repo-profile for 2+ repo projects. Stored as contextMd on project record (migration v32). Structured display in ProjectDetailPage.
- **Reactive repo-profile** — No longer on 24h timer. Triggered by remote-sync when commits detected (2h min gap). Git log check replaces 7-day filter.
- **Job output enrichment** — Results include titles+IDs (not just counts) for deep linking. observationItems, memoryItems, suggestionItems with clickable links to resources.
- **SSE events** — job:started, job:phase, job:complete emitted from JobQueue. Dashboard already wired.
- **Generic trigger** — POST /api/jobs/trigger/:type for all 13 job types with entity selector (repo/project). Buttons ≤6 entities inline, >6 dropdown.
- **Guide Jobs tab** — Documentation of all 13 job types with chain diagram, phases, models, triggers.
- **Heartbeat scheduling fix** — Seed lastHeartbeatAt from DB on startup. Sync shared state before enqueue. Eliminates rapid re-enqueue after wake/restart.
- **Digest backfill** — Daily/weekly digests generated retroactively for missed days. Weekly backfill loop fix (periodEnd comparison).
- **Queued state** — Jobs show "queued" with orange border instead of type-specific "no output" messages.

## Audit 2026-04-06 (backlog review vs code)

- **Tests ShadowDatabase CRUD + FTS5 + migraciones** — `database.test.ts` (519 líneas): migrations, repos CRUD, memories CRUD+FTS5, observations+dedup, suggestions, jobs lifecycle, projects+entity cascade. SQLite in-memory.
- **Integration tests job orchestration** — `job-queue.test.ts` (303 líneas): claiming, concurrency, priority, same-type exclusion, scheduling, failure handling, drain.
- **Execute plan — verificación de resultado** — `runVerification()` en runner/service.ts ejecuta build/lint/test post-ejecución. Resultado verified/needs_review/unverified. Diff capturado.
- **Idle Escalation** — `consecutiveIdleTicks` en runtime.ts. Heartbeat interval se duplica tras 10 ticks idle. Sleep multiplier hasta 4x (max 120s).
- **Events → Activity feed** (parcial) — ActivityPage reemplaza Events en sidebar. Jobs+runs unificados con filtros, LiveStatusBar, ScheduleRibbon. Falta obs/suggs como items independientes.

## Session 2026-04-04 (mega-refactor C+D+E+F)

- **Project-aware analysis** — active project detection (3 signals, top 3, threshold ≥ 3), project context in extract/observe/suggest prompts, cross_project observation kind
- **MCP Enrichment** — 2-phase plan(Sonnet)+execute(Opus) with user MCPs, enrichment_cache (migration v30), configurable from ProfilePage (toggle + interval)
- **Dashboard overhaul** — ProjectDetailPage, SystemDetailPage, clickable cards with mini-counters, MorningProjects, MorningEnrichment
- **MCP tools expansion** (42→52) — shadow_active_projects, shadow_project_detail, shadow_enrichment_query, shadow_enrichment_config, projectId/kind filters on observations/suggestions
- **Status line** — active project indicator (📋), ghost states for enrich (mint/teal) + sync (pink), 2 new ANSI colors
- **Guide page** — modular guide updated with new phases, observation kinds, MCP tools, config vars, fixed box-drawing rendering
- **Reflect 2-phase** — Sonnet extracts deltas → Opus evolves soul. Removed Active focus + Project status (redundant with project detection). Soul snapshots before each update.
- **Soul history** — GET /api/soul/history + expandable timeline in ProfilePage
- **Enrichment settings** — toggle + interval selector in ProfilePage, stored in profile preferences, daemon reads from profile
- **Suggest cap removed** — was 30, blocked generation. Now unlimited (paginated + ranked)
- **Jobs page legend** — remote-sync + context-enrich in schedule header with countdowns, fixed isActive for non-LLM jobs
- **Suggestion kind colors** — refactor=purple, bug=red, improvement=blue, feature=green (SuggestionsPage + ProjectDetailPage)
- **ProjectDetailPage UX** — ScoreBar replaces text scores, deep links with ?highlight=, clickable items

## Session 2026-04-04 (earlier)

- **Trust L3 — confidence gate** — Plan-first para L3, confidence evaluation (Sonnet high), auto child run si confidence=high + 0 doubts. Safe fallback. Schema v21 (confidence, doubts_json).
- **Draft PR button** — POST /api/runs/:id/draft-pr, push branch + gh pr create --draft. Botón en RunsPage, desactivado si no hay GitHub remote. Schema v22 (pr_url).
- **Execution runs write permissions** — allowedTools Edit/Write/Bash para execution runs. Plan-only runs solo MCP + read.
- **RunsPage redesign** — Status borders, pipeline visual (plan→exec→PR), action hierarchy (primary/secondary), collapsible details, colored filter tabs, parent/child grouping inline, ConfidenceIndicator (3-dot), RunPipeline, ScoreBar components.
- **SuggestionsPage redesign** — Status borders, expandable cards, action hierarchy (Accept primary, Snooze/Dismiss secondary), inline dismiss con dropdown de razones, ScoreBar compacto, colored filters, "All caught up" empty state.
- **ObservationsPage redesign** — Severity borders (rojo/naranja/azul), severity icons, prominent action buttons (Resolve primary), severity filter, fix empty state bug, colored filters.
- **DashboardPage clickable cards** — MetricCard con href + trend support. Todas las cards navegan a su página con filtro.
- **MorningPage layout** — 2-column grid (reduce scroll ~50%), yesterday's daily digest, "View all" links, clickable memories.
- **Job timeout kills child process** — runJobType con timeout integrado + killActiveChild(). Flag cancelled previene sobreescritura. Eliminados Promise.race externos redundantes. Heartbeats max ~8min.
- **Auto-sync remoteUrl** — collectRepoContext detecta git remote y actualiza DB en cada heartbeat.
- **Session for executed runs** — Endpoint session acepta cualquier status (no solo completed).
- **Draft PR branch validation** — Verifica que el branch existe antes de intentar push.

## Session 2026-04-03

- **Fix: jobs colgados tras restart** — `cleanOrphanedJobsOnStartup()` falla ALL running jobs al arrancar (no espera 10min). Kill orphaned claude processes. Child PID tracking con SIGTERM en shutdown.
- **Dashboard polish** — durationMs en stale/orphan, statusline "suggesting", morning running vs skip con fase, colores alineados, setPhase escribe activity al job en DB
- **Feedback optimization** — `getThumbsState()` con índice dedicado, inline en responses (eliminó HTTP request extra)
- **Server-side filters + URL persistence + pagination** — `useFilterParams` hook, `Pagination` component, offset/limit en DB + API, kind filter server-side en suggestions, migrations v12+v13

## Prioridad alta (completada 2026-04-02)

- **Analyze prompt con contexto de observaciones existentes** — Analyze recibe observaciones activas + feedback de dismiss
- **Feedback loop: dismiss/accept enriquecen futuras sugerencias** — Suggest prompt recibe dismissed notes, accepted history, pending titles
- **Observaciones auto-resolve por condición** — LLM en analyze revisa activas contra estado actual + observe-cleanup phase con MCP
- **Run result truncado a 500 chars** — Resultado completo guardado sin truncar

## Prioridad media (completada 2026-04-02)

- **Sugerencias operativas no son útiles** — Suggest prompt instruye: solo técnicas, no operativas
- **Sugerencias aceptadas/dismissed influyen en futuras** — Historial de feedback en suggest prompt
- **Dashboard — markdown rendering** — react-markdown con estilos Tailwind en Runs, Suggestions, Morning, Memories
- **Dashboard — sidebar badges con contadores** — Suggestions, Observations, Runs. Se actualiza cada 15s
- **Morning page mejorada** — Recent jobs, memories learned, runs to review, suggestions, observations
- **Memorias con trazabilidad al heartbeat** — `source_id` column, heartbeat ID en createMemory
- **Markdown en MemoriesPage + body expandible** — Body renderizado, tags, scope, confidence, source, dates
- **Suggestions — filtro por kind** — FilterTabs dinámicas derivadas de los kinds presentes
- **Extraer timeAgo/formatTokens a utils/format.ts** — 4 funciones extraídas de 7 páginas

## Prioridad baja (completada 2026-04-02)

- **KeepAlive genera procesos zombie** — `KeepAlive.Crashed: true`
- **patterns.ts dead code** — Eliminado (104 líneas)
- **logLevel config sin usar** — Eliminado debug block
- **Prompts split en 2 llamadas** — Extract + Observe separados, effort levels
- **Effort level configurable por fase** — `--effort` flag, defaults por fase
- **MCP tool shadow_memory_update** — Cambiar layer, body, tags, kind, scope
- **Status line path frágil** — tsx binstub con fallback npx
- **ASCII art mascota** — Ghost `{•‿•}` con 13 estados × 3 variantes, colores ANSI
- **Emoji Guide actualizada** — Ghost mascot table, status line examples
- **CLAUDE.md actualizado** — 37 tools, 15 routes, Current State completo
- **Memorias mal clasificadas en core** — Prompt afinado, 4 archivadas, 8 movidas a hot

## Long-term / Features (completada 2026-04-02)

- **Validación Zod de resultados LLM por tipo de job** — schemas.ts con ExtractResponseSchema, ObserveResponseSchema, SuggestResponseSchema. safeParse en activities.ts reemplaza `as {}` casts.
- **JSON repair para LLM outputs truncados** — repairJson() cierra estructuras abiertas, safeParseJson() pipeline completo con Zod + recovery parcial.
- **Suggestion Snooze** — pending → snoozed → re-pending. Dropdown 3h/6h/1d/3d/7d. Engine + daemon tick + API + MCP tool + CLI + dashboard (SuggestionsPage + MorningPage).

## Completada 2026-04-03

- **Suggestion quality control** — Dedup por similaridad (3+ palabras), quality filter (impact>=3, confidence>=60), prompt tightening (max 3, no micro-optimizations), pending cap 30, ranked API
- **Ghost mascot live phase tracking** — setPhase() escribe al daemon.json en tiempo real. Status line muestra analyzing/suggesting/consolidating/reflecting/cleaning
- **Ghost mascot nuevos** — Reflect `{-_-}~` (blue), cleanup `{•_•}🧹` (yellow), emojis actualizados para learning/analyzing/ready
- **Pulsing heart** — ♥︎/♡ alterna cada 15s en status line
- **shadow teach rewrite** — System prompt en teaching mode, personalidad SOUL.md, --allowedTools, --topic flag
- **totalInteractions counter** — Incrementa en createInteraction(), bondLevel eliminado de UI
- **Fix daemon hang** — 8min Promise.race timeout en heartbeat/suggest/consolidate/reflect/runner. Stale run detector (10min). lastHeartbeatAt siempre se actualiza.
- **Stale run detector** — Runs stuck en 'running' >10min se marcan failed automáticamente
- **Parent↔child run links** — Badges clickables ↑parent/↓child en RunsPage, auto-status propagation, child→executed (no to review)
- **Eliminado anti-loop.ts** — Código muerto (0 callers), reemplazado por job system. Ejecutado desde plan generado por Shadow.
- **shadow teach** — Sesión interactiva Claude CLI con MCP tools para enseñar
- **Fix cyan color** — --color-cyan añadido al CSS theme, watching/learning visibles en emoji guide
- **Cleanup phase visible** — Añadida al state machine, aparece en detalles del heartbeat
- **L2 validado end-to-end** — Accept → plan → execute → worktree + branch. Limitación conocida: escritura bloqueada en --print mode (para L3).

## Long-term / Arquitectura (completada 2026-04-02 — 2026-04-04)

- **Feedback loop completo** — Tabla feedback, 👍/👎 toggle, razones en dismiss/resolve/discard
- **Job system** — Jobs table, scheduler, heartbeat/suggest/consolidate/reflect como jobs independientes
- **Trust L2 complete** — Plan + Open Session + Execute con MCP delegation
- **Reflect job** — Soul reflection diaria con Opus, feedback + memorias sintetizados
- **Runs paralelos** — RunQueue con maxConcurrentRuns. Concurrent execution via ClaudeCliAdapter instances.
- **Concepto de Proyecto** — First-class entity. Project-aware analysis, active project detection, momentum scoring, MCP tools (shadow_project_detail, shadow_active_projects), dashboard detail page.
- **Semantic search (sqlite-vec)** — Hybrid FTS5 + vector search via RRF (k=60). shadow_search MCP tool. Backfill on startup.
- **UI preparada para escala (+40 repos)** — Paginación offset/limit + filtros server-side con URL persistence en Suggestions, Observations, Memories, Runs, Jobs. (parcial: falta agrupación por repo, búsqueda global)
- **Comunicación externa via MCP servers** — MCP Enrichment: Shadow discovers user MCPs from settings.json and queries them for context. (parcial: reads external data, no direct communication)
