# Shadow — Completed Items

Historical record of completed backlog items.

---

## Session 2026-04-11 (autonomous execution — L4)

- **Auto-plan job** — Periodic job (3h) that scans mature open suggestions, revalidates against codebase via LLM, auto-dismisses stale ones, creates plan runs for valid candidates. Configurable rules (effort, risk, impact, confidence, min age, kinds, per-repo opt-in).
- **Auto-execute job** — Periodic job (3h, offset 1.5h) that evaluates planned runs with confidence eval. Auto-executes in worktree if confidence=high + 0 doubts, marks needs_review otherwise. Configurable rules (stricter defaults than plan rules).
- **Trust gate removal** — Removed `trustGate()` from all 40 MCP write tools. Trust is now narrative/gamification only. Score + deltas kept for future evolution.
- **Per-job timeout** — `JobHandlerEntry.timeoutMs` optional field. Auto-plan 30min, auto-execute 60min.
- **Confidence eval → Opus** — Changed from hardcoded Sonnet to `config.models.runner` (default Opus).
- **Suggestion effort field** — Migration v47: `effort` column on suggestions, `auto_eval_at` on runs. Effort persisted from LLM suggest pipeline.
- **Settings UI** — New "Autonomy" section with tabs (plan/execute rules), range sliders, searchable repo opt-in.
- **Visibility** — Job colors, output summaries, Ghost TV states, status line states, guide pages, event kinds, job schedule endpoint.
- **L4 trust level (proactive)** — From backlog long-term. Implemented as configurable autonomy rules rather than trust-level gating.

---

## Session 2026-04-11 (orphaned embeddings cleanup)

- **Embedding cleanup on terminal states** — 7 paths now call `deleteEmbedding` when observations/suggestions reach terminal status. Observations: `expireObservationsBySeverity`, `capObservationsPerRepo`, MCP `shadow_observation_resolve`, web route resolve. Suggestions: `acceptSuggestion`, `expireStale`, CLI `suggest accept`. Dismissed suggestion embeddings intentionally preserved — load-bearing for dedup blocking (`checkSuggestionDuplicate` checks dismissed with 0.75 threshold).

---

## Session 2026-04-11 (audit #2 — 14 findings fixed)

Second comprehensive codebase audit. 6 exploration agents across runner, migrations, analysis pipeline, backend adapters, watcher, web server, dashboard (memory leaks, SSE, state management), storage (transactions, model consistency, FTS/vector sync, concurrency, data lifecycle, dedup). ~20 false positives dismissed. 14 verified findings fixed in 4 sessions:

**S1 — Backend quick fixes:**
- **jobs.ts JSON parse** — replaced silent `.catch(()=>({}))` with `parseOptionalBody` + Zod schema on job trigger endpoint.
- **Focus duration bounds** — added max 168h (1 week) validation on `shadow_focus` MCP tool.
- **Request body size limit** — `readBody()` now enforces MAX_BODY_SIZE (10MB), destroys request on exceed.
- **runs.ts silent catches** — added `console.error` to 3 catch blocks (session ID parse, git diff, LLM title gen).

**S2 — Data integrity:**
- **Entity deletes with transactions** — wrapped deleteRepo/System/Project/Contact in `BEGIN IMMEDIATE / COMMIT / ROLLBACK`.
- **Embedding regeneration after merge** — `consolidate.ts` now calls `generateAndStoreEmbedding()` after `mergeMemoryBody()`.
- **Suggest fail-close** — validation failure now discards all candidates instead of passing them through unfiltered.

**S3 — Dashboard resilience:**
- **ErrorBoundary** — new class component wrapping all routes in App.tsx with Ghost-themed fallback UI.
- **useApi error state** — hook returns `{ data, loading, error, refresh }`. Backward compatible (error is new field).
- **Duplicate fetch fix** — `getActiveRevalidations` reduced from 2 identical API calls to 1.
- **SSE reconnect limit** — max 10 attempts before stopping. Resets on tab focus or successful connection.
- **Blob URL revoke** — Sidebar offline image blob URL properly revoked in useEffect cleanup.

