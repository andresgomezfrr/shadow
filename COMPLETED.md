# Shadow — Completed Items

Historical record of completed backlog items.

---

## Session 2026-04-22 (P-11 + P-14 — model UI exposure + few-shot examples)

User revisited dos items que estaban deferred y decidió implementarlos:

- **P-11 summarize model configurable en Settings** (`src/web/dashboard/src/components/pages/settings/`) — Backend ya tenía `getModel(ctx, 'summarize')` desde A-04 (audit), así que el modelo era tunable via env/config pero no via UI. Falta cubierto: extender `MODEL_PHASES` con summarize/extract/observe (los 3 phases del heartbeat) más re-etiquetar `analyze` a "Cleanup obs" para distinguir. CORE_KEYS en `SectionLLMModels` ahora incluye los 3 nuevos — visibles primero (no en collapsible) porque son los que más fire (48 heartbeats/día) y el knob de cost más directo. Default mantenido en Opus.

- **P-14 few-shot examples para extract + observe** (`src/analysis/schemas.ts`, `src/analysis/extract.ts`) — Single positive example per phase, diseñados con cuidado para anclar judgement calls. `EXTRACT_EXAMPLE` muestra: separar insights por kind, layer="core" para architectural decisions, mood inferido de conversational tone, ZERO insights de raw tool counts (la conversación lleva la señal durable, no el activity log). `OBSERVE_EXAMPLE` muestra: síntesis de patrón vs item reporting, severity="warning" para drift signals sin bug confirmado, files list completos para deep-link, NEVER de cosas obvias del input ("12 modified files", "edited 8 times" en aislamiento). Notes section debajo de cada example explica las decisiones — la idea es que sirven como spec implícita, update juntos cuando evolucione el "good".

**Coste few-shot**: ~500-700 tokens extra por call × 96 calls/día (48 heartbeats × 2 phases) = ~50-60k tokens/día. ~$0.20/día Opus, ~$0.04 Sonnet. Bajo, pago anclar quality.

354 backend tests + 4 dashboard tests verdes.

---

## Session 2026-04-22 (Audit block 5Z — observations cleanup + audit hygiene)

Bloque 5Z cierra 5 observations + 3 audit-stale marks + 1 audit hygiene convention. Mix de stales verificados, 2 fixes reales (hook staleness, dashboard test infra), y 1 procedural (audit doc convention). 354 backend tests + 4 dashboard tests verdes.

**Audit-stale marks** (verificados contra HEAD):
- **UI-21 ghost icons sidebar** — `Sidebar.tsx:18-` ya usa `/icons/*.webp` (16 neon glyphs), no emojis. Documented en auto-memory `project_sidebar_neon_icons`.
- **UI-26 Days together bug** — Cerrado ayer (commit `f372119`) con `analysis/chronicle.ts` calendar-day diff.
- **A-03 depth axis no crece** — Widen ya aplicado en `profile/bond.ts:53` (DEPTH_ELIGIBLE_KINDS de 4 a 14 kinds). Comentario referencia el audit. Verificación empírica: depth=78 (no stuck en 0).

**Audit hygiene** (`internal/AUDIT-2026-04-18.md` Section 0):
- **79cce8e1 cross-val false positives** — Convención añadida al header del audit: "Antes de marcar ✅, hacer pass grep/read contra HEAD. Cada closure debe citar `file:line` del código que prueba el fix (o stale)". Ejemplo de buen vs mal closure. Pattern aplicado consistentemente desde bloque 5P (2026-04-21).

**Real work**:

- **d74a6227 hook staleness detection** (`src/cli/hooks.ts` nuevo, ~80 líneas + `cmd-init.ts` + 7 hook scripts) — Pattern análogo a `plist.ts` y `systemd.ts`: stamp `# shadow-hook-version: <semver>` en el primer comentario de cada hook (post-shebang). Source carries placeholder `__SHADOW_VERSION__` que se sustituye con la `package.json.version` en deploy. Comparison por equality (no semver ordering — el target es siempre "matches current shadow version", no "deployed >= current"). `ensureHooksDeployed(dataDir, scriptsDir, targetVersion, opts?)` helper deploys solo lo que necesita upgrade. **Bonus user request**: `shadow init --force` flag para forzar re-deploy de todos los hooks aunque la version matche (útil tras editar manualmente o reset). Init logs lista deployed/upgraded/current.

- **6052e0a9 Toast tests + Vitest infra** (`src/web/dashboard/`, infra nueva + 4 tests) — Honest scope: dashboard estaba con CERO tests y CERO test infrastructure. Decisión user: B = pay the install cost upfront, Toast como first unit. Instalado: vitest + @vitest/ui + happy-dom + @testing-library/react + @testing-library/jest-dom. Config: `vitest.config.ts` (separate de vite.config.ts para evitar polución del prod build) + `src/test-setup.ts` (jest-dom matchers + cleanup hook). Scripts: `npm test` y `npm test:watch` en dashboard, plus `dashboard:test` en root package.json. **Toast.test.tsx** con 4 cases: (1) render via Portal + role=alert; (2) auto-dismiss tras durationMs (vi.useFakeTimers + advanceTimersByTime); (3) manual dismiss via ✕ button; (4) stack independence (2 toasts, dismiss más temprano persiste el otro). Pattern para futuros component tests del dashboard.

---

## Session 2026-04-21 (Audit block 5Y — persona SYSTEM + `shadow` bare wrapper)

Bloque 5Y cierra P-12 con scope extendido: no solo mueve el soul del user prompt al system prompt en los spawns del daemon (runner), sino que además añade un wrapper `shadow` bare para sesiones interactivas del user, usando el mismo mecanismo (`--append-system-prompt`). Todos los paths Shadow-initiated (daemon + user interactive) ahora llevan soul en system context. `claude` bare sigue funcionando inalterado via SessionStart hook.

**Fase 1 — backend plumbing**:
- `backend/types.ts`: nuevo campo `ObjectivePack.appendSystemPrompt?: string`
- `backend/claude-cli.ts`: mapea a `--append-system-prompt <text>` flag (después del `--system-prompt`, stack-eado)
- `backend/agent-sdk.ts`: mapea a `systemPromptSuffix` del Agent SDK (best-effort — CLI backend es el production path, SDK es opt-in)

**Fase 2 — runner**:
- `runner/service.ts`: `personalityPrompt` sale del array `briefing` user-prompt, entra como `pack.appendSystemPrompt`. Briefing queda focalizado en task-specific content (suggestion title, reasoning, repos, instructions, completion marker). Soul deja de duplicarse en cada user prompt.

**Fase 3 — bare `shadow` wrapper**:
- `src/cli.ts`: root `.action()` con `.argument('[claudeArgs...]')` + `.allowUnknownOption()` + `.allowExcessArguments()`. Lee `process.argv`, extrae tokens después de `--`, carga soul de DB, spawnea `claude --append-system-prompt <soul> ...claudeArgs` con `stdio:'inherit'` y env `SHADOW_INTERACTIVE=1`. Exit code forwardeado.
- `scripts/session-start.sh`: guard early-return si `SHADOW_INTERACTIVE=1` o `SHADOW_JOB=1` — evita doble injection del soul cuando el path ya lo lleva en system prompt.
- Help description de Shadow explica que bare `shadow` spawnea Claude + convención `shadow -- <args>` para passthrough.
- Hook deploy inmediato a `~/.shadow/session-start.sh` (se re-deploy-a también via `shadow init`).

**UX final**:
- `shadow` → Claude interactive con soul en system
- `shadow -- --resume <id>` → passthrough a Claude
- `shadow -- -p "quick"` → one-shot Claude con soul
- `shadow -- --help` → help de Claude
- `shadow --help` → help de Shadow (con nota del bare)
- `shadow daemon|status|job|...` → subcommands sin cambio
- `claude` bare → SessionStart hook inyecta soul como siempre (unchanged)

**Verificación**: Tests 354/354 verdes. Smoke manual: `shadow -- -p "..."` ejecuta correcto, Claude responde como Shadow (soul activo). `shadow -- --help` muestra help de Claude. Subcommands intactos.

**Scope reset del claim caching**: verificación vía docs Claude Code confirmó que `--append-system-prompt` funciona en interactive + print modes, stack-ea con CLAUDE.md auto-discovery. Prompt caching Anthropic en el flag no está confirmado automático en CLI (requiere `cache_control` annotations vía API/SDK). Beneficio real: **semántica correcta** + **transcript limpio** + **runner deja de duplicar soul en cada user prompt** (ahorro de ~500-700 tokens/run × 20 runs/día = ~10-15k tokens/día demostrable, sin depender de caching server-side).

---

## Session 2026-04-21 (Audit block 5X — testing gaps)

Bloque 5X cierra 6 items de testing. **3 eran audit-stale** (T-01 runner 73 tests ya existen, T-07 task lifecycle 21 tests, T-12 timeout no aplica). **3 real work**: T-08 (5 tests nuevos), T-09 (2 stress tests añadidos), T-10 (8 tests nuevos). +15 tests → 354/354 verdes.

- **T-01 runner completo** — stale: `runner/state-machine.test.ts` (142L), `runner/queue.test.ts` (246L), `runner/service.integration.test.ts` (376L), `runner/plan-validation.test.ts` (51L). Total 73 tests runner-scope, ~815 líneas. Audit reflejaba estado pre-block 3.

- **T-07 task lifecycle** — stale: `mcp/tools/tasks.test.ts` 21 tests. Cubre create (minimal/full/refs), list (status/project), update (status/title, closedAt set on done, clear on reopen), close, archive, execute (run + active), delete, not-found.

- **T-12 job-queue timeout tolerance** — stale: no existe asserción `elapsed < 2_000`. Los 2000 son `drainAll(2000)` timeout config, no assertions. Sin flaky risk descrito.

- **T-08 consolidate observations boundary tests** (`src/observation/consolidation.test.ts`, nuevo, 5 tests) — Mockea `memory/embeddings.js` con embeddings deterministas derivados del prefijo del título (first 32 chars → vector de 384 dims normalizado). Casos: (1) merge cuando similarity > threshold (títulos casi iguales → 100% sim), (2) NO merge cuando similarity < threshold (topics distintos), (3) keeper con más votes absorbe loser votes + repoIds, (4) no-op con <2 active obs, (5) skip de ya-resolved. Populates vec0 via real `generateAndStoreEmbedding` (mockeado) para cerrar el loop.

- **T-09 job queue stress tests** (`src/daemon/job-queue.test.ts`, 2 tests nuevos) — (1) 20 mixed llm+io jobs drain sin starvation en <10s. Types variados (fast-llm/slow-llm/another-llm/third-llm + fast-io), priority uniforme. Todos completan, 0 queued/running/failed. (2) IO queue independiente: llm capacity saturada con slow-llm + another-llm + 10 fast-io → todos completan. Verifica que io progresa sin bloqueo por llm saturation.

- **T-10 digests tests con mock LLM** (`src/analysis/digests.test.ts`, nuevo, 8 tests) — Mockea `backend/index.js` con selectAdapter sintético (`setMockOutput` + `adapterCalls` counter). Cubre:
  - **Daily**: (a) llama adapter 1x + persist digest + llm_usage row; (b) upsert idempotente en re-run mismo día; (c) llm_usage correctamente grabado con source=digest_daily
  - **Weekly**: llama adapter + persiste correctamente
  - **Brag + P-01 validation**: (a) persiste cuando output contiene `## ${quarter}`; (b) skip + keep existing cuando missing section (P-01 guard); (c) skip cuando output empty
  - **Budget (A-10)**: skip sin llamar adapter cuando `dailyTokenBudget` exhausted (adapterCalls === 0)

**Totales**: 339 → 354 tests (+15). Runner + task + consolidate + job-queue stress + digests ahora cubiertos. Gap real significativo cerrado sin tests mock-heavy ni acoplamiento frágil.

---

## Session 2026-04-21 (Audit block 5V — hardening DB/MCP/Web/Hooks/Cross-platform)

Bloque 5V cierra 9 items mezcla. **6 eran audit-stale** (la wave de sweeping ya convencida): D-02 cleanup job, M-02 ZodError context, R-03 summary/diffStat coherence, R-04 pr-sync batch — todos ya implementados. **3 real work**: W-07 preferences whitelist + H-02 SubagentStart hook + D-10 v49 legacy columns DROP + C-01 Linux systemd + C-02 Linux isSystemAwake. 339 tests verdes, build limpio.

**Audit-stale marks**:
- **D-02 cleanup job** — `handlers/cleanup.ts` ya existe con 90d retention (interactions/event_queue/llm_usage/jobs), rollup `llm_usage → llm_usage_daily` antes de purge, sweep de `.rotating` orphans. Protegidos: feedback (dedup-load-bearing), audit_events (append-only), undelivered events.
- **M-02 ZodError context** — `mcp/server.ts:139` check `err instanceof ZodError` mapea a `-32602` con `err.issues.map(i => '${path}: ${message}')`. Fallback `-32603` solo para no-Zod.
- **R-03 summary/diffStat coherence** — `runner/service.ts:414-436` implementa cruce post-diff: `CHANGE_VERBS` regex + `diffStat.trim() === ''` → `verified: 'needs_review'`, bloquea propagación a parent, emite `plan_needs_review` event.
- **R-04 pr-sync batch** — `pr-sync.ts:21` `BATCH_SIZE = 8` + chunks con `Promise.all`. Audit reflejaba estado serial anterior.

**Real work**:

- **W-07 preferences whitelist** (`src/config/schema.ts`) — Nuevo `PreferencesSchema` con 14 keys whitelisted (enrichment*/thought*/dailyTokenBudget/models/efforts/autonomy/enrichmentServerOrder/_fieldConfidence). `.strip()` → keys desconocidos se descartan silentes. Antes `z.record(z.string(), z.unknown())` aceptaba cualquier cosa.

- **H-02 SubagentStart hook context** (`scripts/subagent-start.sh`) — Hook extendido a capturar `tool_input.subagent_type`, `tool_input.description`, `tool_input.model`, `tool_input.prompt` preview (200 chars). Missing fields → null gracefully. Hook re-deployed a `~/.shadow/` para efecto inmediato.

- **D-10 v49 legacy columns DROP** (migrations v59 + storage layer) — `trust_level`, `trust_score`, `bond_level`, `required_trust_level`, `trust_delta` eran residuo del sistema pre-bond v48. 9 referencias auditadas (todas en storage layer, ningún consumer externo). Removidas de `createSuggestion`/`createInteraction` input types, INSERT statements, mappers, y SuggestionRecord/InteractionRecord types. Migration v59 `v49_legacy_trust_columns_drop` borra las 5 columnas. ADD-only convention finaliza.

- **C-01 Linux systemd init** (`src/cli/systemd.ts` nuevo, cmd-init.ts, cmd-daemon.ts) — Nuevo módulo systemd.ts analog de plist.ts: genera unit user en `~/.config/systemd/user/shadow-daemon.service` con `Restart=on-failure`, `RestartSec=5`, `WantedBy=default.target`. Stamp `shadow-unit-version: 1` para auto-upgrade. `writeAndReloadSystemdUnit` hace `systemctl --user daemon-reload && enable --now` primera vez, `restart` si ya instalado. cmd-init.ts branch por `process.platform === 'linux'` antes de la cadena launchd. cmd-daemon.ts `start/stop/restart` con guard Linux → `systemctl --user ${op} shadow-daemon.service` antes de fallthrough launchctl. Windows/otros: fallback manual spawn.

- **C-02 Linux isSystemAwake** (`src/daemon/runtime.ts`) — `isSystemAwake()` refactor a platform-dispatcher: `darwin` → `isSystemAwakeMacOS()` (pmset UserIsActive existente), `linux` → `isSystemAwakeLinux()` nuevo via `loginctl show-session $XDG_SESSION_ID -p State -p Active` (State='active' o Active='yes' → awake), otros → fail-open true. Timeouts/errores → fail-open para no bloquear jobs en entornos exóticos sin systemd.

---

## Session 2026-04-21 (Audit block 5T — observability full)

Bloque 5T cierra los 5 items de observability en full scope. Logger module + convention + migración de 312 console calls a `log.error|warn|info`. Audit events en todas las mutaciones MCP + bond tier. Métricas diarias via nueva tabla `observability_metrics` + job `metrics-snapshot`. 339 tests verdes.

- **O-01 silent catches** — 2 específicos del audit (job-queue.ts:132, tracking.ts:41) ya tenían log. Audit broader: 3 catches con info loss real fijados (`extract.ts:666/667` applyBondDelta bond deltas silenciosos, `consolidate.ts:496` entity validation, `retrieval.ts:546` embedding en memory-merge). Silent catches legítimos (JSONL per-line tolerance, worktree cleanup "may not exist") quedan intactos con comentario de intent.

- **O-02 audit events full** — `createAuditEvent` añadido en todas las mutaciones MCP: memory teach/forget/update; observation ack/resolve/reopen; task create/update/close/archive/remove; repo add/update/remove; contact add/update/remove; system add/remove; project add/update/remove. También en bond tier rise (`profile/bond.ts:254`) — antes solo event_queue, ahora también audit_events. Todas las mutaciones quedan trazadas.

- **O-03 daily token spend** — stale (cubierto por T-03 done 2026-04-19).

- **O-04 observability_metrics table** — Migration v58 crea tabla con UNIQUE(snapshot_date, metric_key) para idempotencia. Nuevo job `metrics-snapshot` (`handlers/metrics.ts`) captura bond axes (5 dims) + tier + total memories + per-layer counts (5) + observations open + suggestions open. Extensible — añadir métricas es push al array. Registrado en `job-types.ts` + `job-handlers.ts`. Manual trigger: `shadow job metrics-snapshot`.

