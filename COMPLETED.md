# Shadow — Completed Items

Historical record of completed backlog items.

---

## Session 2026-04-04

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

## Long-term / Arquitectura (completada 2026-04-02)

- **Feedback loop completo** — Tabla feedback, 👍/👎 toggle, razones en dismiss/resolve/discard
- **Job system** — Jobs table, scheduler, heartbeat/suggest/consolidate/reflect como jobs independientes
- **Trust L2 complete** — Plan + Open Session + Execute con MCP delegation
- **Reflect job** — Soul reflection diaria con Opus, feedback + memorias sintetizados