**S4 — job-handlers.ts split (1266 → 3 files):**
- `daemon/handlers/suggest.ts` (568 lines) — handleSuggest, handleSuggestDeep, handleSuggestProject, handleRevalidateSuggestion.
- `daemon/handlers/profiling.ts` (222 lines) — handleRemoteSync, handleRepoProfile, handleContextEnrich, handleMcpDiscover, handleProjectProfile.
- `daemon/job-handlers.ts` (471 lines) — types, helpers, handleHeartbeat, handleConsolidate, handleReflect, createDigestHandler, handleVersionCheck, buildHandlerRegistry.
- Zero breaking changes — all external imports unchanged, registry imports from sub-modules.

**Remaining in backlog:** data retention cleanup job (P3, deferred).

---

## Session 2026-04-11 (observation dedup for resolved/expired)

- **Heartbeat dedup for resolved/expired observations** — 3-pass semantic dedup: active → resolved → expired. Observations that reappear after resolution get reopened (with votes++) instead of created as duplicates. Deliberately resolved observations (with feedback) are protected — only silent votes++ without reopen. Cap overflow and expired observations safe to reopen.
- **Fix `update` action no-op** — `checkObservationDuplicate` returning `update` (similarity 0.65-0.80) now actually calls `bumpObservationVotes` instead of just logging and continuing.
- **New store methods** — `bumpObservationVotes(id, context?)` and `reopenObservation(id, context?)` with context merge. `hasResolveFeedback(observationId)` to distinguish deliberate resolves from auto-caps.
- **Migration v45** — Index `feedback(target_kind, target_id, action)` for efficient feedback lookup.
- **Migration v46** — Normalize 6 orphaned observations with `resolved` status (v42 deploy timing gap) to `done`.

## Session 2026-04-11 (entity_links junction table)

- **Junction table for knowledge entities** — Migration v44: unified `entity_links` table replacing `entities_json LIKE` queries with indexed JOINs. Dual-write strategy (JSON + junction). 1378 existing links backfilled. 13 write paths updated, 10+ in-memory JS filters converted to SQL. `removeEntityReferences` refactored to use indexed lookup. Covers memories, observations, suggestions, tasks. `repo_ids_json` / `findProjectsForRepo` left as separate scope.

## Session 2026-04-11 (MCP tool tests)

- **Tests MCP tools — 205 tests, 68 tools** — Full coverage across 8 modules (status, memory, observations, suggestions, entities, profile, data, tasks). Shared test infrastructure `_test-helpers.ts` with real tmpdir SQLite per suite. `mock.module()` for external deps (suggestion engine, digests, search, embeddings). Node.js `--experimental-test-module-mocks` flag.
- **Fix createSuggestion status default** — Column DEFAULT was `'pending'` from v1, never updated after migration v28 renamed pending→open. Now explicitly inserts `status='open'`.
- **Fix test:dev script** — Excludes dashboard `node_modules` from find, adds module mock flag.

---

## Session 2026-04-11 (unified lifecycle + dashboard coherence + bug fixes)