- **O-05 logging convention full** — Nuevo `src/log.ts`: `log.error/warn/info` varargs-compat con `console.error`. Convention: error = real failure, warn = degradation (fallback), info = lifecycle/progress. Todos a stderr (launchd captura). Migración: Node script con cálculo de relative path + import inyection + bulk swap `console.X → log.X`. 312 calls migradas en 47 archivos. Reclasificación obvia en hot paths (analysis/runner/daemon) a `log.info` para progress msgs ("Captured", "Resolved", "Completed", "N insights", "Evolved") y `log.warn` para degradation markers ("Raw (500) after parse fail", "Skipping hallucinated id"). Convention documentada en CLAUDE.md. New code pain-driven usa logger.

**Verificación**: 339 tests verdes pre y post migración. Typecheck limpio. Logger varargs compat = zero breaking change en stderr output (mismo formato, mismo stream).

---

## Session 2026-04-21 (Block 5S — observations abiertas de check_in)

Bloque 5S cierra 4 observations que recurrían en `shadow_check_in` cada sesión (fuera del audit 2026-04-18, generadas por mí durante el trabajo). Todas high-severity relacionadas con robustez structural. 339 tests verdes (4 nuevos de cascade rollback).

- **S-02 llm_usage tracking gap** (`src/memory/retrieval.ts`) — Audit exhaustivo encontró que `retrieval.ts:250` (correction enforcement) y `:458` (memory merge evaluation) hacían `adapter.execute` sin el `recordLlmUsage` correspondiente. Tokens no contaban hacia el daily budget ni aparecían en Usage dashboard. Añadidos ambos con sources `correction_enforce` y `memory_merge`. Resto del codebase limpio (15 archivos verificados: execute count == recordLlmUsage count per file).

- **S-03 --disallowedTools gap** (`src/backend/claude-cli.ts`) — Solo runner (service.ts:189/771) aplicaba `disallowedTools: ['AskUserQuestion']`. Todos los otros spawns daemon (suggest/autonomy/reflect/profiling/digests/enrichment/consolidate/chronicle/mcp-discover) quedaban sin guard — Claude podía invocar el built-in sin humano respondiendo. Fix: default-deny en el adapter CLI. Si caller no pasa `AskUserQuestion` explícito en `allowedTools`, se añade automáticamente al `--disallowedTools`. Runner sigue funcionando (su deny explícito se dedupe con el default). Agent SDK adapter documenta que los built-ins no son deny-ables por esa ruta (limitación estructural del SDK).

- **S-01 v55 migration gate + helper pattern** (`src/storage/migrations.ts`) — v55 (task_repo_links junction + DROP repo_ids_json) ya era atómico implícitamente: `json_each` aborta en JSON malformado, la transacción hace ROLLBACK, y v55 no queda registrado en `schema_migrations` si algo falla (verified post-facto: DB del user tiene estado consistente — 1 task / 1 link). Pero faltaba un pattern explícito para futuros big-bang drops. Añadido: tipo `Migration.assertInvariant?(db)` opcional que corre antes de COMMIT + helper `assertBackfillComplete({label, sourceSql, linkSql})` que throws si la junction tiene menos filas que el source — triggerea rollback. Migration runner modificado para invocar `assertInvariant` si está presente. v55 documentado con comentario explicando la safety implícita y apuntando al nuevo pattern para futuros.

- **S-04 cascade rollback tests** (`src/storage/database.test.ts`) — `withTransaction` ya usaba `BEGIN IMMEDIATE + ROLLBACK on throw`, pero el rollback nunca se había testeado. Añadidos 4 tests (deleteRepo/Project/System/Contact) que inyectan fallo mid-cascade con `CREATE TEMP TRIGGER ... RAISE(ABORT, ...)` sobre `enrichment_cache`. Los tests verifican que tras el throw, el estado queda como antes: memorias mantienen sus foreign keys, observations/suggestions/runs siguen existiendo. Pure SQL injection, sin module mocks.

**Observations resueltas** — las 4 entradas que me marcaba check_in recurrentemente. Esperado: mood queue y recent observations de la próxima llamada a `shadow_check_in` no incluirán ninguna de estas.

---

## Session 2026-04-21 (Audit block 5Q — analysis residual, todo audit-stale)

Bloque 5Q verificado — los 4 items pendientes ya estaban implementados en blocks previos, solo faltaba actualizar el audit. Cero código nuevo, solo marks. Tipo "sweeper block" para cerrar confusión de items mirage.

- **A-01 notify dedup infinito** — throttle 24h via `observations.last_notified_at` completamente wired: migration + mapper + store method (`setObservationNotifiedAt`) + check+update en `notify.ts:57-82`. Comentario inline referencia el bug histórico (90+ eventos en prod).

- **A-02 JSON repair heuristic** — (1) `extractJson` tiene schema beacon `{"verdict":` con `extractBalancedObject` (json-repair.ts:22-28), (2) revalidate-suggestion hace retry con prompt reforzado al fallar el parse y termina loud como `parse_failed_after_retry` (handlers/suggest.ts:536-572). Zombie completions eliminados.

- **A-04 opus hardcoded heartbeat** — las 3 call sites (extract.ts:209/311/498) usan `getModel(ctx, 'summarize'|'extract'|'observe')`. Config schema con keys configurables y defaults.

- **A-09 consolidate JSON.parse** — duplicado de P-05 con otro label. Ya marcado en 5P. Ambos parses usan safeParseJson.

---

## Session 2026-04-21 (Audit block 5R — UI cleanup)

Bloque 5R cierra 4 items UI del audit. 2 eran audit-stale (UI-01 y UI-06 ya estaban done) — scope real reducido a Toast system + prefetch hook. 335 tests verdes.

- **UI-01 + UI-06 audit-stale marks** — `ActivityEntry.tsx` hace tiempo splitteado a 190 líneas + 3 sub-components (Header/Phases/ExpandedDetail), comentario inline lo documenta. `RunSpinner` component extraído con prop `size='sm'|'md'`, consumido por FeedRunCard/RunPipeline/RunJourney. Cero código nuevo — solo marks.

- **UI-02 Toast system + native dialogs replaced** (`src/web/dashboard/src/components/common/Toast.tsx`, nuevo archivo ~120 líneas) — `ToastProvider` con context + portal a document.body, `useToast()` devuelve API `{success, error, info, warn}` con auto-dismiss diferenciado (success/info 4s, warn 5s, error 6s), hover pausa timer, dismiss manual via botón ✕, stackable bottom-right. Wrappeado en `App.tsx` entre ErrorBoundary y AppShell. Callsites migrados: 2 `alert()` (RunJourney + RunsPage draft-pr errors) → `toast.error()`; `confirm('Delete this task?')` en TasksPage → `useDialog().confirm({variant:'danger'})`.

- **UI-03 usePrefetchHighlight hook** (`src/web/dashboard/src/hooks/usePrefetchHighlight.ts`, nuevo archivo ~50 líneas) — Hook genérico reemplaza la triple duplicación de logic prefetch en Suggestions/Runs/Observations. Signature: `usePrefetchHighlight<T>(entityType, highlightId, rawItems, { persistCapture? })` → `{ items, prefetched }`. `entityType` pasa a `lookupEntity<T>`. `persistCapture: true` captura highlight al primer render y lo preserva tras URL clear (SuggestionsPage lo necesita por su patrón de pulsar + limpiar URL). Las 3 páginas migradas: ObservationsPage pierde useEffect/useMemo imports no usados, RunsPage igual, SuggestionsPage mantiene otros usos.

**Toast infra disponible para próximos usos** — success notifs ("Task created"), info ("Session ready"), warn del presupuesto. No hay callsites nuevos añadidos aún; se usará pain-driven cuando salgan necesidades.

---

## Session 2026-04-21 (Audit block 5P — prompts hardening)

Bloque 5P cierra 5 items de robustez LLM en analysis/runner/digests — structural containment sobre validation frágil o inexistente. 335 tests verdes. P-11 (summarize→Sonnet) overruled por user (deja Opus). P-12 (persona SYSTEM vs USER) diferido a bloque propio (refactor amplio en adapters).

- **P-05 mark done [audit P-05]** — audit stale: `safeParseJson` ya aplicado en `consolidate.ts:113` (meta_patterns) y `:350` (knowledge_summary). Cero código nuevo, solo audit mark.

- **P-02 reflect regex tolerante [audit P-02]** (`src/analysis/reflect.ts`) — `expectedSections.includes()` case-sensitive → array de `sectionChecks` con regex tolerantes (`/##\s+Shadow'?s?\s+voice/i`, `Tensions\s*(?:&|y)\s*gaps`, etc.). Log al revert ahora incluye len-diff signed + preview de los primeros 200 chars del soul rechazado — diagnose de drift sin tener que logar el soul entero.

- **P-04 runner plan marker [audit P-04]** (`src/runner/service.ts`) — Briefing exige cerrar el plan con `<!-- PLAN COMPLETE -->` como commitment explícito. Post-capture verifica los últimos 200 chars del plan; si missing, log warn "may be incomplete" pero procede (no fail loud). Complementa el `isEmptyPlanInDisguise` existente que atrapa empty/trivial — el marker captura el caso "substancial pero cortado mid-plan".

- **P-01 brag doc validación + XML delimit [audit P-01]** (`src/analysis/digests.ts`) — Interpolación triple-backtick (`\`\`\`markdown\n${existing}\n\`\`\``) → XML `<existing-brag-doc>` tags (cierra injection path cuando brag previo contenía triple-backticks). Post-call: empty output o missing `## ${quarter}` section → return `{skipped: true, reason}`, keep existing sin overwrite. Preview logged al skip.

- **P-03 cleanup refactor list-based JSON [audit P-03]** (`src/analysis/extract.ts`, `src/analysis/schemas.ts`) — Cleanup de observaciones ya no delega a MCP tools (`shadow_observations` + `shadow_observation_resolve`) sin validación; ahora pasa la lista de 30 obs inline con id/severity/kind/votes/createdAt, `allowedTools: []`, LLM devuelve JSON `{resolutions: [...]}`, código aplica determinísticamente dentro de `db.withTransaction()` con los 3 ops del MCP tool (`updateObservationStatus` + `deleteEmbedding` + `createFeedback`). Hallucinated ids detectados (validados contra preCleanupObs) + skipped. Schema `ObserveCleanupResponseSchema` añadido a `schemas.ts`. Log tracea applied/total + cada resolve con reason preview.

**No tocados**:
- **P-11 summarize model** — user overruled ("P11 deja opus"). Cost preference respetada.
- **P-12 persona USER → SYSTEM** — diferido a bloque propio. Refactor amplio (touch en adapter.ts + todos los call sites de analysis/runner/digests/suggest). Sin tests de regresión en LLM calls, queda para sesión dedicada.
- **P-13 lenguaje inglés en prompts** — nota: diferido (locale support complejo, no urge).
- **P-14 few-shot examples** — nota: diferido (sin evidence de quality drift).

---

## Session 2026-04-19 (Audit block 5O — 6 UI features en tirón)

Bloque 5O cierra 6 items UI del backlog en sesión única: closing-note UX, multi-PR render con state derivado, repo filter en workspace, attempts drill-down, related suggestions en TasksPage, y la conversión PNG→WebP de `/ghost/`. Typecheck + build verdes.

- **UI-18 closing note [audit UI-18]** (`TasksPage.tsx`, `workspace/TaskDetail.tsx`) — Prompt multiline opcional al transicionar a `done` en ambas páginas. `closedNote` persistido, se limpia al reabrir. Display en TaskDetail por encima del timeline. Reusa `useDialog().prompt` con null=cancel.

- **UI-17 related suggestions en TasksPage [audit UI-17]** (`TasksPage.tsx`) — `TaskCard` expanded lazy-fetchea `fetchTaskContext(id)` y renderiza sección "Related suggestions" con View links a `/suggestions?highlight=<id>`. TaskDetail del workspace ya lo tenía.

- **UI-14 multi-PR con state en TaskDetail [audit UI-14]** (`workspace/TaskDetail.tsx`) — Array `prUrls` renderizado como filas con Badge de state (MERGED/CLOSED/OPEN) derivado de `runs[].outcome` y `runs[].status` matched by prUrl. Sin llamadas extra a gh — usa data ya persistida por pr-sync job.

- **UI-15 workspace repo filter [audit UI-15]** (`workspace.ts`, `WorkspaceContext.tsx`, `WorkspaceHeader.tsx`) — `repo` URL param + `selectedRepoId` en state. Backend: listRuns filtra por `r.repoId`, listTasks/listSuggestions/listObservations ya aceptaban `repoId` (store-level). Counts también repo-aware. Dropdown "All repos" en WorkspaceHeader solo visible con >1 repo.

- **UI-16 attempts UX en RunJourney [audit UI-16]** (`workspace/RunJourney.tsx`) — Cada attempt row expandible: errorSummary o resultSummaryMd inline; View → drill-down al child run propio; badge "active" (bg acento + border-left) vs "archived" (texto muted). Estado `expandedAttempt` local al component.

- **UI-20 /ghost/ PNG → WebP [audit UI-20]** (`public/ghost/`, 21 archivos tsx/ts) — 49 PNGs convertidos con `cwebp -q 85 -resize 800 0`. Carpeta 285MB → 47MB (incluye MP4s intactos). Originales movidos a `internal/ghost-assets/` (gitignored). Chronicle subdir no tocado.

---

## Session 2026-04-20 (Audit block 5N — DB hygiene)

Bloque 5N cierra 5 items DB hygiene: BEGIN unified, updateProfile no-silent, jsonParse observability, FTS tags tokenized, repo path reuse. 5 commits + docs, 335 tests verdes. D-10 (v49 legacy columns DROP) deferred — requiere audit previo de uses, marcado "backlog long" en audit.

- **BEGIN IMMEDIATE unified [audit D-13]** (`src/storage/stores/knowledge.ts`, commit `ca6b26b`) — `updateEntityLinks` usaba `BEGIN` deferred; el resto del store usa `BEGIN IMMEDIATE`. Uniforme.

- **updateProfile warn on unknown keys [audit D-09]** (`src/storage/stores/profile.ts`, commit `a150042`) — Column whitelist cacheado desde `PRAGMA table_info(user_profile)`. Keys cuyo snake-form no existe → log con hint del Json suffix + skip. Elimina el silent-fail class documentado en auto-memory (`feedback_updateprofile_json_suffix`).

- **jsonParse observability [audit D-12]** (`src/storage/mappers.ts`, commit `1661a98`) — `jsonParse` swallow silent de catch eliminado. Loguea error + value preview cuando cae a fallback. Optional `ctx` param ("memories.tags_json") para attribute bad row. Zero breaking change en los 34 callsites existentes.

- **FTS5 tags tokenized via json_each [audit D-11]** (`src/storage/migrations.ts` v57, commit `5a59bf2`) — Triggers antiguos indexaban `tags_json` literal (`["docs","sql"]`) como string → "docs" match por substring accident, tags con punctuation rotos. Migration v57 re-crea triggers con `json_each` para tokenizar. Re-index forzado skipped (limitación external-content FTS5); datos existentes self-corregidos on next UPDATE.

- **createRepo path reuse check [audit D-14]** (`src/storage/stores/entities.ts`, commit `b923f60`) — raw INSERT tiraba SQLITE_CONSTRAINT opaco cuando path existía (repo movido + re-registrado). `findRepoByPath` pre-check + throw descriptivo nombrando repo existente + sugerencia next step (update/remove). Simpler que soft-delete migration.

**Deferred**: D-10 v49 legacy column DROP — requiere audit exhaustivo de uses de trust_level/trust_score/bond_level/required_trust_level/trust_delta antes de DROP. "backlog long" en audit.

---

## Session 2026-04-20 (Audit block 5M — analysis residual)

Bloque 5M cierra 3 items de analysis pipeline: notify con project-awareness, correction bounds check, profile schema refine. 3 commits + docs. Plus marks: A-13 ya cubierto por A-02; P-08 deferred como security theater en single-user (consistente con A-06/R-08/R-09).

- **notify project-aware [audit A-08]** (`src/analysis/notify.ts`, commit `d094d13`) — `observation_notable` payload incluye `projectIds` extraídos de `obs.entities` (type='project'). Consumer puede routear incluso cuando el LLM puso wrong repo_id pero linkeó project correctamente. Prompt-stricter NO aplicado per convención "structural > prompt".

- **correction bounds check [audit P-09]** (`src/memory/retrieval.ts`, commit `f0fd0b4`) — Dos silent-drops corregidos: (a) index out-of-range en `decisions[]` ahora loguea + skip en vez de tragar silencioso; (b) action='edit' sin editedBody ya no fall-through entre branches, loguea + skip para que next consolidate retry.

- **profile schema refine [audit P-10]** (`src/daemon/handlers/profiling.ts`, `src/observation/repo-profile.ts`, commit `6b587a6`) — Parse permisivo dejaba que profiles truncated/off-template entraran a `projects.context_md`/`repos.context_md` como si fueran válidos. project-profile: Zod `.refine()` requiere **Summary** + **Architecture**; raw fallback removido. repo-profile: requiere **Summary** + **Type**; raw fallback ahora necesita ambos markers. Parse fail = log + skip, deja next run reintentar.

**Marcados en audit sin commit**:
- A-13 revalidate narrative — ya cubierto por A-02 (retry + fail-close desde 4B)
- P-08 escape datos — deferred (security theater en local-first, mismo principio que A-06/R-08/R-09)

---

## Session 2026-04-20 (Audit block 5L — UI polish cola)

Bloque 5L cierra 3 items UI residuales: qs() unify, copyable session IDs, MCP server reorder. 3 commits + docs, 335 tests verdes.

- **qs() unify en fetchTasks [audit UI-11]** (`src/web/dashboard/src/api/client.ts`, commit `d74b2eb`) — `fetchTasks` usaba URLSearchParams local mientras el resto del file pasaba por helper `qs()`. Unificado. Zero behavioral change.

