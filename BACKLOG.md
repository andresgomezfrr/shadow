# Shadow — Backlog

Last updated 2026-04-15. Completed items in [COMPLETED.md](COMPLETED.md).

---

## High priority

_No high priority items right now._

---

## Medium priority

### WorkspacePage filter + lifecycle tests · [area:dashboard]

**Context**: Rendering per filter, state transitions of the unified feed and context panel.

---

### Stale run detector kills active runs prematurely *(2026-04-14)* · [area:runner]

**Context**: The stale detector in `src/daemon/runtime.ts:676-686` has a hardcoded 10min timeout, but the actual runner timeout is 30min (`runnerTimeoutMs`). The detector doesn't check whether the run has an active process in `RunQueue.active` — it only looks at `status='running'` + elapsed time in DB. Result: legitimately slow runs (multi-repo, plan mode with heavy context) get killed at 10min with `errorSummary="Stale: exceeded 10min timeout"`. Ref: run `1e4dea01`.

**Fix**: (1) use `config.runnerTimeoutMs` instead of the hardcoded 10min, (2) check `RunQueue.active` before marking as stale — if the runner has it in its map, it's alive and not stale.

---

### Empty plan not treated as failure *(2026-04-14)* · [area:runner]

**Context**: When a plan run completes with exit code 0 but `capturePlanFromSession` finds no plan (Claude didn't write to `~/.claude/plans/`) and `result.output` is empty, the runner saves `resultSummaryMd = ""` and marks the run as `planned`. The confidence eval runs over an empty string and produces doubts, but the run stays in `planned` state with no real plan. Ref: runs `7a426733`, `8b061e52`.

**Fix**: in `src/runner/service.ts` after plan capture (~L228), if `effectivePlan` is empty/whitespace, treat as failure (`status=failed`, `errorSummary="Plan mode produced no output"`). Don't run confidence eval without a plan. Note: the confidence eval returned `high` with an empty plan in `8b061e52` — the eval should reject empty plans before invoking the LLM.

---

### `AskUserQuestion` should not be available in runner sessions *(2026-04-14)* · [area:runner]

**Context**: Root cause of both runs `3d668e1d` and `8b061e52` producing no plan. Claude did excellent investigation, had all the information, but instead of writing the plan with reasonable assumptions, it called `AskUserQuestion` — which has no human on the other end. In run 1, the questions had obvious answers (Claude marked them as "Recommended" in its thinking). In run 2, `AskUserQuestion` failed x2 and the session died with no output.

**Fix**: Two-layer fix: (1) exclude `AskUserQuestion` from `allowedTools` in `src/runner/service.ts` (~L176) for runner sessions, (2) add to the briefing (~L148): "You are running autonomously — there is no human to answer questions. Make reasonable assumptions and document them in the plan."

---

### Runner doesn't limit retries on tool permission denied *(2026-04-14)* · [area:runner]

**Context**: In run `8b061e52`, Claude retried `oliver__list_dashboards` 7 times after permission denied, and `shadow_check_in` 2 times. Each retry burns a turn with no result. Not strictly a runner bug (it's Claude behavior), but the briefing should include an instruction: "If a tool call is denied, do NOT retry — adapt your approach using other available tools."

**Fix**: Alternatively, evaluate whether `--allowedTools 'mcp__*'` actually matches Oliver/Shadow tools in the runner session, or if there's a gap in the pattern.

---

### Soul injection in briefing causes redundant check_in *(2026-04-14)* · [area:runner]

**Context**: The runner briefing injects the full Shadow soul (via `shadow mcp-context`), which includes the instruction "call `shadow_check_in` at session start". Claude obeys and burns 1-2 turns calling `shadow_check_in`, which is redundant (the soul is already in the prompt) and sometimes fails on permissions.

**Fix**: either don't inject the check_in instruction into the runner context, or make `mcp-context` support a `runner` mode that omits interactive instructions (check_in, greeting, events).

---

### Parallel execution of runs (plan + execute) · [area:runner]

**Context**: Currently the runner processes 1 run at a time — the others stay `queued` until it finishes. Allow configurable concurrency (N simultaneous runs) for plan and execute. Evaluate: default limit, impact on SQLite WAL contention, and whether JobQueue needs a semaphore or pool.

---

### Repos without initial suggest-deep stay excluded from the scheduler *(2026-04-14)* · [area:runner]

**Context**: The periodic `suggest-deep` scheduler in `runtime.ts:645` does `if (!lastDeep) continue` — it only re-schedules repos that already had a first scan. The first scan is triggered from `repo-profile` (`profiling.ts:59-69`), but if that trigger is missed (network, darkwake, `break` after the first), the repo stays permanently excluded from the suggestion cycle.

**Fix**: treat repos without `lastDeep` as candidates with `daysSince = Infinity`, don't skip them.

---

### Observations linked to the wrong repo don't generate suggestions *(2026-04-14)* · [area:runner]

**Context**: Observations generated by the heartbeat can link entity type `repo` to a different repo than the one they're actually about (e.g. they link to a monitoring repo when the observation is about the service). Normal suggest (`notify.ts` / `activitySuggest`) filters observations by entity type `repo` → those observations don't feed suggestions for the correct repo. Two problems: (1) the heartbeat LLM doesn't always associate the correct `repo_id` in `entities_json`, (2) the suggestion pipeline should also consider links by `project`, not just by `repo`, to capture cross-repo observations.

---

### revalidate-suggestion fails when the LLM responds narratively instead of JSON *(2026-04-14)* · [area:llm]

**Context**: The revalidate prompt asks for "FINAL message must be ONLY a JSON object" but when the LLM investigates with tools (Read, Grep) and concludes that the suggestion is already resolved, it sometimes responds with narrative analysis with code blocks instead of JSON. `extractJson` in `src/backend/json-repair.ts:6-18` uses the "first `{` to last `}`" heuristic that captures `{` from code fences (TypeScript objects), confusing them with the response JSON. The job is marked as `completed` with `error: "Parse failed"` but doesn't retry or apply a fallback.

**Fix**: Proposed fix: (1) if `extractJson` fails, make a second attempt with a regex that specifically looks for the `{"verdict":` pattern to distinguish the response JSON from quoted code, (2) if no valid JSON in the output, retry the LLM call once with a reinforced prompt ("respond ONLY with JSON, no markdown"), (3) mark the job as `failed` instead of `completed` with silent error so it's visible in Activity as a real failure.

---

### Plan too long · [area:runner]

**Context**: repos with large files can saturate context. Evaluate file size hints in briefing or exclusion of large files.

---

### Detect PRs created outside Shadow · [area:runner]

**Context**: If a run has a worktree but no prUrl, detect whether a PR exists with `gh pr list --head shadow/{id}`.

---

### Digest/Morning don't update after re-running job · [area:dashboard]

**Context**: Scenario: digest job fails with timeout ("Process timed out"), gets relaunched manually for the previous day, the job runs OK but neither the Digests page nor the Morning reflect the new result. Possible causes: (1) the digest is inserted with period_start/period_end that don't match the previous day's query, (2) the UI caches or filters by date in a way that excludes regenerated digests, (3) the morning page uses a different query that doesn't pick up the updated digest.

**Fix**: Investigate query boundaries, upsert vs duplicate insert, and whether frontend refetch is correct.

---

### Show plan and execute sessions in the Journey · [area:dashboard]

**Context**: The Journey shows steps (plan, execution, PR) but doesn't expose the Claude Code sessions associated with each phase. It would be useful to see a link/reference in each step to the session that generated that result — both the plan session and the execution session — to inspect the transcript or summarize it from the dashboard.

---

### Improve attempts UX in the Journey (run retries) · [area:dashboard]

**Context**: The "Execution attempts" section in `RunJourney.tsx` is too terse when there are multiple attempts. Problems: (1) each attempt is a flat line with no link — no drill-down to the child run for detail, (2) only the `errorSummary` of the last active attempt is shown, errors from previous attempts disappear, (3) archived attempts are shown struck through with no context for why they failed, (4) no clear visual differentiation between the active attempt and previous ones.

**Fix**: Improve: add a clickable link per attempt navigating to the child run, show collapsible error per failed attempt, and better visual hierarchy active vs previous.

---

### Dashboard link in the status line · [area:dashboard]

**Context**: Add a clickable icon/link in the Claude Code status line (`scripts/statusline.sh`) that opens the browser with the dashboard (`localhost:3700`). Evaluate whether the status line supports clickable links or whether another mechanism is needed (e.g. keyboard shortcut, output with URL that the terminal renders as a link).

---

### Unify run spinner in RunsPage with the Workspace one · [area:dashboard]

**Context**: The RunsPage uses `animate-pulse` on a 2x2px dot (`RunPipeline.tsx:11`) for the `running` state, while the Workspace uses the `RunSpinner` from `FeedRunCard.tsx:8-12` (circular border-spinner 3.5x3.5 with `rotation` keyframe).

**Fix**: Extract `RunSpinner` to a shared component and also use it in `RunPipeline` and in the Journey (`RunJourney.tsx:223`) for visual consistency.

---

### Closing note when closing a task · [area:dashboard]

**Context**: `shadow_task_close` doesn't accept a comment or close reason. Allow an optional `closedNote` (like runs already have) to indicate the final state: moved to backlog, implemented, discarded, etc. Reflect in the MCP tool, the API, and the Workspace UI.

---

### Show related suggestions on the Tasks page · [area:dashboard]

**Context**: The Workspace journey shows related suggestions for a task, but the detail view on the Tasks page doesn't. Add the same related suggestions section to task detail on Tasks.

---

### Show multiple PRs in task description · [area:dashboard]

**Context**: When a task has more than one run with an associated PR, the UI only shows 1 PR. Show all linked PRs (list or badges) in the task card/detail in Workspace.

---

### Repo filter in Workspace · [area:dashboard]

**Context**: The Workspace shows tasks and runs from all repos mixed together. Add a repo filter/selector that allows viewing only the tasks/runs associated with a specific repo. Use `repo_ids_json` from tasks and the run's repo to filter. Include an "All repos" option as default.

---

### Optimize `/ghost/` assets — PNG → WebP + resize pipeline *(2026-04-15)* · [area:dashboard]

**Context**: 49 static PNG ghost illustrations under `src/web/dashboard/public/ghost/` (outside `chronicle/`) weigh ~6-8 MB each, total ~276 MB. They're UI assets (page headers, ghost phases, empty states, 404) that don't need anywhere near that resolution. Dashboard loads them on-demand, so every page view downloads multi-MB images. The Chronicle session (2026-04-15) applied a resize + cwebp pipeline to 20 PNGs and got 95 MB → 768 KB (123× smaller) — same approach would shrink the rest of `/ghost/` from ~276 MB to ~5 MB. Tools already installed from that session (`webp`, `ffmpeg`). Note: git history keeps the raw PNGs — repo size on fresh clone doesn't drop unless `git filter-repo` is run (destructive, skip). The real gain is dashboard runtime (fewer bytes per page view) and future working trees.

**Fix**: (1) batch convert with `cwebp -q 85..90 -resize <target> 0` — target widths per use case: heroes/page illustrations at 1024, ghost phase frames at 512, small icons at 256. (2) Move originals to `internal/ghost-assets/` (gitignored) as backup for future regeneration. (3) Grep + replace `.png` references in `.tsx`/`.ts` (MorningPage, WorkspacePage, SuggestionsPage, ObservationsPage, MemoriesPage, ProjectsPage, RepoPage, SystemPage, TeamPage, ActivityPage, DigestsPage, 404, Guide, `useGhostPhase.ts` hook). (4) Visual review every page before commit. (5) Leave MP4 files alone — they're already video-compressed.

---

### Depth axis doesn't grow: job-created memories don't count *(2026-04-14)* · [area:bond]

**Context**: `computeDepthAxis` in `src/profile/bond.ts` only counts memories with `kind IN ('taught','correction','knowledge_summary','soul_reflection')`. But automated jobs (heartbeat, consolidation, enrichment) create memories with kinds like `convention`, `preference`, `infrastructure`, `workflow`, etc. that aren't in that list. Post-reset only memories of those kinds exist → depth = 0 permanently.

**Fix**: Evaluate: (1) widen the eligible kinds list, (2) have consolidation produce `knowledge_summary`, (3) have `shadow_memory_teach` from MCP always use `taught` regardless of the kind requested by the LLM. The cleanest is probably (1) — recognize that all non-ephemeral memories represent depth.

---

### Observation events get re-created infinitely *(2026-04-14)* · [area:daemon]

**Context**: Confirmed bug. In `src/analysis/notify.ts:42-48`, the `observation_notable` dedup only queries `listPendingEvents()` (delivered=0). When the user marks events as read (delivered=1), the next heartbeat doesn't see them and re-creates an event for each high/critical observation still `open`. Result: one observation can accumulate 91+ events (verified in DB).

**Fix**: dedup must check **all** events for that observation (not just pending), or use a flag on the observation itself (`notifiedAt`) to avoid re-notifying.

---

### Evaluate: bond per repo instead of global *(2026-04-08)* · [area:bond]

**Context**: Global bond vs per-repo. Shadow may know a lot about one repo and little about another. Discuss before designing.

---

### MCP server ordering in dashboard *(2026-04-08)* · [area:dashboard]

**Context**: Drag-drop to reorder MCP servers in Enrichment. Order as a hint for the LLM.

---

## Low priority

### P3: Tables without cleanup mechanism · [area:db]

**Context**: `interactions`, `event_queue`, `llm_usage`, `jobs`, `feedback` grow without limit. No retention policy or cleanup job. Implement as job type `cleanup` (IO, daily). Low current impact, relevant long-term.

---

### Suspend/sleep detection guard for Linux · [area:daemon]

**Context**: `isSystemAwake()` in `src/daemon/runtime.ts` uses `pmset -g assertions` (macOS-only). On Linux it fails silently and returns `true` (fail-open), so the daemon doesn't distinguish full-wake from suspend and schedules jobs during sleep.

**Fix**: Implement equivalent detection on Linux (e.g. `systemd-inhibit --list`, `/sys/power/state`, or subscribing to DBus `org.freedesktop.login1` PrepareForSleep). Add a platform guard that picks the right strategy per OS.

---

### Daemon logs in dashboard · [area:dashboard]

**Context**: `console.error` goes to `daemon.stderr.log` but is not accessible from the dashboard.

---

### `tsc` doesn't clean `dist/` after module renames

**Context**: `npm run build` calls `tsc` directly, which does NOT delete dist files corresponding to sources that have been removed. Discovered in v49: the rename of `src/heartbeat/` → `src/analysis/` (previous commit) left `dist/heartbeat/` with `profile/trust.js` importing from a dead path, and since the daemon's MCP server loads from `dist/`, the `shadow_memory_teach` tool failed with `Cannot find module 'profile/trust.js'` after `shadow daemon restart` despite the TS source being clean. Current workaround: run `npm run clean && npm run build` after any module rename.

**Fix**: Fix options: (a) make `npm run build` call `clean` before `tsc`, (b) migrate to a bundler that tree-shakes (esbuild/tsup), (c) add a `tsc --build --clean` prestep. Option (a) is the most pragmatic.

---

### MCP STDIO server doesn't restart with `shadow daemon restart` · [area:mcp]

**Context**: The STDIO MCP server that Claude Code starts at the beginning of each session stays pinned to that session. `shadow daemon restart` only restarts the web daemon (port 3700) + launchd background jobs, but not the STDIO MCP server. If there's a rename mid-session (e.g. today's `trust.ts` → `bond.ts`), the dynamic imports cached in the STDIO MCP server still point to the old path and MCP tool calls fail until Claude Code is restarted. Low impact in normal sessions, material during large refactors.

**Fix**: Fix options: (a) detect changes in `src/` and auto-restart the MCP server, (b) add a `shadow mcp restart` CLI that signals the MCP STDIO process, (c) accept the limitation and document the workaround (restart Claude Code after refactors of dynamically imported modules). Option (c) is probably enough — it's a rare case.

---

## Long-term / evaluating

### L5 — selective auto-merge · [area:runner]

**Context**: Configurable autonomy per repo/scope. Shadow merges where it has permission. Requires post-L4 evaluation.

---

### Unlockables content (v49 follow-up) · [area:bond]

**Context**: 8 placeholder slots seeded in v49 with `kind='placeholder'` and `title='???'`. Fill them gradually with real content (ghost variants, status phrase pools, theme overrides, badge emojis) via direct DB update or a future `shadow_unlock_define` MCP tool.

---

### Drop v49 legacy columns (v50 cleanup) · [area:db]

**Context**: After at least a month in v49, drop `user_profile.trust_level`, `trust_score`, `bond_level`, `suggestions.required_trust_level`, `interactions.trust_delta`. All unused since v49 but kept due to the ADD-only convention of previous migrations.

---

### Evaluate: enforce entity linking in memories, observations, suggestions and runs *(2026-04-08)*

**Context**: Audit whether we always associate `entities_json` when the information allows it.

---

### Monorepo support: one repo, multiple projects with path prefixes *(2026-04-08)*

**Context**: Path prefixes per project, boundary detection (BUILD.bazel, package.json), heartbeat scoping, granular entity linking.

---

### Circuit breaker for MCP servers in enrichment · [area:llm]

**Context**: The enrichment pipeline (`src/analysis/enrichment.ts`) has no per-server failure tracking. Every run includes all enabled MCP servers even if they fail consistently — the LLM doesn't know that a server failed the previous time and spends budget retrying.

**Fix**: Implement per-server failure tracking (in-memory or DB), exclude servers with open circuit from the prompt and `allowedTools`, auto-recover after a configurable cooldown. Extensible to a generic circuit breaker for all LLM calls.

---

### Include enrichment_cache in hybrid search (FTS5 + vec0) · [area:mcp]

**Context**: `shadow_search` and `/api/search` only query memories, observations and suggestions. Enrichment data has embeddings generated (`enrichment_vectors` vec0 table exists) but is never queried — it's write-only from the search perspective.

**Fix**: Missing: (1) create `enrichment_fts` virtual table + sync triggers in a new migration, (2) add `'enrichment'` to `SearchSchema` in `src/mcp/tools/data.ts`, (3) add a branch in the `shadow_search` handler and in `src/web/routes/search.ts`, (4) merge into existing RRF scoring. The vector infrastructure is already there — it's wiring, not new architecture.

---

### Cap on resultSummaryMd in runs · [area:runner]

**Context**: `src/runner/service.ts:271` persists `resultSummaryMd` without truncating. Complex plans can reach tens of KB and runs accumulate without pruning. The full content is already written to `summary.md` in the artifact directory, making the DB field partially redundant for long outputs.

**Fix**: Truncate to a configurable max (e.g. 128KB) keeping the tail (more useful for diagnostics), with a truncation marker.

---

### Signal scoring in conversations · [area:llm]

**Context**: Weight conversations by density before the analyze prompt.

---

### Security: CSP headers + rate limiting

**Context**: Dashboard without Content-Security-Policy. No rate limiting in API/MCP.

---

### `shadow docs check` — drift detection · [area:cli]

**Context**: Compare CLAUDE.md against real code: tools count, routes, schema tables.

---

### LLM Memory Extraction post-Run · [area:runner]

**Context**: When a run completes, analyze output with an LLM to extract memories.

---

### Suggestion Expiry → Preference Memory · [area:llm]

**Context**: Expired suggestion with no response → implicit preference memory.

---

### Configurable allowedTools · [area:mcp]

**Context**: User configures which external MCPs Shadow can use. (Plan in `internal/docs/plan-allowed-tools-config.md`.)

---

### Correct button in Observations and Memories pages · [area:dashboard]

**Context**: Extend the CorrectionPanel contextually to observation cards and memory cards.