- **Unified entity lifecycle** — Consistent status vocabulary across all 4 workspace entities. Observations: active→open, resolved→done. Suggestions: pending→open, backlog removed (accept "plan" creates task). Tasks: todo→open, in_progress→active, closed→done. Runs: completed→planned, executed/executed_manual/closed→done (with outcome field), discarded→dismissed. 69 files, migrations v42+v43.
- **Entity connections** — Tasks gain `suggestion_id` (from accept "plan"), runs gain `task_id` (from task execute). Flow: Observation → Suggestion → Task or Run. New MCP tools: `shadow_task_archive`, `shadow_task_execute`. Removed: `shadow_suggest_update`, backlog state, updateSuggestionCategory.
- **Run activity tracking** — Runs show live phase in Activity page (preparing/planning/executing/evaluating/verifying). Migration v41 adds `activity` column. EventBus threaded through RunQueue→RunnerService for SSE `run:phase` events.
- **Dashboard coherence** — Sub-tab symmetry: all entities have active + terminal state sub-tabs in workspace. Sidebar reordered to funnel (workspace→observations→suggestions→tasks→runs). Group labels (ACTION/SYSTEM/CONFIG). Workspace "All" shows only active items. Runs standalone page activated. Tasks count badge in sidebar.
- **Stale detector race fix** — Threshold 10min→16min to avoid racing with JobQueue 15min timeout.
- **Parent close kills children** — Close endpoint now kills active Claude CLI processes and cleans worktrees for in-flight children before transitioning.
- **Event queue dedup** — Skip duplicate events with same kind+target within 15min window.
- **Enrichment cache retention** — `expireStaleEnrichment()` now DELETEs stale entries (not just marks). Default 30d TTL for orphaned entries. Expire at job start too.
- **Reflect evolution** — MCP access (`allowedTools: mcp__shadow__*`) so reflect can verify understanding. Condensation prompt (5-8 points/section, remove obsolete). Single-path (LLM uses shadow_soul_update directly). Validation with revert on malformed output. Soul 13K→6.8K chars on first run.
- **Generic prompts** — Removed hardcoded service names (Oliver, Jira, Linear) from LLM-facing schemas and prompts.
- **`shadow job <type>`** — Unified CLI command to trigger any of the 15 daemon job types. `shadow job list` shows available types. `shadow heartbeat` and `shadow reflect` kept as aliases.
- **Backlog items resolved**: "Sugerencias lifecycle" (unified lifecycle covers it), "Concepto de Tarea/Iniciativa" (tasks entity full-stack), "Evaluar: dónde trackear tickets de Jira" (tasks with external refs).

## Session 2026-04-10 (hooks upgrade + 2-phase heartbeat + dashboard pipeline UX)

- **Hooks upgrade** — PostToolUse rewritten with jq pipeline: per-tool detail (Edit lengths, Bash output, Grep patterns, etc.). Matcher expanded to 8 tools (added Glob, Agent, ToolSearch). UserPromptSubmit/Stop: full text capture (removed 500 char cap), added cwd field. New StopFailure hook (API errors → events.jsonl). New SubagentStart hook (subagent spawns → events.jsonl). All hooks filter daemon self-traffic via SHADOW_JOB=1 env var.
- **Consume-and-delete rotation** — Replaced 2h-filter-writeback with atomic rename at heartbeat start. Each heartbeat processes exactly the data since the last one (zero overlap). Orphaned .rotating files from crashed heartbeats are detected and consumed in the next run.
- **2-phase heartbeat** — New summarize phase (Opus, text-free) reads all raw session data and produces structured summary. Extract + observe then use the summary (~1-3KB) instead of raw data. Prevents JSON format loss on large batches (900KB caused LLM to respond in prose). Extract/observe upgraded to Opus. Cleanup stays Sonnet.
- **SHADOW_JOB env filter** — Daemon LLM calls (via claude --print) were contaminating conversations.jsonl (262MB line caused OOM crash). Fix: claude-cli.ts sets SHADOW_JOB=1, hooks exit early when set.
- **Job timeout** — Bumped from 8min to 15min for 4-phase heartbeat.
- **Dashboard pipeline UX** — Phase pipeline shows all job phases. Active phase pulses in job color (not individual phase color). Completed jobs show uniform dim phases. Multi-repo jobs show detail: enrich (Flyte 2/3), repo-profile (shadow 1/3). Fixed phase lists for digest and revalidate-suggestion. All 15 job types verified against handler code.
- **Rename format functions** — summarizeInteractions → formatInteractions, summarizeConversations → formatConversations, summarizeEvents → formatEvents (JSONL→text formatters, not LLM summaries).

## Session 2026-04-09 (workspace redesign + revalidation + notifications)