- **Copyable+expandable session id pill [audit UI-13]** (`src/web/dashboard/src/components/pages/workspace/RunJourney.tsx`, commit `f06123c`) — Session IDs truncadas sin forma de obtener UUID completo. Nuevo `SessionIdPill` inline: click copia al clipboard con ✓ flash + toggle expand para ver UUID completo. Fallback si clipboard denied = expand para select-all manual. Útil para `claude --resume <id>` y grep de forensic transcripts en `~/.claude/projects/<cwd>/<id>.jsonl`.

- **MCP server reorder arrows [audit UI-22]** (`src/web/dashboard/src/components/pages/settings/SectionEnrichment.tsx`, commit `f21a161`) — Up/down arrow buttons per server card. Simplificado vs drag-drop original (audit proponía full) — arrows aportan el mismo outcome en 30min vs 2h de drag-drop lib. Orden persistido en `preferences.enrichmentServerOrder`. Servers no listados van al final en discovery order. Scope UI-only (daemon sigue su orden).

---

## Session 2026-04-20 (Audit block 5K — CLI + UI quick wins)

Bloque 5K cierra 4 items mixtos: C-03 build clean, UI-12 debounce const, UI-23 statusline dashboard link, C-05 docs drift detector. 4 commits + docs, 335 tests verdes.

- **tsc clean dist [audit C-03]** (`package.json`, commit `99820bb`) — `npm run build` ahora prefija `clean`. Renames/deletes ya no dejan orphan `.js` en dist. Dev loop (tsx) y typecheck (noEmit) no afectados.

- **SEARCH_DEBOUNCE_MS constante [audit UI-12]** (`CommandPalette.tsx`, commit `aef8b62`) — Magic `300` extraído a constante. Tuning en un solo lugar.

- **Dashboard link en statusline [audit UI-23]** (`scripts/statusline.sh`, commit `11238d1`) — Modern terminals (iTerm2, Alacritty, Ghostty, Wezterm) renderizan URLs como clickable. URL del dashboard aparece en fallback de línea 2 cuando no hay thought/notif y daemon está running. Dim color. `SHADOW_DASHBOARD_PORT` env override.

- **shadow docs check [audit C-05]** (`src/cli/cmd-docs.ts` new, `src/cli.ts`, `CLAUDE.md`, commit `75fbac0`) — Nuevo comando detector de drift entre CLAUDE.md y código. Hard checks (exit non-zero): MCP tools count, DB tables count. Soft check: dashboard routes (CLAUDE.md documenta top-level, App.tsx tiene sub-rutas). CLAUDE.md sincronizado como baseline: 67→69 tools, 20→26 tables. `--json` para machine-readable output. Scope narrow (counts only) — audit planteaba checks más ricos pero counts captan la mayoría del drift real.

---

## Session 2026-04-20 (Audit block 5J — web perf + validation)

Bloque 5J cierra 7 items 🟡/🔵 de web routes: 2 N+1 (daily-summary, task detail), 2 resource cleanups (draft-pr temp file, session SIGKILL hang), 3 validation gaps (activity enums, lookup types, digest dates). 7 commits + docs, 335 tests verdes.

- **Digest date validation [audit W-14]** (`src/web/routes/knowledge.ts`, commit `327561b`) — before/after/periodStart pasaban sin validar. Malformed values silenciosamente se comparaban como strings en `WHERE period_start > ?`. Añadido Date.parse() guard; 400 con param name si invalid.

- **Lookup 9 types coverage [audit W-13]** (`src/web/routes/search.ts`, commit `cb9999e`) — `/api/lookup` solo manejaba 5 types (memory/observation/suggestion/run/task). Zod enum `LookupTypeSchema` con 9 types (añade project/system/repo/contact) + switch exhaustivo. Errores listan los allowed values.

- **Activity enum validation [audit W-12]** (`src/web/routes/activity.ts`, commit `da42528`) — status/period/source silenciosamente devolvían listas vacías con valores inválidos. Tres vocabularios cerrados validados (VALID_STATUSES, VALID_PERIODS, VALID_SOURCES); 400 con lista esperada. `type` queda open-ended (muchos job types + `run:*` prefix).

- **Draft-pr temp file cleanup [audit W-08]** (`src/web/routes/runs.ts`, commit `314a6c7`) — `writeTemp` estaba fuera del try. Si la escritura fallaba o algo entre write y `gh` throwaba, el file quedaba en disk. Movido dentro del try; finally con unlink ENOENT-tolerant limpia ambos paths.

- **Session SIGKILL hang guard [audit W-09]** (`src/web/routes/runs.ts`, commit `2cea092`) — Escalation SIGTERM→SIGKILL después de 5s, pero Promise solo resolvía en close/error. Si child ignoraba SIGKILL, Promise colgaba indefinidamente. Añadido `settle()` idempotente + hard fallback a 1s post-SIGKILL con log del pid para cleanup manual.

- **Task detail N+1 [audit W-11]** (`src/storage/stores/{knowledge,execution}.ts`, `src/storage/database.ts`, `src/web/routes/tasks.ts`, commit `e5a5bcd`) — `/api/tasks/:id` hacía flatMap loop llamando `list*({ repoId })` per-repo. `listObservations/Suggestions/Runs` ahora aceptan `repoIds: string[]` que compila a `WHERE repo_id IN (...)`. Task detail handler usa batch form; limit escala con repoIds.length.

- **Daily-summary N+1 [audit W-10]** (`src/web/routes/activity.ts`, commit `35571c2`) — 3 queries per active project (countObs/countSug/topObs). Fetch all open obs+sug once (limit 500), groupBy en JS por project entity id usando Map. 3N queries → 2 total, independiente del número de proyectos activos.

---

## Session 2026-04-20 (Audit block 5I — runner reliability)

Bloque 5I cierra 3 items 🟡 media del runner: race condition en pr-sync, discriminated error codes en ghost jobs, detección temprana de adapter crashes via pidfile. 3 commits + docs, 335 tests verdes.

- **pr-sync defer if child active [audit R-13]** (`src/daemon/handlers/pr-sync.ts`, commit `0682c78`) — Race: pr-sync corriendo cada 30min podía marcar parent `done/merged` mientras un child execution seguía en-flight. Cuando child terminaba y llamaba `aggregateParentStatus`, parent ya era terminal y el update no propagaba — child's verification/diff/prUrl quedaban invisibles en el parent. `fetchPr` ahora chequea children y devuelve skip si alguno está `running`|`queued`; next tick lo recoge cuando el child termina.

- **JobErrorCode discriminated para ghost jobs [audit R-14]** (`src/daemon/{job-handlers,job-queue,runtime}.ts`, `src/daemon/handlers/{suggest,profiling}.ts`, commit `4bbadc9`) — Ghost jobs se reportaban como "LLM jobs failing" sin distinguir causa. Operators tenían que grep daemon.stderr.log. Nuevo `JobErrorCode` union: timeout/interrupted/auth_fail/rate_limit/permission_denied/exit_non_zero/unknown. `classifyError()` detecta por status+exit+output patterns. JobQueue propaga el code en job.result.errorCode, shared.lastGhostCode, y mensaje del alert backend_unhealthy. Severity bumpea a critical si auth_fail (user-actionable), warning para otros.

- **Pidfile-based stale run detector [audit R-15]** (`src/runner/pidfile.ts` new, `src/backend/claude-cli.ts`, `src/daemon/runtime.ts`, commit `e835022`) — Cuando adapter crashed sin cleanup, DB decía 'running' pero no había proceso. Stale detector esperaba `runnerTimeoutMs` completo (30min) antes de marcar failed. Nuevo módulo `runner/pidfile.ts`: adapter escribe `dataDir/run-pids/<runId>.pid` en onSpawn, borra en success/error. `isPidAlive(pid)` usa `process.kill(pid, 0)` (EPERM counts as alive para evitar false-positive en recycled pids). Stale detector con dos paths: (a) pidfile probe con 60s grace window → ESRCH = definitive stale; (b) timeout fallback mantenido para runs sin pidfile. Detección de adapter crashes baja de 30min a ~60s.

---

## Session 2026-04-20 (Audit block 5H — analysis reliability + token budget)

Bloque 5H cierra 4 items de analysis reliability: timeout dedicado, cleanup de .rotating huérfanos, daily token budget con gate configurable, convención Zod documentada. 4 commits + docs, 335 tests verdes. Plus marcados como `deferred (not applicable in local-first)`: A-06 prompt injection entity names, R-08 siblings atomic claim, R-09 confidence goal injection — security theater en single-user single-daemon.

- **Analysis timeout dedicated [audit A-05]** (`src/config/schema.ts`, `src/config/load-config.ts`, `src/analysis/{extract,consolidate,reflect}.ts`, commit `6e0d801`) — Heartbeat/consolidate/reflect heredaban 5min del runner. Heartbeat extract con conversaciones largas puede requerir 7-10min. Añadido `analysisTimeoutMs` config (default 15min, env `SHADOW_ANALYSIS_TIMEOUT_MS`) + passed via `timeoutMs` del ObjectivePack. Runner mantiene su runnerTimeoutMs.

- **Orphaned .rotating cleanup [audit A-07]** (`src/analysis/shared.ts`, `src/daemon/handlers/cleanup.ts`, commit `62451c8`) — `cleanupRotating` tragaba errores silenciosamente. Ahora loguea non-ENOENT (stuck files dejan de ser invisibles). Nuevo `purgeStaleRotatingFiles(dataDir, 24h)` barre el data dir en el daily cleanup job; result includes `rotatingPurged`. Complementa el reclaim-on-heartbeat: handles el caso "user desactiva heartbeat + archivo queda idle".

- **Daily token budget cap [audit A-10]** (`src/analysis/budget.ts` new, `src/config/schema.ts`, 6 handlers + UI, commit `08aab7c`) — Zero protection against runaway cost. Budget vive en `profile.preferences.dailyTokenBudget` (default 1M, 0 disabled). Helper `budgetSkipIfExceeded()` suma `llm_usage` últimas 24h y retorna skip payload cuando exceeded. Deferrable jobs consultan: consolidate (meta-patterns + knowledge_summary), reflect, all 3 digests, chronicle lore+milestone (fire-and-forget from bond), suggest-deep, suggest-project. Critical (heartbeat/runner/MCP) nunca consultan — user intent siempre corre. UI: numeric input en SectionBehavior con step 50k. Sin migration (preferences JSON blob existente).

- **Zod nullable/optional convention [audit A-12]** (`src/analysis/schemas.ts`, commit `b0d19f5`) — Docstring formal en schemas.ts: `.optional()` omit, `.nullable().default(null)` row-level optional con parse-friendly default, `.default(X)` coerce, `.nullable().optional()` distingue omit vs null explícito. Schemas existentes auditados: SuggestResponseSchema ya correcto (reasoningMd/repoId nullable+default), ObserveResponseSchema todo default, revalidate inline schema per-field optional (intencional). No behavioral changes; docstring + audit trail para futuras reviews.

**Deferred (not applicable in local-first single-user)**:
- A-06 prompt injection entity names — entity names del user
- R-08 concurrent siblings atomic claim — single daemon
- R-09 confidence goal injection — goal del user

Reopen automático si Shadow pasa a multi-user o multi-daemon.

---

## Session 2026-04-20 (Audit block 5F — runner robustness + MCP close tools)

Bloque 5F cierra 6 items del runner/MCP: R-07 (cierra observation abierta con vote), M-05+M-06 (completa MCP surface con task/run close + outcome), R-12 (worktree cleanup robusto), R-10 (verification stderr), R-11 (autoEvalAt docstring). 6 commits + docs, 335 tests verdes.

- **pr-sync finaliza standalone runs [audit R-07]** (`src/daemon/handlers/pr-sync.ts`, commit `e287c18`) — pr-sync asumía que todo run en `awaiting_pr` tenía execution children con prUrl. Standalone runs con `prUrl` manual (p.ej. `/draft-pr` en un done, o `shadow_run_close` con prUrl) quedaban stuck en awaiting_pr siempre. `fetchPr` ahora detecta `!parentRunId && prUrl` como self-terminal e inspecciona el run mismo. MERGED→done/merged (como parent), CLOSED→done/closed_manual (outcome-based, diferenciado del parent-path que queda como `dismissed` por back-compat). Cierra observation abierta con vote de sesión previa.

- **closedNote en shadow_task_close [audit M-05]** (`src/storage/migrations.ts` v56, `src/storage/{models,mappers}.ts`, `src/storage/stores/tasks.ts`, `src/mcp/tools/tasks.ts`, commit `6196bdd`) — Tasks tenían `closedAt` pero sin `closedNote`. Migration v56 añade `tasks.closed_note TEXT`. TaskRecord + mapper + updateTask picklist + tool schema propagate. El campo es opcional, omitir calls dejan el behavior idéntico.

- **shadow_run_close tool nuevo [audit M-06]** (`src/mcp/tools/data.ts`, commit `56064b4`) — Runs en `planned` o `failed` que el user ejecutaba fuera de Shadow no tenían forma MCP de transicionar a terminal. Nuevo tool `shadow_run_close({runId, outcome, closedNote?, prUrl?})`. Reglas: done/dismissed → error (already terminal); running/queued → error (stop job first); con prUrl → awaiting_pr (pr-sync finaliza, pairs con R-07); sin prUrl → done con outcome. DB columns ya soportaban.

- **Worktree cleanup retry + risk observation [audit R-12]** (`src/runner/service.ts:cleanupWorktree`, commit `209a494`) — `git worktree remove --force` con 10s timeout fallaba transientemente (FS lock, AV, git concurrente) y dejaba worktree stuck consumiendo disco. Ahora retry una vez con backoff ~1s, si segunda falla crea observation `risk` con path + error en el repo owner (surface via dashboard).

- **Verification stderr capture [audit R-10]** (`src/runner/service.ts:runVerification`, commit `58f55d7`) — `execSync` devolvía solo stdout; warnings/deprecations en stderr se perdían en success. Migrado a `spawnSync` que captura ambos streams independiente del exit status. Output combinado con label `--- stderr ---` para distinguibilidad. Failure path preserve el behavior de mostrar error message como fallback.

- **autoEvalAt semantic docstring [audit R-11]** (`src/storage/models.ts`, `src/daemon/handlers/autonomy.ts`, commit `dfbc005`) — Field era interpretado como "evaluado y aprobado" pero se setea en CADA path (approved/needs_review/error) — es un "seen-by-autonomy" marker outcome-agnostic. Añadido docstring en RunRecord explicando la semántica + nombres locales claros en autonomy.ts. Sin migration; el campo funciona correctamente, solo era ambiguo para lectores.

---

## Session 2026-04-20 (Audit block 5G — UI bugs visibles)

Bloque 5G cierra 5 UI bugs/refactors: 2 🟠 alta (memory/connectivity), 3 🟡 media (UX). UI-10 ya estaba done desde bloque 4C — solo marcado en audit. 5 commits + docs, 335 tests verdes. Bloque pequeño (~3h).

- **mounted guard en useApi visibilitychange [audit UI-05]** (`src/web/dashboard/src/hooks/useApi.ts`, commit `e9bf0b1`) — onVisibility callback llamaba `load()` y `startPolling()` sin chequear el flag `mounted`. Si visibilitychange disparaba después de que el componente desmontara (navegación rápida, parent re-render), `load()` corría setState sobre componente muerto + dejaba timer huérfano. Fix de una línea: bail out si !mounted.

- **reset reconnectAttempt en useEventStream cleanup [audit UI-04]** (`src/web/dashboard/src/hooks/useEventStream.ts`, commit `df584cb`) — `reconnectAttempt` era singleton module-level; solo se reseteaba en source.onopen o cuando llegaba a MAX (10). Si todos los subscribers se desuscribían mid-reconnect (counter en 5/10), el próximo subscriber heredaba el counter elevado y un par de errores nuevos lo subían a MAX → stream se quedaba mute sin entregar eventos. Cleanup en useEventStream y useSSEConnected ahora resetea `reconnectAttempt = 0` cuando refCount llega a 0 — cada nueva subscripción empieza con budget limpio.

- **useSSERefresh fallback default 30s [audit UI-08]** (`src/web/dashboard/src/hooks/useSSERefresh.ts`, commit `e072d26`) — Default de polling fallback era 120s con la suposición de que SSE cargaría la freshness; pero cuando SSE drop silencioso, UI quedaba 2 minutos stale. Bajado a 30s (POLL_NORMAL). Sin lógica condicional SSE-aware (simplification). Hook actualmente sin callsites — fix preventivo del default para futuros consumers.

- **MorningPage refresh on digest job:complete [audit UI-09]** (`src/web/dashboard/src/components/pages/MorningPage.tsx`, commit `6f8feba`) — MorningPage polleaba 60s sin push refresh; tras trigger de digest, el contenido nuevo no aparecía hasta el próximo tick. Suscripción SSE a `job:complete`: si `data.type` empieza con `digest-`, refresh ambos queries (dailySummary + digests). Push update sin perder fallback polling. DigestsPage tiene su propio loop, no necesita cambio.

- **Polling constants centralizadas [audit UI-07]** (`src/web/dashboard/src/constants/polling.ts` new + 15 files modificados, commit `d5739d1`) — 29 literal polling values dispersos en `useApi()` y `setInterval()` callsites reemplazados por 5 tiers nombrados: `POLL_REALTIME=10s` (notifications), `POLL_FAST=15s` (live status/jobs/activity), `POLL_NORMAL=30s` (default lists), `POLL_SLOW=60s` (entity lookups), `POLL_VERY_SLOW=120s` (settings). Behavior-preserving rename pass por valor exacto. Setters/timeouts/duration math no tocados.

**Already done, marked in audit (no commit)**:
- UI-10 FeedTaskCard key estable (bloque 4C, commit `4f67c1f`)

---

## Session 2026-04-19 (Audit block 5E — tests coverage + observability bug)

Bloque 5E cierra 1 bug 🔴 crítico (T-03 mal-categorizado en sección de tests del audit) + 4 gaps de tests/cobertura. T-02 (migration downgrade tests) deferido a BACKLOG con rationale. 5 commits + docs + BACKLOG entry, 335 tests verdes (+18 desde 317).

- **llm_usage tracking en handlers faltantes [audit T-03]** (`src/daemon/handlers/suggest.ts`, `src/daemon/handlers/profiling.ts`, commit `84d74de`) — Bug crítico de observability. Casi todos los LLM call sites ya persistían vía `db.recordLlmUsage` (analysis/extract.ts, consolidate.ts, suggest.ts, reflect.ts, digests.ts, chronicle.ts, enrichment.ts, autonomy.ts, thought.ts, runner/service.ts), pero 5 callsites en daemon/handlers/ no — los más caros: deep scan (`suggest_deep`), cross-project (`suggest_project`), revalidate (`revalidate_suggestion`), revalidate retry (`revalidate_suggestion_retry`), project profile (`project_profile`). Token counts iban al per-job result pero nunca se agregaban a `llm_usage` table → Usage page subcontaba significativamente. Fix: una línea de `recordLlmUsage` por callsite, source label distinto.

- **EVENT_DEDUP_WINDOW clock injection [audit T-06]** (`src/storage/stores/tracking.ts`, `src/storage/stores/tracking.test.ts` new, commit `5466b00`) — `createEvent` dedup window 15min usaba `Date.now()` directo; tests del boundary eran race-prone. Añadido `opts.now` seam — producción omite, tests inyectan deterministicamente. 4 tests boundary: 1ms inside (deduped), exactly at expiration (created), cross-kind no dedup, no targetId no dedup. `EVENT_DEDUP_WINDOW_MS` exportado para que tests no re-encoden el valor.

- **Chronicle tests [audit T-04]** (`src/analysis/chronicle.test.ts` new, commit `c9bbb6a`) — `chronicle.ts` tenía 0 tests. 8 tests cubren paths determinísticos: idempotencia de `triggerChronicleMilestone` (short-circuit cuando milestone existe), UNIQUE(milestone_key) constraint, `getChronicleEntryByMilestone` null cuando no existe, `bond_daily_cache` TTL fresh/expired/upsert, `getVoiceOfShadow` cache hit sin LLM, `getNextStepHint` tier 8 short-circuit. LLM-call paths skipped (requieren MockAdapter, fuera de scope).

- **applyBondDelta tests [audit T-05]** (`src/profile/bond.test.ts` extendido, commit `9044726`) — `applyBondDelta` es data-driven (eventKind informativo, axes recomputed cada call) pero no tenía coverage. 6 tests: empty DB → axes zero/tier 1, axes persisten back to user_profile, depth crece con memorias durables, eventKind informational (mismo state → mismas axes), monotonicidad (tier no baja con state débil), tier rise (backdated reset + seed completo de depth/momentum/alignment → tier ≥ 2 con rose=true y persistido).

- **Bond tests con relative dates [audit T-11]** (`src/profile/bond.test.ts`, commit `23ccdbb`) — Tests existentes usaban fechas hardcoded ('2026-01-01' anchor + offsets). El cómputo es wall-clock-independent (`now` se pasa explícito), así que no era flaky de verdad — pero un lector en 2030 tendría que calcular "¿2026-04-02 son 91 días después de 2026-01-01?" en su cabeza. Helper `daysFromReset(n)` anchored on Date.now() hace los offsets visibles directamente.

- **T-02 movido a BACKLOG** (`BACKLOG.md`, commit en docs final) — Migration downgrade tests requiere primero definir `down` SQL para 30+ migrations + tests UP/DOWN. ~6h sin pain demostrado: Shadow es local-first single-instance, migrations no rollback en práctica. Deferido con context completo en BACKLOG.

---

## Session 2026-04-19 (Audit block 5C+5D — MCP polish + analysis bugs)

Bloque combinado 5C+5D cierra 6 items: 4 de MCP polish (envelope shape, enum keys, defaults, descriptions) + 2 de analysis/LLM bugs (suggest validate dedup, deep-scan budget). Durante el context-load aparecieron 4 items de 5D ya cerrados (A-01, A-02, A-03, P-05) — marcados como "already done" en audit sin commit nuevo. 6 fixes + docs, 317 tests verdes en cada commit.

- **Unified envelope shape `{ok, data?, error?}` [audit M-03]** (`src/mcp/tools/types.ts` + 8 tool files + 8 test files, commit `c05e076`) — 68 MCP tools evolucionaron independientemente a 5 shapes distintos (`{ok, ...data}`, `{isError, message}`, `{task, message}`, `{items, total}`, registro bare). Consumidor LLM no podía escribir un error-handling pattern único. Añadidos helpers `ok(data)` y `err(message)` en `types.ts` + type discriminated union `ToolResult<T>`. Migrados los 68 handlers: cada return pasa por `ok()` o `err()`. Tests (~200 asserts) reescritos: `result.X` → `result.data.X`, `result.isError` → `result.ok === false`, `result.message` → `result.error`. `server.ts` no tocado — hace JSON.stringify sin inspeccionar shape. 317 tests verdes. Commit atómico (cambio de contract no se puede splittear).

- **profile_set enum keys [audit M-04]** (`src/mcp/tools/profile.ts`, commit `1562ee3`) — `ProfileSetSchema.key` aceptaba `z.string()`; validación real ocurría después con `ProfileUpdateSchema.safeParse({[key]: rawValue})` produciendo errores crípticos sobre shape si el LLM mandaba key inexistente. Enum explícito (`displayName`, `timezone`, `locale`, `proactivityLevel`) rechaza en el boundary con error claro.

- **Defaults centralizados via `.default()` [audit M-07]** (`src/mcp/tools/data.ts`, `observations.ts`, `suggestions.ts`, commit `9c08217`) — Patrón `const X = rawX ?? Y` en handlers (16 callsites) dejaba los defaults invisibles al JSON schema exportado — Claude CLI no los veía. Movidos a Zod `.default(Y)`; handlers desestructuran directamente. Defaults derivados/condicionales (`limit = entityName ? 100 : limit`) se quedaron como estaban. Ahora el LLM consumer ve los defaults en la tool definition y sabe que puede omitir el param.

- **Expanded tool descriptions [audit M-08]** (8 tool files, commit `6c17030`) — 54 descriptions ampliadas con pattern what+when para mejorar tool-selection accuracy del LLM consumer. 13 dejadas intactas (ya 120+ chars y claras, p.ej. `shadow_check_in`, `shadow_suggestions`). Trust-level suffixes preservados verbatim. No schemas, handlers, o tool names tocados.

- **Suggest validate dedup por index [audit P-06]** (`src/analysis/schemas.ts`, `src/analysis/suggest.ts`, commit `eecc09f`) — Phase 2 dedup usaba `kept = Set<string>` con `title` como key; dos candidates con mismo título → segundo verdict pisaba al primero y el primer candidate se descartaba aunque el LLM lo hubiera aprobado. `SuggestValidateResponseSchema` añade `index` (0-based); dedup a `Set<number>`. Prompt renderiza `[index=N]` explícito y pide eco. Out-of-range indices logged + skipped. Fail-close path intacto.

- **Deep scan budget + dismissPatterns limit [audit P-07]** (`src/daemon/handlers/suggest.ts`, commit `b6bddd7`) — Ni el deep scan ni el cross-project tenían cap explícito de tool calls; el LLM podía gastar 40-60 Read/Grep/Bash en exploración antes de escribir suggestions. Añadido "BUDGET: use at most 20 tool calls total. Prioritize breadth over depth" a ambos prompts. `dismissPatterns` capado a top 10 (con 30+ históricos el list completo era ruido y sobre-filtraba).

**Already done, marked in audit (no commit)**:
- A-01 notify dedup (throttle 24h con `last_notified_at`)
- A-02 json-repair (beacon + balanced + retry + fail-close)
- A-03 bond depth (DEPTH_ELIGIBLE_KINDS widen)
- P-05 consolidate parse (safeParseJson)

---

## Session 2026-04-19 (Audit block 5B — web perf)

Bloque 5B cierra 4 bugs 🟠 alta de dashboard/web perf. Scope inicial era 6 (D-05, W-02, W-03, W-04, W-05, W-06); en el primer scan de contexto aparecieron dos ya cerrados (W-02 antes de 5B y W-05 antes del audit) — marcados en el audit sin commit nuevo. 3 fixes + 1 docs, 317 tests verdes (+2 nuevos).

- **SSE client drop en backpressure [audit W-06]** (`src/web/event-bus.ts`, commit `239b283`) — `EventBus.emit()` escribía a cada cliente sin chequear el retorno de `client.write()`. Si el TCP send buffer estaba lleno (cliente lento o colgado), Node acumulaba los writes en memoria — riesgo de leak a escala. Ahora si `write()` devuelve `false`, loguea, cierra el socket y lo retira del set. EventSource reconecta en 1-5s, cubierto por el polling 30s para no perder eventos. Zero drain/resume state tracking — más simple que correcto a medias.

- **buildRepoProjectsMap en detectActiveProjects [audit D-05, W-02]** (`src/analysis/project-detection.ts`, commit `6a97f05`) — El heartbeat llamaba `findProjectsForRepo(repo.id)` en loop sobre todos los repos registrados — N queries cada 30min. Con 50+ repos profesionales esto escalaba mal. Sustituido por `db.buildRepoProjectsMap()` que devuelve el índice completo en una query con `json_each`. Callsites single-repo (status.ts, shared.ts/`autoLinkFromRepo`) se quedan con `findProjectsForRepo` — una query puntual es correcta. Workspace feed ya usaba el helper desde antes — cierre de W-02 junto con D-05.

- **listRuns suggestionId filter + limits en contexts [audit W-03, W-04]** (`src/storage/stores/execution.ts`, `src/web/routes/suggestions.ts`, `src/web/routes/observations.ts`, commit `d7bd531`) — `/api/suggestions/:id/context` y `/api/observations/:id/context` hacían `db.listRuns({ archived: undefined })` — fetch de TODA la tabla de runs y filter en memoria. Crecía linealmente con histórico; riesgo OOM + latencia siempre presente. Añadido filter `suggestionId` a `listRuns` store. Suggestions context usa ese filter directamente + `limit: 50`. Observations context mantiene el patrón suggestion-chain (múltiples obs → múltiples sug → runs) pero con `limit: 200` en el scan.

**Marcados como already done (sin commit)**: W-02 (workspace feed ya usaba buildRepoProjectsMap), W-05 (cache momentum TTL 5min en `suggestions.ts:12-30` implementado antes del audit).

---

## Session 2026-04-19 (Audit block 5A — data safety & runner robustness)

Bloque 5A cierra 5 bugs 🟠 alta del audit: 2 del runner (empty plan, parent aggregation) + 3 de DB (LIKE perf, cascade integrity, junction table). 5 commits + docs, 315 tests verdes (de 310 → +5 nuevos), daemon restart clean. Sin tocar schema para D-06 (política mixta SET NULL/CASCADE vía DELETE/UPDATE explícitos).

- **Empty-in-disguise plan guard [audit R-05]** (`src/runner/plan-validation.ts` new + test, `src/runner/service.ts`, commit `22befb8`) — El guard previo `!effectivePlan.trim()` dejaba pasar respuestas tipo "No changes needed. The code is good." como planes válidos; el downstream execute alucinaba cambios sobre nada. Nuevo `isEmptyPlanInDisguise(plan)`: rechaza cuando falla AMBAS — sin estructura (sin bullet `-`/`*`, sin numbered `1.`, sin `file:`, sin `step N:`) Y con <200 chars de contenido real (tras strip de headings y blancos). Heading-only `# Plan\n## Summary\n` también cae (real content = 0 tras strip). Defense-in-depth contra ambos fallos individuales. 7 tests unitarios.

- **Parent aggregation transaccional + withTransaction helper [audit R-06]** (`src/storage/database.ts`, `src/runner/service.ts`, commit `99c0fbe`) — Nuevo `ShadowDatabase.withTransaction(fn)`: BEGIN IMMEDIATE / COMMIT / auto-ROLLBACK en throw. Los 4 deleters existentes (Repo/Project/System/Contact) colapsan de 10 a 5 líneas cada uno. Tres bloques de parent-aggregation en runner (branch done/awaiting_pr/no_changes, empty-plan propagation, failure propagation) ahora atómicos — antes `transitionRun` + `updateRun` eran writes separados y un crash entre medias dejaba parent en estado inconsistente (p.ej. status=awaiting_pr pero finishedAt=null).

- **event_queue dedup con json_extract [audit D-04]** (`src/storage/stores/tracking.ts`, `src/storage/migrations.ts` v54, commit `2eb8ce9`) — Dedup usaba `payload_json LIKE '%<targetId>%'` dentro de ventana 15min — full-scan + falso-positivo cuando un uuid era substring de otro. Reemplazado con `json_extract(payload_json, '$.targetId') = ?`. `createEvent` canonicaliza `targetId` en payload (derivado de runId/suggestionId/observationId). Migration v54 añade expression index en `(kind, json_extract(payload_json, '$.targetId'), created_at)`. Eventos viejos sin `$.targetId` quedan — window 15min los limpia antes de colisión.

- **Code-level CASCADE en deleters [audit D-06]** (`src/storage/database.ts`, `src/storage/database.test.ts` +2, commit `25312df`) — Los 4 deleters hacían solo `DELETE FROM <entity>`; con `PRAGMA foreign_keys=ON` y sin CASCADE en schema, borrar un repo con memorias/observations/etc. tiraba FK constraint. Añadido cascade explícito dentro de `withTransaction`, con política mixta elegida por Andrés: **SET NULL** donde era nullable (memories.repo_id/system_id/contact_id, tasks.project_id — preserva conocimiento); **CASCADE DELETE** donde no era opción o el hijo es ruido (observations/runs — NOT NULL columns; suggestions/enrichment_cache — sin padre no aportan). No se tocó schema (recrear tablas con FTS5+vec0+triggers era caro e innecesario para 1 instalación activa).

- **task_repo_links junction [audit D-03]** (`src/storage/migrations.ts` v55, `src/storage/stores/tasks.ts`, `src/storage/database.test.ts` +3, `CLAUDE.md`, commit `19c62e8`) — `listTasks`/`countTasks` filtraban repos via `LIKE '%<repoId>%'` sobre `tasks.repo_ids_json` — full scan en cada pagination call + falso-positivo con uuid substrings. Migration v55 crea `task_repo_links (task_id, repo_id)` con FK CASCADE en ambos lados + índice en repo_id. Big-bang: backfill desde el json + `DROP COLUMN repo_ids_json`. Reads usan subquery alias `json_group_array(repo_id) AS repo_ids_json` → `mapTask` unchanged. createTask/updateTask escriben al junction dentro de la transaction existente via helper `writeRepoLinks`. D-06 ya no toca el junction al borrar repo — el FK CASCADE lo limpia solo, y el task queda con `repoIds: []` o con los repos restantes.

**Helper reutilizable** añadido al DB: `ShadowDatabase.withTransaction(fn)` — cualquier multi-write futuro puede usarlo en vez de repetir el patrón BEGIN/COMMIT/ROLLBACK.

---

## Session 2026-04-19 (Audit F-14 — knowledge_summary synthesis)

Feature nueva diferida al final del audit: nueva fase en `consolidate` que produce memorias `kind='knowledge_summary'` como síntesis narrativa del estado actual de conocimiento, complementaria (no redundante) a `meta_pattern` y a los digests. 4 commits + actualización audit, 303 tests verdes.

- **Phase 1 — Synthesis step [audit F-14 phase 1]** (`src/analysis/consolidate.ts`, `src/profile/bond.ts`, commit `27058de`) — Nuevo `synthesizeKnowledgeSummary` dentro de `activityConsolidate` tras el meta-patterns. Gate dinámico: cuenta memorias durables (`DEPTH_ELIGIBLE_KINDS` exportado desde `bond.ts`) creadas desde el último `knowledge_summary` (o desde `bondResetAt` si no hay); skip si <10 con reason logueado. Input pack: top 50 memorias durables de los últimos 14 días + top-20 por `access_count` (deduped). Prompt marca boundaries explícitos: "no listes eventos (eso es digest), no repitas meta-patterns, narrativo no dry listing". Zod `KnowledgeSummaryLLMSchema` = `{ summary, themes, highlights, entities? }`. Semantic dedup via `checkMemoryDuplicate` antes de crear: skip >0.85, merge 0.70-0.85, create <0.70. Hallucinated entity UUIDs filtradas contra `repos/projects/systems/contacts`. Sub-object `result.knowledgeSummary` con `{ action, memoryId?, themes?, reason?, llmCalls, tokensUsed }` para transparencia en Activity.

- **Phase 2 — Cluster merge entre summaries [audit F-14 phase 2]** (`src/analysis/consolidate.ts`, commit `96a6c6e`) — Nuevo helper `clusterMergeKnowledgeSummaries` post-synthesis. Walks summaries oldest-first; para cada anchor, vector-search top-10 y colapsa vecinos con similarity >0.80 en el anchor más antiguo via `mergeMemoryBody` + archivar el nuevo + `deleteEmbedding` + feedback row `consolidated`. Preserva historicidad (los viejos absorben a los nuevos). Gated a hora local 3 (~1/día en cadencia 6h) para amortizar coste del vector search extra. Solo corre si hay ≥3 summaries. Resultado en `knowledgeSummary.clustered = { checked, merged }`.

- **Phase 3 — Activity transparency [audit F-14 phase 3]** (`src/web/dashboard/src/components/activity/ActivityEntryExpandedDetail.tsx`, commit `403fc92`) — Extiende el caso `consolidate` con una sub-row separada por `border-t` mostrando la acción del knowledge_summary: `created` (con themes + link al memory via `highlight=`), `merged` (con link), `skipped` (con razón). Si hubo cluster merge, append `· clustered N/M`. Zero cambio en render de counts básicos (promoted/demoted/expired).