- **Workspace redesign — Developer Command Center** — Unified feed of runs + suggestions + observations sorted by priority. Quick filter tabs (All/Runs/Suggestions/Observations). Project strip for top 3 active projects. URL-persisted state (filter, project, selected item, offset).
- **Context Panel** — Slide-in right panel (500px). Run Journey (vertical timeline: observation → suggestion → plan → execution attempts → verification → PR). Suggestion Detail (source obs, scores, linked runs, revalidation verdict). Observation Detail (context, 1:N generated suggestions, linked runs).
- **Run lifecycle improvements** — `closed` status for closing journeys without PR. Draft PR on `executed_manual` runs. Worktree cleanup button. `shadow_run_create` MCP tool for creating runs directly from Claude CLI.
- **Suggestion revalidation** — On-demand Opus job reads repo and evaluates if suggestion is still valid/partial/outdated. Updates content and scores in-place. Verdict-based score adjustments (valid: confidence≥70, partial: ×0.6, outdated: confidence=15). Ranking boost (+5/revalidation, -20 if outdated). Pre-filled dismiss for outdated. Revalidating state persists across page refresh.
- **Backend endpoints** — workspace/feed, runs/context, suggestions/context, observations/context, runs/pr-status (gh CLI), runs/close, runs/cleanup-worktree, notifications API (read_at based).
- **Activity phase pipelines** — All 13 job types now show phase pipeline with currentPhase during running state. Both dot and text pulse on active phase. Heartbeat phases granularized: prepare → extract → cleanup → observe → notify (5 real phases matching 3 LLM calls).
- **Notification center** — Ghost bell icon in topbar (peaceful=no alerts, active+glow=alerts). Slide-in panel with grouped notifications. Mark as read (individual groups + all). SSE auto-refresh. Custom ghost images for empty/active states.
- **Event system cleanup** — Simplified from 14 to 7 event kinds. Fixed observation_alert→observation_notable mismatch. Added run_completed, run_failed, job_failed events. Removed dead kinds. Notify added to suggest-deep, suggest-project handlers. Manual job completion events via job-queue.
- **Orphan cleanup preserves params** — `cleanOrphanedJobsOnStartup` merges error into existing result instead of overwriting, so retry can extract original params (suggestionId, repoId).
- **Revalidation parse robustness** — Permissive Zod schema (only verdict+note required). Prompt reinforced for JSON-only final message. Error diagnostics with raw snippet in job result.

## Session 2026-04-08/09 (backlog cleanup + suggest lifecycle)

- **Suggestion kind colors extracted to shared module** — `utils/suggestion-colors.ts` with `SUG_KIND_COLORS`, `SUG_KIND_OPTIONS`, `SUG_KIND_COLOR_DEFAULT`. Same pattern as `observation-colors.ts`. SuggestionsPage imports from shared module.
- **"Analyze cross-repo" → "Suggest cross-repo"** — Button text in ProjectDetailPage corrected to match actual job type (suggest-project).
- **LiveStatusBar/ActivityEntry color consistency** — Already resolved: both use shared `JOB_TYPE_COLORS` from `job-colors.ts`. Removed from backlog.
- **Progreso visible en jobs multi-repo/multi-project** — `onProgress` callback en `remoteSyncRepos`, `profileRepos` y `activityEnrich`. Handlers reportan item actual + conteo via `setPhase` (e.g. "repo-profile: shadow (1/2)").
- **Repo + project filters in Suggestions/Observations** — Exposed repoId/projectId in API routes, client, and dashboard UI. Select dropdowns appear when >1 repo or >=1 project.
- **Clickable suggestion titles in suggest-deep/suggest-project** — Handlers now return `suggestionItems` (with IDs) instead of `suggestionTitles` (strings). ActivityEntry renders clickable links.
- **Descripciones de memorias no parsean `\n`** — `softBreaks()` en `Markdown.tsx` convierte newlines a line breaks markdown (doble espacio) sin tocar code blocks, headings ni lists. Sin deps nuevas.
- **Trust protection** — `ProfileUpdateSchema` changed from `.passthrough()` to `.strip()` — unknown fields (trustLevel, trustScore) silently dropped.
- **Contacts system improved** — New `shadow_contact_update` MCP tool. `contact_add` deduplicates by name. TeamPage shows all fields (slackId, preferredChannel, notesMd, lastMentionedAt) with expandable cards.
- **Trigger buttons reflect running state** — New `GET /api/jobs/running` endpoint + `useRunningJobs` hook (SSE-aware). ScheduleRibbon, ProjectDetailPage, ReposPage buttons show "Running..." and disabled when job queued/running. Replaces local 15s setTimeout. Also fixed repo-profile trigger missing repoId param.
- **Project context in heartbeat** — Active projects now inject full `contextMd` (from project-profile) into extract/observe prompts. Enables cross-repo awareness in memories and observations.

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