- **Phase 4 — Kind filter en MemoriesPage [audit F-14 phase 4]** (`src/web/routes/knowledge.ts`, `src/web/dashboard/src/api/client.ts`, `src/web/dashboard/src/components/pages/MemoriesPage.tsx`, commit `ccff45a`) — Exposición básica para inspección: `/api/memories` acepta `?kind=` threaded a `listMemories` + `countMemories` (search path filtra post-hoc). `fetchMemories` signature añade `kind?: string`. Dropdown en MemoriesPage junto a los tabs de layer con las 14 opciones durables (`taught`, `correction`, `knowledge_summary`, `soul_reflection`, `convention`, `preference`, `infrastructure`, `workflow`, `tech_stack`, `design_decision`, `architecture`, `pattern`, `insight`, `meta_pattern`) + "All kinds". URL persisted via `useFilterParams`. Zero card dedicada en Morning — diferido a F-14b si el contenido demuestra valor user-facing en 2-3 semanas.

**Riesgos aceptados**: prompt puede devolver summaries genéricos en los primeros ticks (mitigación: 50+ memorias concretas como input, tuning iterativo); dedup con threshold 0.85 puede dejar pasar variantes (mitigación: cluster-merge absorbe post-hoc en hora 3); cluster-merge agresivo puede colapsar demasiado (mitigación: threshold 0.80 alto, solo el más reciente se absorbe, anchor viejo preserva historia).

---

## Session 2026-04-19 (Audit block 4C — dashboard polish)

Block 4C closes 5 dashboard polish items before open-source: stable keys, calendar-day counting, unified spinner, custom dialogs, and the 941-line ActivityEntry split. 5 commits, 303 tests green, build + daemon restart clean.

- **Stable key for FeedTaskCard externalRefs [audit UI-10]** (commit `4f67c1f`) — One-line fix: `key={i}` → `key={source-key}`. Prevents React identity desync if refs reorder.

- **Calendar-day "days together" count [audit UI-26]** (`src/web/routes/chronicle.ts`, commit `9843f16`) — `Math.floor(elapsedDays)` counted 24h periods, off-by-one at any intraday moment. Strip time to midnight + diff + `+1` so reset day = día 1. Verified: bondResetAt 2026-04-13 10:02, check 2026-04-19 → `daysElapsed=7` (was `6`).

- **Unified RunSpinner [audit UI-06]** (`src/web/dashboard/src/components/common/RunSpinner.tsx` new, + 3 callers, commit `24bbd02`) — Three separate in-progress indicators (circular rotation in FeedRunCard, 2×2 animate-pulse dot in RunPipeline, 3×3 animate-pulse dot in RunJourney) unified to the rotating style. Single `<RunSpinner size="sm"|"md">` in `common/`. Andrés confirmed visual choice before extraction.

- **Custom dialogs replacing native prompt [audit UI-02]** (`src/web/dashboard/src/components/common/Dialog.tsx` new, `src/web/dashboard/src/hooks/useDialog.ts` new, 7 consumers patched, commit `6d8092e`) — 9 `window.prompt('Reason for X (optional):')` callsites across ObservationsPage, ObservationDetail, WorkspaceFeed (3x), MorningPage, RunsPage, RunJourney (2x) broke the dark theme and were unstylable. Replaced with `<ConfirmDialog>` + `<InputDialog>` rendered via React Portal (same pattern as `ChronicleLightbox` to escape ancestor transforms). New `useDialog()` hook returns `{ dialog, confirm, prompt }` async — caller renders `{dialog}` at root and awaits `prompt({...})`. ESC and click-outside close. All 9 sites converted to the hook; themed cancel/confirm buttons.

- **ActivityEntry split 941→190 lines [audit UI-01]** (4 files in `src/web/dashboard/src/components/activity/`, commit `0bd0eb8`) — The god component mixed collapsed-row rendering, queued/running/skip dedicated layouts, PhasePipeline timeline, and per-type expanded details in one 941-line file. Split:
    - `ActivityEntry.tsx` (190 lines, under <300 target) — orchestrator. Status-dispatches to dedicated layouts for queued/running/skip, composes Header + ExpandedDetail for the common path. Keeps RetryButton (tightly coupled to failed-UI).
    - `ActivityEntryHeader.tsx` (66 lines) — collapsed row. Reuses existing `JobOutputSummary`; no Results.tsx created (per plan D1).
    - `ActivityEntryPhases.tsx` (197 lines) — PhasePipeline + color maps + exports `JOB_PHASES`, `RUN_PLAN_PHASES`, `RUN_EXEC_PHASES` consumed by both Main and ExpandedDetail.
    - `ActivityEntryExpandedDetail.tsx` (549 lines) — per-type dispatch (one branch per job type, fallback key-value dump). Isolated from chrome.

  Zero behavioural change. Visual smoke pending user verification on `/activity`.

---

## Session 2026-04-19 (Audit block 4B — analysis/LLM critical fixes)

Block 4B closes 5 items in the analysis/LLM pipeline that were silent pain points: bond depth stuck, revalidate-suggestion silent failures, hardcoded opus in heartbeat, consolidate crash-prone, silent catches blocking debugging. 5 commits, 303 tests green, typecheck + build clean.

- **Widen depth axis to count durable memory kinds [audit A-03]** (`src/profile/bond.ts`, commit `1c836f8`) — `computeDepthAxis` counted only 4 kinds (`taught`, `correction`, `knowledge_summary`, `soul_reflection`). Heartbeat/consolidate/suggest produce memories tagged `convention`, `preference`, `infrastructure`, `workflow`, `tech_stack`, `design_decision`, `pattern`, `insight`, `meta_pattern`, `architecture` — none of which counted. Andrés's bond was literally stuck at tier 2 momentum=80 depth=2 because nothing the daemon produced moved depth. Expanded whitelist to 14 kinds (`DEPTH_ELIGIBLE_KINDS`). Ephemeral kinds (`thought`, `activity`) excluded explicitly. Saturating curve `1 - e^(-n/60)` unchanged.

- **Consolidate parses LLM output with Zod [audit A-09]** (`src/analysis/consolidate.ts`, commit `dc8990c`) — `JSON.parse(result.output)` in meta-pattern synthesis had no schema, no repair. Malformed JSON or markdown fences → silent crash (caught in outer try), tick produced zero meta-patterns with no clear signal. Replaced with `safeParseJson(result.output, ConsolidateSchema, 'consolidate')`. Fail-close: if parse fails, clear log + skip meta-pattern step this tick. Layer maintenance still runs. Consistent with suggest validate fail-close.

- **Silent catches now log context [audit O-01]** (`src/storage/stores/tracking.ts`, `src/daemon/job-queue.ts`, `src/daemon/thought.ts`, commit `2d62fa9`) — Three `try/catch { /* comment */ }` in paths with no fallback semantics were debugging black holes: (1) `tracking.ts:41` total_interactions counter, (2) `job-queue.ts:130` per-job `setPhase` DB update, (3) `thought.ts:209` `listObservations` during thought generation. All three now log `[component] context: <error>`. The intentional silent catches elsewhere (retry logic in `thought.ts:72`, "user is idle" fallback `:200`, "decorative feature" outer catch `:126`) kept as-is — those have deliberate semantics, not bug-hiding.

- **Heartbeat models route through config.models [audit A-04]** (`src/config/schema.ts`, `src/config/load-config.ts`, `src/analysis/shared.ts`, `src/analysis/extract.ts`, commit `c5684db`) — `extract.ts` hardcoded `model: 'opus'` in three `adapter.execute` calls (summarize phase line 209, extract phase line 311, observe phase line 498) and in the `recordLlmUsage` tags. Users couldn't override via `SHADOW_MODEL_*` env vars or profile preferences; other jobs respected `config.models`. Drift. Extended `ModelsSchema` with `summarize`, `extract`, `observe` keys (default `opus` — zero behavioural change for existing installs). Added `SHADOW_MODEL_SUMMARIZE/EXTRACT/OBSERVE` env vars. Extended `getModel()` phase type to match. The three hardcoded strings in `extract.ts` now flow through `getModel(ctx, 'summarize'|'extract'|'observe')`; the resolved model is captured in a local and reused for `recordLlmUsage`, so the Usage table reflects reality.

- **Revalidate-suggestion robust parse with retry [audit A-02]** (`src/backend/json-repair.ts`, `src/daemon/handlers/suggest.ts`, commit `1679aec`) — `handleRevalidateSuggestion` was silently marking jobs `completed` with `error: "Parse failed: ..."` when the LLM responded narratively instead of pure JSON — a common mode when it explored the repo with Read/Grep tools, concluded aloud, and forgot the "FINAL message must be ONLY JSON" instruction. `extractJson`'s first-{-to-last-} heuristic captured TypeScript object literals inside code blocks, producing invalid JSON. Two fixes: (1) schema-specific beacon in `extractJson` — looks for `{"verdict":` (revalidate response shape) and extracts the balanced object via a new `extractBalancedObject()` that respects strings/escapes. (2) Handler retries once with a reinforced prompt ("IMPORTANT: Your FINAL message must be ONLY the JSON object..."). If retry also fails, job returns `lastError='parse_failed_after_retry'` so the dashboard Activity shows it as a real failure instead of a zombie `completed`. Cost cap: 2 LLM calls max per job (retry once, not looped); `tokensUsed` and `llmCalls` track both attempts.

---

## Session 2026-04-19 (Audit block 4A — runner 95% + bloque 3 drift cleanup)

Block 4A closes the 3 drifts surfaced during block 3 validation (W-15, R-16, R-17) and completes the T-01 follow-up tests (T-01b/c/d), pushing runner coverage from ~85% to ~95%. 6 commits, 303 tests pass, typecheck + build clean.

- **Shared JOB_TYPES registry [audit W-15]** (`src/daemon/job-types.ts` new, `src/cli/cmd-daemon.ts`, `src/web/routes/jobs.ts`, commit `8866b8d`) — The allowlist of trigger-able jobs lived in two duplicated places: cmd-daemon's local `JOB_TYPES` const and the web route's hardcoded `VALID_TYPES` Set (plus a parallel `PRIORITIES` Record). Adding a new job required updating both — the drift that surfaced at block 3 validation when pr-sync/cleanup/version-check weren't trigger-able from the dashboard. Extracted the canonical `Record<string, { priority; description }>` to `src/daemon/job-types.ts` with a derived `JOB_TYPE_NAMES` array. Both consumers now import from there; the web route's duplicated `PRIORITIES` is gone. Also filled two longstanding gaps in cmd-daemon.ts's list: `auto-plan`, `auto-execute`, `version-check` (present in the runtime registry but missing from the CLI's JOB_TYPES — `shadow job list` now shows them).

- **T-01b confidence eval low path** (`src/runner/service.integration.test.ts`, commit `8f6bdaf`) — Test 10. Adapter scripted with `confidence='low'` + `doubts` array; asserts both persist on the run record after the plan finishes. Covers the `evaluateConfidence` LLM path that was not reached by tests 1-9 (which all had default high confidence).

- **T-01c plan capture from session JSONL** (`src/runner/service.integration.test.ts`, commit `8f6bdaf`) — Test 11. The plan-capture mock is now configurable (`setPlanCaptureImpl`). Test overrides it to return a scripted capture, adapter replies with empty output, asserts that `effectivePlan` is sourced from the capture rather than `result.output`. Cleans up the override in `finally`. Closes the loop on the capture path that processRun gates behind `planOnly && isSuccess && result.sessionId`.

- **T-01d autonomous chain plan → execute → parent done** (`src/runner/service.integration.test.ts`, commit `8f6bdaf`) — Test 12. Two processRun calls in sequence simulating auto-plan then auto-execute. Adapter scripts plan + confidence=high + execution responses; `onExecute` dirties the worktree during the execution phase. Asserts the full lifecycle: parent planned → done via aggregation, `outcome='executed'`, diffStat captured. Exercises the multi-run coordination that individual tests couldn't.

- **Daemon shutdown ordering: web before DB [audit R-17]** (`src/web/server.ts`, `src/daemon/runtime.ts`, commit `bc73641`) — Post-restart, `daemon.stderr.log` accumulated `"Error: database is not open"` from `handleProfileRoutes` → `ensureProfile`. Root cause: `startWebServer`'s returned `close()` did `try { server.close(); db.close(); }` — double-close of the DB with no ordering. The shutdown handler in runtime.ts then also called `db.close()` and neither awaited `server.close()` which is async (requests in flight). Fix: returned `close()` now returns `Promise<void>` and no longer touches the DB (the caller owns DB lifecycle). Shutdown sequence awaits `webServer.close()` with a 5s hard cap via `Promise.race` before calling `db.close()`. Server stops responding → DB closes cleanly, no late requests.

- **Manual trigger bypass of canSchedule [audit R-16]** (`src/storage/stores/execution.ts`, `src/storage/database.ts`, `src/daemon/job-queue.ts`, commit `3781cb1`) — When `pmset` reports `UserIsActive=0` (no input for a few minutes), `isSystemAwake()` returns false, `canSchedule=false`, and `JobQueue.tick({ allowClaim: false })` stops claiming. Correct for scheduled LLM jobs (avoid spawning mid-darkwake), but broken when the user explicitly clicks Trigger or runs `shadow job X` — their intent should override the gate. Fix: `claimNextJob` gains an optional `triggerSource` filter; `JobQueue.tick` refactored so when `allowClaim=false`, it runs a claim loop scoped to `triggerSource='manual'`. Shared logic extracted to `private claimLoop(excludeTypes, triggerSource|null)`. Manual claims log `[job-queue] Claimed manual job 'X' (bypassing canSchedule=false)` for visibility. Scheduled jobs still respect the gate unchanged. Decision D1=A1: no category restriction — even LLM jobs bypass when triggered manually, accepting the user's explicit intent.

---

## Session 2026-04-19 (Audit block 3 — runner test coverage + pre-OSS cleanup)

Block 3 closes the last open Top-10 item from the 2026-04-18 audit (T-01 runner has zero test coverage) with an integration-heavy suite plus full unit coverage of state-machine.ts and queue.ts. Two observability mini-fixes (UI-29, UI-30) surface `pr-sync` and `version-check` in the dashboard's Schedule Ribbon and API. Three pre-open-source housekeeping items: BACKLOG cleanup, `install.sh` HTTPS default, README MCP tools count. Typecheck + 300 tests green at every step.

- **Runner test helpers [audit T-01 phase 0]** (`src/runner/_test-helpers.ts` new, commit `8188126`) — Shared factories reused across three test files. `makeMockAdapter(opts)` with `scripted` per-phase responses, `throwOnExecute`, `onExecute` side-effect hook, and call tracking. `initTmpGitRepo()` creates a real git repo in tmpdir with an initial commit so git operations inside `processRun` (worktree add, rev-parse, diff, commit, worktree remove) behave fully. `createTestRunnerContext()` bootstraps DB + config + RepoRecord + EventBus + cleanup in one call. Seed helpers drive runs through legal state-machine transitions. The pattern mirrors `src/mcp/tools/_test-helpers.ts` for consistency. Key gotcha discovered mid-way: `createRun` already inserts with `status='queued'` by default, so `transitionRun(id, 'queued')` in seeds throws `queued→queued`; seeds now rely on the default.
- **state-machine tests [audit T-01 phase 1]** (`src/runner/state-machine.test.ts` new, commit `e240330`) — 38 unit tests against 92 lines of pure logic. Full coverage of the transition graph (every edge asserted) plus selected invalid pairs (done→running, dismissed→done, failed→done, running→awaiting_pr, queued→done/planned, unknown-from). `aggregateParentStatus` covered for all observable cases: empty array, all-dismissed, failed-wins (including mixed failed+dismissed), all-terminal-non-dismissed, non-terminal gates (running/queued/planned/awaiting_pr keep parent null), single-child edges. `RunTransitionError` fields (from/to) verified.
- **queue tests [audit T-01 phase 2]** (`src/runner/queue.test.ts` new, commit `00ecc11`) — 16 tests against the post-R-01 contract. `mock.module` replaces `./service.js` with a stub whose `processRun` stores resolvers in a map so tests can let in-flight runs "hang" and assert on active-state, then resolve them during cleanup. `../backend/claude-cli.js` is mocked to capture `killAllActiveChildren` calls without spawning or killing real children. `canStart` covers top-level-allowed, child gated on parent status (terminal/planned/queued/running), sibling-running exclusion, dismissed-sibling non-conflict. `tick` covers `maxConcurrentRuns` capacity, terminal-run cleanup on next tick, no-double-start, correct return values. `drainAll` immediate-when-empty, waits for resolvers, respects timeout. `killAll` delegates to `killAllActiveChildren` — closes the R-01 loop started in block 1.
- **service integration tests [audit T-01 phase 3]** (`src/runner/service.integration.test.ts` new, commit `8d0e966`) — 9 integration tests exercising `processRun` end-to-end against a real tmpdir git repo and a mocked adapter. Critical paths covered: plan-mode success, execute with/without diff changes, summary-diff mismatch R-03 (the fix that motivated integration coverage — verifies `verified=needs_review`, `plan_needs_review` event, parent NOT propagated), empty plan → failed + bond delta + run_failed event, adapter throws → catch path + worktree cleanup, 3-siblings-1-failed aggregation (failed wins), verification fail → needs_review independent of R-03, post-failure worktree cleanup verified via `git worktree list`. Tests 10-12 (confidence eval doubts, plan-capture jsonl realism, full autonomous chain plan→auto-execute) stay listed in the audit as T-01 follow-up for a future ~95% push. Gotcha: test 3's initial "no changes" output used the word "implementation" which matches the R-03 `implement\w+` regex — reworded to avoid all modificatory verbs so the mismatch check doesn't fire on a legit no-changes case.
- **Surface pr-sync + version-check in schedule ribbon + API [audit UI-29, UI-30]** (commit `8171755`) — Both jobs ran via `isScheduleReady` in `runtime.ts` but had no observability surface: `/api/status#jobSchedule` didn't emit them, the Schedule Ribbon didn't list them, pr-sync had no `JobCard` in the Guide. Backend: extend `profile.ts#jobSchedule` with `pr-sync` (30min interval) and `version-check` (12h interval) entries following the `auto-plan/auto-execute` pattern. Frontend: add both to the `Maintenance` group (created for cleanup in commit `39875bf`) with fuchsia/gray trigger colors and descriptions. Guide: new `JobCard` for pr-sync documenting batch semantics, timeout, network gate. Version-check card already existed.
- **BACKLOG housekeeping — audit blocks 1–3 follow-through** (commit `b14441f`) — See the dedicated section below for the list of nine entries dropped from BACKLOG.md and their resolution pointers. No code changes.
- **install.sh defaults to HTTPS clone [audit blockers]** (commit `1e67a8f`) — Previously the fresh-install path did `ssh -T git@github.com` first with a 5s timeout before falling back to HTTPS. For anyone curl-piping the installer without an SSH key registered that meant a visible failure message before clone even started. Reversed the default: HTTPS unconditionally, SSH opt-in via `SHADOW_PREFER_SSH=1` env (preserves the old behavior for users who want push access out of the box). Only the probe order changed — all arguments and runtime behavior are unchanged.
- **README MCP tools count 67 → 68** (commit `47ec698`) — Two occurrences updated (landing bullet + Interfaces section). Matches the current registry (audit block 1 verified the count).

---

## Session 2026-04-19 (BACKLOG housekeeping — audit blocks 1–3 follow-through)

Nine backlog entries that were either closed by audit blocks 1–3 or predate the audit (closed by earlier commits) are now removed from `BACKLOG.md`. The canonical record of the fix lives in the commit or audit session listed:

- **RunQueue tracks a phantom adapter** *(2026-04-16)* → audit R-01, commit `fd6dcaf`
- **Task and memory multi-step writes lack transaction boundaries** *(2026-04-16)* → audit D-01, commit `7b710a0`
- **All 7 task MCP tools skip Zod parsing** *(2026-04-16)* → audit M-01, commit `5c21378` (MCP) + W-01 `228c175` (web)
- **Observation events get re-created infinitely** *(2026-04-14)* → audit A-01, commit `6163c52`
- **Suggestions score-sort fetches entire table on every request** *(2026-04-16)* → audit W-05, commit `2c365d4` (momentum cache; limit capping had landed earlier via the score-sort rework noted in the bloque 1 backlog validation)
- **P3: Tables without cleanup mechanism** → audit D-02, commit `4452d8d` + follow-up `39875bf`
- **Parallel execution of runs (plan + execute)** → already shipped via `config.maxConcurrentRuns` in `src/runner/queue.ts` and exposed in Settings; no longer in scope as an open item
- **Runner awaiting_pr path is dead for autonomous execution** *(2026-04-16)* → pre-audit commit `08e89a4` (`fix(runner): reopen parent to awaiting_pr when PR is created manually`) plus auto-plan/auto-execute lifecycle rework
- **Detect PRs created outside Shadow** → subsumed by the awaiting_pr path rework and the `pr-sync` job

This is strictly bookkeeping — no new code. BACKLOG.md's `Last updated` header is now `2026-04-19`.

---

## Session 2026-04-19 (Audit block 2 — observability, performance, autonomy)

Block 2 of the 2026-04-18 full-source audit. Seven fixes across notification throttling, MCP error mapping, two performance hotspots in the dashboard path, pr-sync concurrency, runner hallucination guard, and the daily retention job. Typecheck + 237 tests green after every commit. Seven commits (one per fix) plus shared infrastructure packaged with A-01 where partial staging by line was not available non-interactively.

- **ZodError → -32602 in MCP server [audit M-02]** (`src/mcp/server.ts`, commit `7fcad79`) — The JSON-RPC dispatcher's catch block converted every exception — including Zod validation failures — into `-32603 "Tool execution failed: <err.message>"`. The `issues[]` array with path + per-field message was lost. Now detects `err instanceof ZodError` explicitly and returns `-32602 Invalid params — <path>: <msg>; <path>: <msg>; ...`. Consumers (Claude CLI, dashboard) get the exact field that failed validation instead of a generic Zod serialization.
- **Observation notification throttle 24h [audit A-01]** (`src/analysis/notify.ts`, `src/storage/migrations.ts` v52, `src/storage/mappers.ts`, `src/storage/models.ts`, `src/storage/stores/knowledge.ts`, `src/storage/database.ts`, commit `6163c52`) — One observation accumulated 90+ queued events in prod because `activityNotify`'s dedup only queried `listPendingEvents` (delivered=0). As soon as the user acked an event, the next heartbeat saw no dedup signal and re-queued. Migration v52 adds `observations.last_notified_at TEXT DEFAULT NULL` + index. New `setObservationNotifiedAt(db, id, ts)` store method mirrors the `bumpObservationVotes` pattern. `activityNotify` checks `now - lastNotifiedAt < 24h` before creating the event, and stamps `last_notified_at` after. Same-tick dedup against pending events is preserved as a belt-and-suspenders guard. Note: this commit also carries migration v53 (`llm_usage_daily`) + delegations for W-02 and D-02 because `database.ts` and `migrations.ts` change in multiple fixes — packaged here since line-level partial staging is not available non-interactively. Body of the commit documents the packaging explicitly.
- **N+1 fix in workspace feed [audit W-02]** (`src/web/routes/workspace.ts`, `src/storage/stores/entities.ts`, commit `20da906`) — `GET /api/workspace/feed?projectId=X` called `db.findProjectsForRepo(r.repoId)` inside the run loop — a fresh `JSON_EACH` query per run. Dashboard polling every 30s made this a constant cost: N runs × M projects × 30s poll = many thousand queries/hour with no caching. New `buildRepoProjectsMap(db)` in `stores/entities.ts` runs a single aggregate `SELECT p.*, j.value FROM projects p, json_each(p.repo_ids_json) j WHERE p.status != 'archived'` and builds `Map<repoId, ProjectRecord[]>`. Route materializes the map once (only when `projectId` filter is present) and does in-memory lookups. Zero change to response shape.
- **Project momentum cache 5m TTL [audit W-05]** (`src/web/routes/suggestions.ts`, commit `2c365d4`) — `GET /api/suggestions` with score-sort (default for `status=open`) and `GET /api/suggestions/:id/context` both recomputed `computeProjectMomentum(db, projectId, 7)` for every project on every request. With 20+ projects and dashboard polling every 30s the compute was constant. New module-level `momentumCache: Map<projectId, { value, expiresAt }>` with TTL 5min, wrapped by `getProjectMomentumMap(db, projectIds[])`. Pure time-based expiry — momentum is a 7-day rolling signal, it barely moves in 5 min, so active invalidation on accept/dismiss isn't worth the plumbing. Cache is process-local; warming takes one request after a daemon restart.
- **pr-sync batch + network gate [audit R-04]** (`src/daemon/handlers/pr-sync.ts`, commit `2d5fe44`) — Serial `for (const parent of awaiting)` with `execFileSync('gh', [...])` per run. Each `gh pr view` blocks the event loop ~1-2s, so 20 runs in `awaiting_pr` froze the handler 30-40s while the job queue starved behind it. Converted `execFileSync` → `promisify(execFile)`, extracted `fetchPr(ctx, parent)`, and the top-level loop now processes batches of `BATCH_SIZE=8` concurrently via `Promise.all`. Each `gh` call keeps its own 15s timeout so a stuck remote can't hijack the batch. DB writes stay sequential after each batch to avoid write-lock contention. Added an early return when `shared.networkAvailable === false` — the previous `_shared` param was intentionally unused. Failed children are logged via `.allSettled` so one bad repo doesn't abort the rest.
- **Runner summary-diff coherence validator [audit R-03]** (`src/runner/service.ts`, commit `7249887`) — Closes the severity-high observation about silent hallucination: the LLM's `resultSummaryMd` could claim "modified auth module, added 3 tests" while post-execution `git diff --stat` was empty. The run propagated to parent as `done/executed` and in auto-execute mode a downstream PR followed with the fabricated claim. New `6d` coherence check runs after `6c` verification (so heuristic takes precedence over build/lint when it fires). Regex `\b(modif|add|remov|fix|refactor|implement|creat|delet|updat|writ|renam)\w*\b` with case-insensitive flag scans the summary. When diff is empty AND summary claims changes: `run.verified = 'needs_review'` (overrides whatever 6c wrote), `closedNote = 'Summary claims changes but diff is empty — review before merging'`, event `plan_needs_review` with `reason: 'summary_mismatch'` (priority 7), and parent propagation is skipped entirely — parent stays `planned` until the user retries, closes, or proceeds manually. Scope is `run.kind === 'execution'` only; plan runs are left alone. Heuristic accepts ~10% false positives as the price of zero LLM cost; upgrade path to LLM post-verify is documented in the audit as R-03 follow-up if precision becomes the bottleneck.
- **Daily cleanup job + llm_usage rollup [audit D-02]** (`src/daemon/handlers/cleanup.ts` new, `src/storage/stores/tracking.ts`, `src/daemon/job-handlers.ts`, `src/daemon/runtime.ts`, `src/daemon/schedules.ts`, `src/cli/cmd-daemon.ts`, `src/web/dashboard/src/components/pages/ActivityPage.tsx`, commit `4452d8d`; migration v53 landed with A-01 for reasons noted above) — Five high-churn tables were unbounded: `interactions`, `event_queue`, `llm_usage`, `jobs`. Fresh install at 6 months = GB-scale DB with query degradation. New `handleCleanup` runs daily at 03:30 local (`CLEANUP_SCHEDULE`, gated by `canSchedule` exactly like digests): (1) `rollupLlmUsageDaily(90)` aggregates raw rows > 90d into the new `llm_usage_daily` table keyed by `(date, source, model)`. Idempotent via `ON CONFLICT DO UPDATE`. Preserves historical token views forever. (2) `deleteOldLlmUsage(90)` / `deleteOldInteractions(90)` / `deleteOldJobs(90)` / `deleteOldDeliveredEvents(90)` — the last one is `WHERE delivered=1 AND created_at < cutoff`; pending events never purged (stuck pending is a bug signal, not churn). Protected deliberately: `feedback` (load-bearing for `checkSuggestionDuplicate` dismissed dedup + correction lifecycle), `audit_events` (append-only trail). UI: ActivityPage period picker label "All" → "90d"; the value stays `all` so shared URLs don't break. JobsPage has no period picker so nothing to rename there — rows > 90d simply stop existing post-cleanup. Registered via `schedules.ts` (`CLEANUP_SCHEDULE` export), `job-handlers.ts` (registry entry, category=io, timeout 10min), `runtime.ts` (enqueue on `isScheduleReady` + `canSchedule`), and `cmd-daemon.ts` `JOB_TYPES` so `shadow job cleanup` triggers it manually.

---

## Session 2026-04-19 (Audit block 1 — validation + integrity fixes)

Block 1 of the 2026-04-18 full-source audit (`internal/AUDIT-2026-04-18.md`). Six quirúrgic fixes closing the top critical findings: validation gaps on the task path, multi-step DB write integrity, a backend deny-list regression, the RunQueue phantom adapter, and the StopFailure hook's blind triage. No design work — each fix reuses an existing pattern already present in the codebase. Typecheck + 237 tests green after every commit.

- **Task MCP tools parse with Zod [audit M-01]** (`src/mcp/tools/tasks.ts`, commit `5c21378`) — The 7 task handlers had `inputSchema: mcpSchema(z.object({...}))` Zod schemas, but the handlers themselves bypassed parsing and cast raw params (`params.id as string`, etc.) straight to `ctx.db.*`. Schemas were decorative — used only for `mcpSchema` client hints. Extracted 5 schemas as module consts (`ListTasksSchema`, `CreateTaskSchema`, `UpdateTaskSchema`, `TaskIdSchema`, shared `ExternalRefSchema`), wired `Schema.parse(params)` at the top of every handler, and reused the parsed typed values downstream. Contrast was clear in `memory.ts`/`observations.ts`/`entities.ts` which all already do this.
- **Web task routes parseBody with Zod [audit W-01]** (`src/web/routes/tasks.ts`, commit `228c175`) — Same gap in the HTTP surface: `POST /api/tasks` and `POST /api/tasks/:id/update` did `JSON.parse(await readBody(req))` + manual `as` casts + a single truthy check on `title`. Added `TaskCreateBodySchema` + `TaskUpdateBodySchema` in the same file and routed both endpoints through the existing `parseBody()` helper (`src/web/helpers.ts:54-66`) that suggestions/observations/runs already use. Validation failures now return `400 { error: 'Validation failed', issues: [...] }` with the specific field paths.
- **Multi-step writes wrapped in transactions [audit D-01]** (`src/storage/stores/tasks.ts`, `src/storage/stores/knowledge.ts`, `src/observation/consolidation.ts`, commit `7b710a0`) — `createTask`/`updateTask`/`deleteTask`/`updateMemory`/`consolidateObservations` all issued the main INSERT/UPDATE followed by `syncEntityLinks` (which does DELETE+INSERT against `entity_links`) as separate statements with no transaction. Crash between them left `entities_json` out of sync with `entity_links`, so junction-backed queries either returned ghosts or missed rows. Wrapped the 5 call sites with the existing `BEGIN IMMEDIATE / COMMIT / ROLLBACK` pattern already used in `src/storage/database.ts` (lines 210, 232, 252, 274, added by audit #2 for entity deletes) and `src/profile/bond.ts:268`. No new helper — direct `db.exec('BEGIN IMMEDIATE')` keeps the pattern consistent with the rest of the stores. `updateEntityLinks` already used `BEGIN` (not IMMEDIATE) — left as-is for now; revisit as audit D-13 in a follow-up.
- **Agent SDK honors disallowedTools [audit B-01]** (`src/backend/agent-sdk.ts`, commit `e84808d`) — Line 35 had a literal TODO. The CLI backend (`claude-cli.ts:99-109`) correctly forwards `pack.disallowedTools` via the `--disallowedTools` flag; the SDK adapter never did. Pre-filter `allowedTools` to drop entries matching `disallowedTools` patterns before passing them to `new sdk.Agent({...})`. Added `matchToolPattern` helper that supports exact match + trailing-wildcard globs (e.g. `mcp__shadow__*`). Built-in tools such as `AskUserQuestion` are not in `allowedTools` and can't be hard-denied via this filter path — on such inputs, log an explicit `[agent-sdk] Built-in tools cannot be denied via allowedTools filter` warning on stderr so the gap is visible rather than silent. Backend API is not the default, but the TODO was a red flag worth closing.
- **RunQueue phantom adapter removed [audit R-01]** (`src/runner/queue.ts`, commit `fd6dcaf`) — `startRun()` constructed `new ClaudeCliAdapter(this.config)` and stored it on `ActiveRun.adapter`, but `RunnerService.processRun()` internally called `selectAdapter(this.config)` and it was **that second adapter** that actually spawned the `claude` child. `killAll()` iterated `this.active` and called `kill()` on the phantom — no-op on a process that never existed. The real child stayed alive during drain-timeout windows, contributing to the EADDRINUSE / orphan patterns that motivated the 2026-04-16 plist rework. `ClaudeCliAdapter` already auto-registers every instance in a global `adapterInstances` Set in its constructor (`src/backend/claude-cli.ts:44`), and `killAllActiveChildren()` (line 33-37) iterates that Set. Dropped the `adapter` field from `ActiveRun`, removed the `ClaudeCliAdapter` import + construction from the queue, and routed `killAll()` through `killAllActiveChildren()`. Drain still awaits per-run promises. The two-layer (queue-local + global) cleanup collapses into one source of truth.
- **StopFailure hook triage heuristics [audit H-01]** (`scripts/stop-failure.sh`, commit `3e22f1b`) — The hook used `error_type: (.error_type // "unknown")` on a JSON input that Claude Code never populates with `error_type` — so 100% of `stop_failure` events in `~/.shadow/events.jsonl` had the same bucket. `formatEvents` in `src/analysis/shared.ts:311-335` already aggregates `error_type` for digests, but got a useless "unknown × N" breakdown. Replaced the blind default with a heuristic `tail -50 ~/.shadow/daemon.stderr.log` scan classifying into `auth` (401/unauthorized/invalid api key), `rate_limit` (429/rate limit/quota), `timeout` (timeout/deadline/ETIMEDOUT), `network` (ECONNREFUSED/ENOTFOUND/EHOSTUNREACH), `server` (50x/gateway/overloaded), `oom`, falling back to `unknown` when no pattern matches. Consumer code untouched — the breakdown just gets real categories now. Added `shadow-stop-failure-version: 2` stamp comment following the `PLIST_VERSION` pattern from `src/cli/plist.ts`, so a future version-aware auto-heal in `cmd-init` can reinstall stale hook scripts (tracked for a later sprint).

---

## Session 2026-04-16 (Daemon lifecycle fix — `stop`/`restart` reliability)

- **Root cause: installed plist stuck on `KeepAlive: <true/>`** — The plist template in `cmd-init.ts` was fixed on 2026-04-07 (`a04cc119`) to use `KeepAlive: { Crashed: true }` (only respawn on crash, not on clean SIGTERM), but `shadow init` skips already-installed plists, so Andrés's install had been running the broken `KeepAlive: <true/>` for 8+ days. Every call to `shadow daemon stop` → launchd resurrected the daemon seconds later. Direct evidence: **162 `EADDRINUSE: address already in use :::3700`** errors in `~/.shadow/daemon.stderr.log`, one per failed restart race.
- **Bug 1 — `stopDaemon()` lied** — `src/daemon/runtime.ts:210` removed the pid file immediately after sending SIGTERM, before the process actually exited. But the daemon's own shutdown handler (line 863) removes the pid file as the last step of graceful drain (up to 60s via `jobQueueRef.drainAll(60_000)`). Result: `isDaemonRunning()` returned `false` for the entire drain window even though the process was still alive. Any polling caller waiting for stop got a false positive. Fix: stopDaemon no longer touches the pid file on the happy path; the daemon cleans up its own file during shutdown. Error paths (dead pid, invalid pid) still remove the file.
- **Bug 2 — `gracefulStopDaemon` sent SIGTERM before unloading launchd** — `cmd-daemon.ts:49-83` called `stopDaemon()` first, then (if that failed) `launchctl bootout`. But launchd was still managing the service during the drain window — and with `KeepAlive: <true/>` it respawned the daemon as soon as the original exited. Fix: rewrote the helper with the correct order — bootout FIRST, wait for launchd unload, THEN SIGTERM the pid-in-file if the process is still alive (covers the tsx-wrapper orphan case where launchd only signals the wrapper but the daemon child has a different pid), wait for drain with progress callback, force-kill as fallback. Also added `waitForLaunchdUnload()` helper that polls `launchctl list | grep -q com.shadow.daemon` — necessary because `launchctl list LABEL` and `launchctl print` both return exit 0 even for nonexistent services (errors go to stderr only), so neither gives a reliable binary signal.
- **Bug 3 — web server `startWebServer` failure silently swallowed** — `src/daemon/runtime.ts:299-301` had `catch { /* web module not available — continue without it */ }` around the web server startup. When port 3700 was held by an orphan from the previous stop race, the daemon caught EADDRINUSE, continued without a web server, and ran as a phantom: dashboard unreachable, MCP HTTP dead, but `isDaemonRunning` returned true. The 162 stderr errors accumulated unnoticed. Fix: log a clear diagnostic (with actionable hint to run `shadow daemon stop && shadow daemon start`), then `process.exit(0)` — **not** exit 1, to avoid triggering a crash-loop under `KeepAlive: { Crashed: true }`. Clean exit = launchd does not respawn = user sees the failure in `shadow status`.
- **Bug 4 — `runtime.ts` auto-start triggered in tests** — The auto-start detection `process.argv[1]?.includes('daemon/runtime')` matched both `runtime.ts` AND `runtime.test.ts` (both contain the substring). Tests importing from `./runtime.js` would trigger `startDaemon()`, hit EADDRINUSE against the real daemon, and throw asynchronously. Fix: tightened the check to exact basename match (`runtime.ts` or `runtime.js`, not the substring).
- **New: `waitForDaemonStopped` with progress callback** — Polls `isDaemonRunning()` every 250ms until the daemon exits or the timeout (default 30s, 65s from the CLI to cover Shadow's 60s drain budget). Optional `onProgress` callback fires every 5s with elapsed seconds + active job count from `daemon.json`, so the CLI can show `waiting for N job(s) to drain (Ns elapsed)…` instead of appearing frozen. Both `daemon stop` and `daemon restart` print this progress on stderr.
- **New: `src/cli/plist.ts`** — Single source of truth for plist content + launchctl reload logic, reused by `cmd-init.ts` and the new `daemon reinstall`. Exports: `PLIST_VERSION` constant (v2 = current, v1 = pre-stamp), `PLIST_PATH`, `renderPlistContent()`, `readPlistVersion()`, `writeAndReloadPlist()`. Template upgraded with `<!-- shadow-plist-version: 2 -->` stamp comment, `KeepAlive: { Crashed: true }`, and `ExitTimeOut: 90` (covers 60s drain + 30s headroom so launchd doesn't SIGKILL mid-drain; default is 20s which was below the drain budget).
- **New: `shadow daemon reinstall` subcommand** — Stops the current daemon via `gracefulStopDaemon` (with launchd-first order), regenerates the plist from the current template, and `launchctl bootstrap` reloads. Manual escape hatch for plist upgrades or recovery. Version-aware auto-heal also wired into `shadow init`: if the installed plist has a stamp older than `PLIST_VERSION`, init regenerates and reloads on the fly, printing `plist upgraded v1 → v2`. Users who installed before 2026-04-07 pick up the fix automatically on the next init/upgrade.
- **Semantic fix — `daemon stop` reports `graceful` vs `not_running` correctly** — Initial implementation returned `not_running` when `launchctl bootout`'s own SIGTERM + `ExitTimeOut=90` drained the daemon fast enough that `isDaemonRunning` was false by the time step 2 checked. That made a successful fast-drain stop look like "daemon was never running", which was confusing. Fix: capture `isDaemonRunning()` snapshot before bootout; after bootout, return `graceful` if the daemon was alive before and is gone now, `not_running` only if it was never running.
- **4 sanity tests for the new contracts** — `src/daemon/runtime.test.ts`: stopDaemon preserves the pid file when the target is alive (using a sacrificial `sleep` child), removes it when the target is already dead; `waitForDaemonStopped` returns `true` quickly when the process dies mid-wait (< 2s), returns `false` on timeout (respects the 1s bound). Keeps the regression tight on the contracts we just changed without attempting a full daemon-lifecycle suite.
- **E2E validation on live system** — Ran `shadow daemon reinstall` against Andrés's installed plist: v1 → v2 upgrade succeeded in one step, new daemon came up clean on port 3700. Then `shadow daemon stop` → daemon gone, `launchctl list` empty, no process, port free. Verified the core bug fix: waited **25 seconds** post-stop, daemon stayed stopped (no launchd resurrection). Then `shadow daemon start` → new pid, API responding. Then `shadow daemon restart` → clean transition. **Zero new EADDRINUSE errors** in the stderr log across the full cycle (vs 162 accumulated historical). `npm run build` refreshed `dist/` so the `shadow` global binary (npm-linked to `dist/cli.js`) now has `daemon reinstall` too. Commits: `c44faad`, `aa706a6`.

---

## Session 2026-04-16 (Installation path consolidation)

- **Claude Code plugin path removed — `shadow init` is the sole installation route** — Two divergent installation paths had drifted: `shadow init` (writes hooks + statusLine to `~/.claude/settings.json`, injects CLAUDE.md section, installs launchd plist, registers MCP via `claude mcp add`) vs a Claude Code plugin at `.claude-plugin/plugin.json` (v0.1.0 frozen while project was v0.4.1, `.claude-plugin/mcp.json` orphaned, SessionStart hook inlined `npx tsx` instead of the shared `session-start.sh`, and `claude plugin install` can't install statusLine, inject CLAUDE.md, or bootstrap the launchd service — all core init behaviors per Anthropic's plugin spec). The plugin path was a strict subset of init with divergent wrappers around identical hooks. Removed `.claude-plugin/` and `hooks/` entirely; stripped the "Plugin (alternative registration)" section from `GETTING_STARTED.md` and corrected the architecture diagram ("4 hooks" → "6 hooks + statusLine"). Reversible: if Anthropic extends the plugin spec to cover statusLine + CLAUDE.md + OS services, the plugin manifest can be regenerated from git history.

---

## Session 2026-04-15 (Runner reliability cluster)

- **Stale run detector respects runner timeout and active queue** — `src/daemon/runtime.ts:676-686` hardcoded `STALE_RUN_MS = 10min`, below the 30min `runnerTimeoutMs`, so legitimately slow runs (multi-repo, heavy context) were killed prematurely with `errorSummary='Stale: exceeded 10min timeout'`. Worse, the detector never checked whether the run was still tracked by `RunQueue.active` — a live adapter with an in-flight Claude session could get clobbered from under itself. Fix: added public `RunQueue.isActive(runId): boolean` (queue.ts:115) and rewrote the detector to (a) skip any run still in the queue, (b) use `config.runnerTimeoutMs` as the threshold, (c) report `orphaned from queue` in the error summary so the failure mode is self-documenting. Now only genuinely orphaned runs (DB says running, no adapter) get reaped. Ref: run `1e4dea01`.
- **Empty plan treated as failure, not planned** — Previously if a plan run exited 0 but neither `capturePlanFromSession` nor `result.output` produced content, the runner fell through the happy path: confidence evaluation over an empty string (which could spuriously return `high` from the LLM), `resultSummaryMd: ''` persisted, state transitioned to `planned`. The UI hid the Plan section when `resultSummaryMd` was empty (`src/web/routes/runs.ts:240`), so the run looked healthy but was a ghost — ready to feed a downstream execution that would hallucinate on nothing. Two guards: (1) `evaluateConfidence` short-circuits on empty plan before spending tokens, returns `{ confidence: 'low', doubts: ['plan output is empty — cannot evaluate'] }`; (2) `processRun` treats empty `effectivePlan` as a real failure — transitions to `failed`, propagates to parent via `aggregateParentStatus`, applies bond delta, creates event + audit entry, and early-returns before the happy path touches `resultSummaryMd`. The early-return mirrors the catch-block failure path for consistency. Ref: runs `7a426733`, `8b061e52`.
- **`AskUserQuestion` disallowed + briefing hardening** — Two observed failure modes from runs `3d668e1d` and `8b061e52`: (1) Claude invoked `AskUserQuestion` against a human that wasn't there, the tool failed x2, and the session died with no output; (2) when a tool call got denied (e.g. `oliver__list_dashboards`), Claude retried it 7+ times, burning the turn budget. `AskUserQuestion` is a built-in tool and is **not** covered by `--allowedTools mcp__*` — the allowlist only applies to MCP tools. Fix: extended `ObjectivePack` with `disallowedTools?: string[]`, wired `--disallowedTools` to the CLI adapter (deny rules win over allow in Claude CLI — verified via `claude --help` + docs). Runner now passes `disallowedTools=['AskUserQuestion']` on both the main run pack and the confidence-evaluation pack. Briefing also gained an autonomy hardening block: "**You are running autonomously.** Make assumptions, never ask questions, never retry denied tool calls — adapt using other available tools." Hard defense (deny flag) + soft defense (briefing) together. Agent SDK adapter carries a `TODO` for `disallowedTools`; not the default backend in Andrés's install.
- **`mcp-context` silent in job contexts** — The SessionStart hook (`scripts/session-start.sh`) runs `shadow mcp-context` for every Claude session, including runner-spawned ones. The hook output injected the full soul + "What I know" + recent observations into the model's context, duplicating the soul that the runner already passes via its briefing (`src/runner/service.ts:120-123` loads `soul_reflection` memory directly). Fix: `mcp-context` early-returns with a benign comment line (`# shadow runner context — soul injected by runner briefing`) when `process.env.SHADOW_JOB === '1'`. The env var is already set by `ClaudeCliAdapter:107` for every daemon spawn; interactive spawns (`shadow teach`, `shadow ask`, Workspace session button) deliberately don't set it, so they continue to receive the full context. A comment line rather than empty stdout avoids the `SessionStart:startup hook error` warnings Claude Code emits on empty hook output (GitHub issue #12671, #21643). **Note on the original backlog framing:** the item described the bug as "burns turns on redundant `shadow_check_in`". Post-fix validation (run `efe62362`) showed Claude still calls `shadow_check_in` once as the second tool call — the instruction also lives in `~/.claude/CLAUDE.md` user global (`cmd-init.ts:91-103`). Andrés clarified that this is **not redundant** in runner sessions: `check_in` returns repo-scoped memories, observations, and entities that the briefing doesn't cover. The fix correctly stops the soul-duplication at the hook level; the check_in tool call itself is valuable and left alone.
- **E2E validation run** — Launched a plan run (`efe62362`) with a deliberately ambiguous prompt ("Improve the runner reliability cluster — decide what to harden, make assumptions"). 7m 51s total, status `planned`, `confidence: high`, ~8 KB plan output with real multi-phase content. Transcript analysis (218 lines, `~/.claude/projects/.../b025d449-cba5-4170-a911-dc76e9f3421f.jsonl`): 0 calls to `AskUserQuestion`, confidence eval ran (activity=evaluating → planned), happy path intact. Claude even generated a meta-plan for the next runner hardening pass (diff-coherence check + test suite for state-machine / plan-capture / autonomy handlers) as a side-effect of the ambiguous prompt. Commits: `6f480c8`, `d145dfc`, `e2bd8fc`, `8818437`.

---

## Session 2026-04-15 (Chronicle images + hero video + lightbox)

- **20 Chronicle images generated and wired** — Full art set for `/chronicle`: `hero` (cinematic banner), 8 tier portraits (`tier-1-observer` → `tier-8-kindred`), `tier-locked` (anti-spoiler silhouette), `unlock-placeholder` (wrapped object for locked slots), `bg-texture` (tileable carbon-fiber bg), and 8 milestone icons (`constellation`, `crescent-moon`, `hourglass`, `lantern`, `footprints`, `book`, `quill`, `key`). Generated via Gemini/nano-banana using the prompts in `docs/chronicle-image-prompts.md`, with Reference 1 (style anchor) + Reference 2 (character anchor) for consistency across the series. L5 shadow was the most iterated — the original concept ("ghost casts human-shaped shadow") kept being interpreted as a separate 3D figure by the generator; solved by replacing the hoodie with shadow substance instead (shadow-as-clothing). The decision to allow character evolution tier-by-tier (not rigid Ref2 matching) was saved as a feedback memory for future regenerations. L2 echo and L3 whisper were regenerated after the fact with richer atmospheric framing so the progression L1→L4 didn't feel too flat before the L5 pivot.
- **Hero video (play-once intro)** — Generated with Veo/Gemini (`internal/chronicle-assets/hero-source.mp4`, 1280×720, 8s, h264+AAC, 1.88 MB). ffmpeg pipeline strips audio, recompresses at CRF 23, and crops symmetrically 60px top+bottom to remove the Veo watermark and letterboxing → final `hero.mp4` at 1280×600 (2.13:1, close to 21:9), 1.18 MB. Last frame extracted with `ffmpeg -sseof -0.1 -update 1 -frames:v 1` and used as the static `hero.webp` poster — guarantees a pixel-perfect swap when `onEnded` fires (no visible "pop" between video end and static image). `ChroniclePage` uses the same play-once pattern as `SuggestionsPage`/`ObservationsPage`: `videoEnded` state + `<video autoPlay muted playsInline poster={...} onEnded>` → swap to `<img>`.
- **Image optimization pipeline (PNG → WebP)** — Raw Gemini PNGs were 5-6 MB each at 1024-3168px wide (95 MB total). Installed `webp` via brew, batch-converted with `cwebp -q 85..90 -resize <target> 0`: hero at 1600w, tier portraits at 512px, milestones at 256px, bg-texture at 1024px. Final: **768 KB total** (123× smaller) — individual files 15-90 KB. Raw PNGs moved to `internal/chronicle-assets/` (gitignored) as backup for future regeneration; `public/ghost/chronicle/` only contains the production-ready WebPs + `hero.mp4`.
- **Wiring — `ChroniclePage`, `TierBadge`, `PathVisualizer`, `ChronicleTimeline`, `UnlocksGrid`** — New `chronicle/images.ts` constants module maps tier numbers → portrait paths and milestone keys → icons (`first_correction` → quill, `first_auto_execute` → key, `memories:*` → book, default → constellation). `ChroniclePage` shows hero as header banner. `TierBadge` displays the current tier portrait (96px ring) instead of the emoji badge. `PathVisualizer` shows 8 tier portraits as the progress row. `ChronicleTimeline` prepends each entry with its tier/milestone icon. `UnlocksGrid` replaces the 🔒 emoji with `unlock-placeholder` for locked slots and the tier portrait for unlocked ones. `BOND_TIER_BADGES` emoji constant kept for backwards compat in other pages (status line, notifications).
- **`ChronicleLightbox` — shared component + React Portal fix** — Extracted the click-to-enlarge logic into a reusable `ChronicleLightbox.tsx` component (`{ src, title, subtitle, onClose }`): fixed-position viewport-centered card at 448px, backdrop-blur, ESC + click-outside to close, hover scale + brightness. Used across all 4 Chronicle sections (TierBadge portrait, Path tiers, Timeline icons, unlocked Unlocks). **Portal fix**: the first implementation rendered inline and `position: fixed` broke because `AppShell` wraps `<main>` children in `<div className="animate-fade-in">` where the CSS animation uses `transform: translateY(...)` — any ancestor with `transform` creates a containing block for fixed-positioned descendants, so `fixed inset-0` was positioning relative to that div (and its scroll position), not the viewport. Fix: render the lightbox with `createPortal(ui, document.body)` to escape the containing block chain entirely. Works correctly now regardless of scroll depth.
- **Dev-only `?unlock=1` override (added then removed)** — For visual QA during wiring, added a dev-only override to ChroniclePage that forces `bondTier=8` + all tiers reached + all unlockables unlocked + synthesized fake entries (8 tier_lore + 3 milestones), gated by localhost hostname check. Removed before commit — the review was complete and the override added ~55 lines to ChroniclePage. Cleanup left the page at ~85 lines.
- **BACKLOG cleanup — Radar + Path clipping** — Both resolved in this session:
  - **Radar: axis labels overflow SVG** — `BondRadar.tsx` labels at 125% of radius escaped the `0 0 300 300` viewBox. Fix: `labelPad=70`, SVG rendered at `size + labelPad*2` wide (440px for size=300), viewBox `${-labelPad} 0 ${size + labelPad*2} ${size}` — inner radar math unchanged, labels have horizontal room to breathe without compressing the shape.
  - **Chronicle "The Path" badges clipped at top** — Two layered bugs: (1) `rounded-full` + `object-cover` clipped the ghost's hood in the upper corners because the circle mask cuts the square corners and the character extends into them; (2) `overflow-x-auto` on the flex container implicitly forced `overflow-y: auto`, clipping the `ring-4 scale-105` outline on the current tier. Fix: `w-20 h-20 rounded-xl object-contain bg-bg` (square with rounded corners, no mask cropping), `flex items-center justify-center gap-2 py-3 px-3 flex-wrap` (natural-width items, centered, vertical padding for ring breathing room, no overflow-x-auto — wraps on narrow screens instead of scrolling), fixed-width `w-6` connectors between tiers (were `flex-1`).

---

## Session 2026-04-13 (play-once video intros)

- **Empty state + list headers play-once videos** — Extended the ActivityPage play-once pattern (`videoEnded` state + `onEnded` → swap to `<img>`) to three more surfaces. `EmptyState.tsx` now plays `/ghost/empty.mp4` once on mount then freezes on `empty.png`. `SuggestionsPage.tsx:241` and `ObservationsPage.tsx:84` do the same with `suggestions-header.mp4` / `observations-header.mp4` on their header illustrations. PNG used as `poster` on every `<video>` so the first frame doesn't flash before the MP4 starts. Unlike ShadowTV's looping videos (autoPlay+loop), these are deliberately play-once — the video is an intro, not ambient animation. Three new MP4s committed under `public/ghost/` (2-3 MB each, Gemini-generated).

---

## Session 2026-04-13 (sleep-aware scheduling fix)

- **`systemAwake` check added to scheduler gate via `pmset -g assertions`** — Yesterday's DNS gate alone was insufficient: macOS keeps TCPKeepAlive active during darkwake, so `dns.resolve4('api.anthropic.com')` resolved fine and the gate opened mid-darkwake, letting LLM jobs start that then failed when the Mac returned to sleep. Forensic evidence from the 2026-04-12 clamshell cycle (18:00→20:22): 19 jobs fired inside the sleep window, `consolidate` failed at 136s, `suggest-deep` timed out at the 900s max (15min of Opus inference burned). New `isSystemAwake()` in runtime.ts spawns pmset each tick (~12ms overhead), parses `UserIsActive`, fails open on any error. Combined with network as `canSchedule = networkUp && systemAwake` and applied to all 14 scheduled job enqueues + JobQueue claim loop.
- **Two missing gates closed** — `remote-sync` (runtime.ts:486) and `version-check` (runtime.ts:499) were enqueued without any gate. `remote-sync` is load-bearing because it triggers a reactive cascade: `remote-sync` → `repo-profile` → `suggest-deep` + `project-profile`. Both now wrapped in `canSchedule &&`.
- **JobQueue.tick() accepts `allowClaim`** — When false (darkwake/offline), the claim loop is skipped but in-flight jobs keep running (can't cancel LLM calls mid-inference without losing tokens). Called from runtime.ts as `jobQueue.tick({ allowClaim: canSchedule })`. Queued jobs wait for the next fully-awake tick.
- **Reactive handlers consult shared state** — `DaemonSharedState` gained `networkAvailable` + `systemAwake` flags, propagated each tick from the scheduler. 6 reactive enqueue sites now gate on them: `handleHeartbeat`→suggest + repo-profile, `handleRemoteSync`→repo-profile, `handleRepoProfile`→suggest-deep (first-scan) + project-profile, `handleSuggestDeep`→suggest-project. `handleRepoProfile` signature changed from `(ctx)` to `(ctx, shared)`. Without this, a parent job that legitimately started could still spawn LLM children mid-darkwake via the reactive path.
- **Deploy + pending validation** — Shipped via `shadow daemon restart` (commit 0588059), pmset overhead verified at 12ms. Overnight clamshell sleep test scheduled for 2026-04-14 morning: expected 0 jobs with `started_at` inside the sleep window + multiple `Skipping job scheduling — system not fully awake` entries in daemon.stderr.log.

---

## Session 2026-04-13 (run lifecycle PR-aware + UI polish)

- **PR-aware run lifecycle** — New `awaiting_pr` non-terminal status between `planned` and terminal. Parent plan stays `planned` while the execution child runs (no more eager transition to `done` on Execute click). When the child finishes successfully: if it created a PR → parent transitions to `awaiting_pr`; if it made changes without a PR → `done` outcome=executed; if it decided no changes were needed → `done` outcome=closed with the child's resultSummaryMd as `closedNote`. The new `pr-sync` job (IO, 30min, gated on `awaiting_pr` count > 0) polls `gh pr view` and finalizes: MERGED → parent `done` outcome=merged + `pr_merged` event; CLOSED → parent `dismissed` with `closedNote='PR closed without merge'`. State machine adds `planned → awaiting_pr` and `awaiting_pr → {done, dismissed, failed}`. `aggregateParentStatus()` (already present in state-machine.ts since the concurrency commit) was the missing piece — both `/execute` and `auto-execute` were short-circuiting it by transitioning the parent eagerly. Now they only create the child and let aggregation drive the lifecycle. Andrés's mental model: `done` = PR finalized.
- **RunQueue.canStart** — Now allows children when parent is `planned` (in addition to terminal). New guard against concurrent siblings: only one execution child per parent runs at a time. Fixes the latent bug where auto-execute + autonomy created queued children that never ran (parent in planned was never terminal).
- **`queued` runs no longer marked failed on daemon restart** — `cleanOrphanedJobsOnStartup` was killing queued runs with `errorSummary='orphaned — daemon restarted'`. They were never running. RunQueue.tick() re-picks queued runs on the next tick — leave them alone. Only `running` runs are real orphans.
- **Retry button in Execution step** — Was only in Plan step (for failed plan generation). Now when the latest non-archived child is `failed`, a Retry button appears in the Execution step that calls `retryRun(child.id)` — archives the failed child and creates a new one with same `parentRunId`. Also surfaces a special message when `errorSummary === 'orphaned — daemon restarted'`. The Plan-step Execute button now hides when children already exist (was redundant).
- **Spinner + adaptive polling + activity render in RunJourney** — The Step component dropped `animate-pulse` because of how the dot class was split (`dot[status]?.split(' ')[0]`). Fixed to apply `animate-pulse` explicitly when status='active'. Polling adapts: 5s when something is running/queued, 30s otherwise. The `activity` field (preparing/executing/verifying) is now rendered next to the running attempt.
- **PR badges polish** — Old badge logic showed `'draft'` text but inherited the state's color (so a draft OPEN looked green like ready-to-merge, and a draft CLOSED was red+labeled `'draft'`). Replaced with a clean priority: MERGED > CLOSED > draft > open. Distinct colors: merged=purple, closed=red, draft=orange, open=blue. checks/review badges only show when state=OPEN. Fixed `replace('_', ' ')` → `replace(/_/g, ' ')` for multi-underscore review decisions.
- **Activity page run:execute enrichment** — `JobOutputSummary` had `return null` for run:execute. Now collapsed shows diffStat, outcome (when not 'executed'), task title; expanded shows task link, confidence + doubts list, full diffStat, verification per command, error summary in red, summary markdown rendered via `<Markdown>` component, plus PR/Workspace links. Backend `activity.ts` extended to include `taskId`/`taskTitle` (join to tasks) + `errorSummary`/`outcome`/`diffStat`/`doubts`/`verification` in the result object.
- **`/api/runs` includes execution children** — When the endpoint returns parent runs (filtered by status), it now also includes their non-archived execution children. Without this, RunsPage's pipeline view broke for parents in `awaiting_pr` because their children were in `done` and didn't match the same filter.
- **Workspace `awaiting_pr` integration** — Added to `activeRunStatuses` set, `runStatusFilter` resolution, priority 104 in `assignPriority`, count tabs, and fetch arrays. Also the new state appears in `RUN_STATUS_BORDER`/`ICON`/`ICON_COLOR` (border-l-fuchsia-500, ⏳ icon, fuchsia text) and `STATUS_BADGE` map for ActivityEntry. RunsPage gets a new "Awaiting PR" filter tab with fuchsia styling.
- **Color recoloring run:execute → fuchsia** — `run:plan` (indigo) and `run:execute` (violet) were both in the purple spectrum and indistinguishable at badge size. `run:execute` is now `bg-fuchsia-500/20 text-fuchsia-300` — magenta, distinct hue. PHASE_DOT/PHASE_TEXT for 'executing' + JOB_ACTIVE_DOT/JOB_ACTIVE_TEXT for 'run:execute' updated to fuchsia. FeedRunCard kind badge now uses JOB_TYPE_COLORS instead of plain gray.
- **Markdown rendering in Activity expanded view** — Plan summary was rendered as raw markdown with `whitespace-pre-wrap`. Now uses the existing `<Markdown>` component (`src/web/dashboard/src/components/common/Markdown.tsx` with react-markdown + softBreaks). Headings, lists, code blocks, links work properly.
- **`pr-sync` handler bug fix** — First version of the handler used `--json state,merged,mergedAt`. The `merged` field doesn't exist in `gh pr view` output (the correct fields are `state` which is `OPEN`/`CLOSED`/`MERGED`, plus `mergedAt`/`closedAt`). It failed silently because the silent catch in the handler swallowed parse errors. Fixed to use `--json state,mergedAt`.
- **Build path correction in CLAUDE.md** — CLAUDE.md previously said the dashboard build outputs to `src/web/public/`. The reality (in `src/web/server.ts:63-65`) is the daemon serves from `src/web/dashboard/dist/` (with legacy fallback to `src/web/public/index.html` if dist doesn't exist). I lost ~3 build cycles in this session because I changed `vite.config.ts` to write to `public/` (matching the docs) and the daemon kept serving stale assets from `dashboard/dist/`. Reverted the vite outDir to `dist` and updated CLAUDE.md.
- **`pr-sync` job registered in CLI + runtime** — `shadow job pr-sync` triggers manually. Registered in `cmd-daemon.ts` JOB_TYPES, `job-handlers.ts` registry (category=io), `runtime.ts` periodic enqueue (30min, only when `awaiting_pr` count > 0).

---

## Session 2026-04-13 (bond system + Chronicle page + v49)

- **Bond system v49** — Replaced single-score trust with 5-axis bond + 8 tiers. Schema v49 ADD-only (follows v40-v48 convention): `bond_axes_json`, `bond_tier`, `bond_reset_at`, `bond_tier_last_rise_at` on `user_profile`, plus new tables `chronicle_entries` (immutable narrative records with UNIQUE indexes per tier_lore tier + milestone_key), `unlockables` (8 placeholder slots seeded), `bond_daily_cache` (24h TTL for Haiku outputs). Legacy `trust_level`/`trust_score`/`bond_level`/`required_trust_level`/`trust_delta` columns stay unused for v50 cleanup.
- **Axis formulas** — time (sqrt curve over 1 year, gate-only), depth (saturating 1−e^(−n/60) over taught/correction/knowledge_summary/soul_reflection memories), momentum (28d window of feedback accept/dismiss + runs done + observations done/ack), alignment (60% accept-dismiss rate + 30% corrections + 10% soul reflections), autonomy (saturating over successful parent_run_id runs). All pure functions in `src/profile/bond.ts`.
- **Tier engine** — 8 tiers (observer/echo/whisper/shade/shadow/wraith/herald/kindred), dual-gated (min days + quality floor avg of 4 dynamic axes), monotonic (never retrocede). `applyBondDelta` is sync: recomputes axes, persists, evaluates tier, fires fire-and-forget hooks on rise (chronicle lore + event_queue + unlock eval). Event kind is informational — axes are data-driven, idempotent.
- **Reset flow** — `resetBondState(db)` transactional: zeroes axes, tier to 1, clears chronicle_entries + bond_daily_cache, relocks unlockables. Preserves memories, suggestions, observations, runs, interactions, audit, soul. Triggered on first daemon boot via `~/.shadow/bond-reset.v49.done` sentinel (atomic `fs.openSync(path, 'wx')`). Also exposed as `shadow profile bond-reset --confirm`.
- **Chronicle page** — New `/chronicle` route (sidebar 🌒) with 6 sections: TierBadge (ghost art + lore fragment), BondRadar (hand-rolled 5-axis SVG), PathVisualizer (8 nodes, future tiers as silhouettes), NextStep (time + quality requirements + Haiku hint), ChronicleTimeline (entries), UnlocksGrid (8 slots). Voice of Shadow ambient phrase in header + Morning page. Anti-spoiler filter server-side (`/api/chronicle` masks future tier names as '???' and excludes unreached `tier_lore` entries).
- **4 LLM activities in `src/analysis/chronicle.ts`** — triggerChronicleLore (Opus, tier-cross, immutable), triggerChronicleMilestone (Opus, memories:N/first_correction/first_auto_execute, immutable), getVoiceOfShadow (Haiku, 24h cache), getNextStepHint (Haiku, 24h cache). Config: `models.chronicleLore`/`chronicleDaily` + env vars.
- **Rename trust→bond** — Full cleanup across DB, types, mappers, stores, profile module (git mv trust.ts → bond.ts), runner, suggestion engine, MCP tools, CLI (`shadow profile bond`, `shadow profile bond-reset --confirm`), web routes (new `handleChronicleRoutes`), dashboard (Topbar, Sidebar, MorningPage, DashboardPage, NotificationPanel with `bond_tier_rise` + `unlock` event kinds, deleted SectionTrustLevel). Dead code removed: `isActionAllowed`, `DEFAULT_ACTION_TRUST`, `AutonomyOverride`, local `applyTrustDelta` helper in suggestion/engine.ts.
- **Guide updates** — New Bond System section with 5-axis and 8-tier tables, new Chronicle section. GuideStatusLine renamed Trust Badge → Bond Badge with 8 tiers. GuideOverview + GuideMcpTools + GuideConfig updated (added SHADOW_MODEL_CHRONICLE_LORE / CHRONICLE_DAILY env vars). `BOND_TIERS_DATA` + `BOND_AXES_DATA` + `CHRONICLE_CONCEPT` exports in guide-data.ts.
- **Statusline fix (portable paths)** — `scripts/statusline.sh` had hardcoded `/Users/andresg/...` (wrong user, from a stale install). Replaced with `$HOME` + `$(command -v shadow)` + `$SHADOW_DEV_DIR` override. Also updated the tier case statement to 8 tiers with new emojis (🔍 💭 🤫 🌫 👾 👻 📯 🌌) and changed the grep pattern from `trustLevel` to `bondTier`.
- **v49 migration fix** — First deploy attempt failed with `Cannot add a column with non-constant default`. SQLite rejects function calls in ALTER TABLE ADD COLUMN DEFAULT. Fix: placeholder constant `'2026-01-01T00:00:00Z'` followed by `UPDATE user_profile SET bond_reset_at = datetime('now')` in the same migration step. The sentinel reset hook on first boot overwrites it again.
- **Research + design** — 7 rounds of brainstorming grounded in Pet Companion design (Yu-kai Chou), Self-Determination Theory (Ryan & Deci), Duolingo streak psychology (loss aversion, streak freezes), Stardew Valley heart system, Habitica gamification. Pre-written image generation prompts saved locally in `internal/docs/chronicle-image-prompts.md` for Midjourney/Flux/DALL-E (hero, 8 tier portraits, locked silhouette, unlockable placeholder, bg texture, milestone icon set).

---

## Session 2026-04-12 (corrections lifecycle + cmd+k)

- **Corrections timing fix — `enforced_at` + 48h grace window + merge absorption** — Migration v48: `memories.enforced_at INTEGER`. `enforceCorrections` ya no promueve a `kind='taught'`; stampa `enforced_at` (sólo si la enforcement completó con éxito — flag `enforceSucceeded` cubre LLM/parse/catch failures). `loadPendingCorrections` filtra por `enforced_at IS NULL OR enforced_at > now() - 48h` — readers siguen viendo corrections recién aplicadas durante 48h (cubre cadencia ≤ diaria de `reflect`, `digest-daily`, `repo-profile`, `project-profile`). `mergeRelatedMemories` ahora absorbe corrections post-grace: bypass condicional de `PROTECTED_KINDS` + core-layer gate, prompt con nota sobre corrections. Resultado: la correction se disuelve en la memoria que corrigió via pipeline existente con `sourceMemoryIds` trackeados. `kind='taught'` queda legacy. Bug detectado y fixed durante validación end-to-end: el catch del LLM call stampaba `enforced_at` incluso en fallo → data loss path — Shadow mismo lo reportó vía suggestion durante el propio run de consolidate.
- **Cmd+K global search** — Command palette en dashboard (Cmd+K / Ctrl+K / `/`). Búsqueda unificada sobre memories, observations, suggestions, tasks, runs, projects, systems, repos, contacts. Reusa `hybridSearch` (FTS5+vector) para knowledge entities y SQL LIKE para structural. Resultados agrupados por tipo con badges, keyboard nav (↑↓/Enter/Esc), recents en localStorage (max 10, LRU).
- **Deep-link prefetch pattern** — Endpoint genérico `GET /api/lookup?type=X&id=Y` para fetch individual. `useHighlight` ahora expone `highlightId` capturado (sobrevive al clear del URL). 4 páginas (Memories, Observations, Suggestions, Runs) hacen prefetch del item si no está en la lista visible y lo prependan. Evita el silent-fail de deep-links a items fuera de la primera página paginada.

## Backlog cleanup 2026-04-12

- **Warning de worktree huérfano** — Cerrado por diseño. El endpoint `/api/runs/{id}/cleanup-worktree` (`src/web/routes/runs.ts:318-321`) ya es idempotente: envuelve `git worktree remove` y `git branch -D` en try/catch silencioso y limpia `worktreePath` en DB al final. Si el directorio no existe, el remove falla, se ignora, y la DB queda limpia igual. Un warning visual no aportaba acción diferenciada.
- **Auto-accept de planes** — Superseded by L4 Autonomy. `auto-plan` revalida suggestions maduras contra código y crea plan runs; `auto-execute` ejecuta planes con high confidence + 0 doubts. UI configurable (effort, risk, impact, confidence, kinds, per-repo opt-in) en `SectionAutonomy.tsx`.
- **Timeout diferenciado plan vs execute** — Already shipped in L4. Per-job `timeoutMs` en `JobHandlerEntry`: auto-plan 30min, auto-execute 60min. Infraestructura en `JobQueue` (`entry.timeoutMs ?? JOB_TIMEOUT_MS`).
- **Agrupación por repo en dashboard** — Dropped. Los filtros por repo ya existen en suggestions/observations; la agrupación visual sería cosmética y redundante.
- **Evaluar intervalos de jobs con datos reales** — Dropped. Item de análisis, no actionable. Si aparece evidencia de que un job quema tokens sin valor, se revisa puntualmente.

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

Full audit report archived in `internal/AUDIT-2026-04-06.md` (not tracked). ~100 findings, all actionable items resolved.

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
