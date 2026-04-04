# Shadow — Developer Guide

## What is Shadow

Shadow is a local-first engineering companion that runs as a background daemon, learns from your work, and interacts via Claude CLI (MCP) and a web dashboard. It's 100% LLM-based — Claude is the brain, Shadow is the persistence and observation layer.

## Architecture

```
User ← Claude CLI (MCP tools) → Shadow daemon (port 3700)
                                    ├── SQLite DB (~/.shadow/shadow.db)
                                    ├── Web dashboard (React, localhost:3700)
                                    ├── Heartbeat (every 30min)
                                    │   ├── detect active projects
                                    │   ├── analyze (LLM, creates memories)
                                    │   └── observe (LLM, new observations)
                                    ├── Daemon jobs
                                    │   ├── suggest (LLM, project-aware)
                                    │   ├── consolidate (memory maintenance, 6h)
                                    │   ├── reflect (soul reflection, daily)
                                    │   ├── remote-sync (git ls-remote, 30min)
                                    │   └── context-enrich (MCP enrichment)
                                    ├── Hooks (conversations + tool use)
                                    └── launchd service (auto-start, auto-restart)
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js 22+ (ESM) |
| Language | TypeScript 5.9+ (strict) |
| Storage | SQLite (node:sqlite DatabaseSync, WAL mode, busy_timeout=5000) |
| Search | FTS5 (full-text, BM25) + sqlite-vec (vector, cosine) — hybrid search via RRF |
| Embeddings | @huggingface/transformers, all-MiniLM-L6-v2 (384 dims, local) |
| CLI | Commander.js 14 |
| Validation | Zod 4 |
| LLM Backend | Claude CLI (`--print --output-format json`) or Agent SDK |
| MCP | JSON-RPC over stdio (52 tools) |
| Dashboard | React 19, Vite, Tailwind CSS 4, React Router 7 |
| Daemon | launchd (macOS), KeepAlive=true |

## Project Structure

```
shadow/
├── src/
│   ├── cli.ts                    # Main CLI entry (25+ commands)
│   ├── cli/output.ts             # Human-readable output formatter
│   ├── config/
│   │   ├── schema.ts             # Zod config schema (backend, models, proactivity, personality)
│   │   └── load-config.ts        # SHADOW_* env var mapping
│   ├── storage/
│   │   ├── database.ts           # ShadowDatabase class (all CRUD + FTS5 search)
│   │   ├── migrations.ts         # Schema v1-v30 (19 tables, FTS5, triggers, vec0)
│   │   ├── models.ts             # 16 record types
│   │   └── index.ts              # Re-exports
│   ├── observation/
│   │   ├── watcher.ts            # Git observation engine (4 kinds, dedup)
│   │   ├── patterns.ts           # Cross-observation pattern detection
│   │   ├── mcp-discovery.ts      # Discover user MCP servers from settings.json
│   │   └── remote-sync.ts        # Git ls-remote + selective fetch
│   ├── memory/
│   │   ├── layers.ts             # 5-layer maintenance (core/hot/warm/cool/cold)
│   │   └── retrieval.ts          # FTS5 search, context-aware memory loading
│   ├── heartbeat/
│   │   ├── state-machine.ts      # wake→cleanup→analyze→notify→idle
│   │   ├── activities.ts         # Phase implementations (LLM prompts, memory creation)
│   │   ├── schemas.ts            # Zod schemas for LLM output validation
│   │   ├── project-detection.ts  # Active project detection + momentum scoring
│   │   └── enrichment.ts         # 2-phase MCP enrichment (plan + execute)
│   ├── profile/
│   │   ├── trust.ts              # 5 trust levels, 10+ trust delta events
│   │   └── user-profile.ts       # Work hours, commit patterns, energy/mood detection
│   ├── personality/
│   │   └── loader.ts             # SOUL.md personality loader (shared)
│   ├── suggestion/
│   │   ├── engine.ts             # Accept/dismiss/snooze/expire lifecycle
│   │   └── ranking.ts            # Impact*20 + confidence*0.3 - risk*10 - daysOld
│   ├── runner/
│   │   └── service.ts            # Run executor (multi-repo ObjectivePack)
│   ├── backend/
│   │   ├── types.ts              # BackendAdapter interface, ObjectivePack
│   │   ├── claude-cli.ts         # CLI adapter (--print --output-format json)
│   │   ├── agent-sdk.ts          # Agent SDK adapter (dynamic import)
│   │   └── index.ts              # selectAdapter(config)
│   ├── daemon/
│   │   └── runtime.ts            # Dual-tick loop, launchd integration, web server
│   ├── events/
│   │   ├── queue.ts              # Proactivity-based delivery filtering
│   │   └── types.ts              # 9 event kinds with priority mapping
│   ├── mcp/
│   │   ├── server.ts             # 52 MCP tools (read + trust-gated write)
│   │   └── stdio.ts              # JSON-RPC transport
│   └── web/
│       ├── server.ts             # HTTP API server (20+ endpoints)
│       └── dashboard/            # React app (see below)
├── scripts/                      # Portable hook scripts for plugin
├── hooks/                        # Plugin hooks.json
├── .claude-plugin/               # Claude Code plugin manifest
├── docs/                         # Design documents (00-06)
├── GUIDE.md                      # User guide
└── CLAUDE.md                     # This file
```

## Dashboard (React)

```
src/web/dashboard/
├── src/
│   ├── App.tsx                   # React Router with 13 routes
│   ├── api.ts                    # Fetch wrapper for /api/* endpoints
│   ├── layouts/
│   │   ├── AppShell.tsx          # Sidebar + Topbar + content area
│   │   ├── Sidebar.tsx           # Navigation (emoji icons + labels)
│   │   └── Topbar.tsx            # Trust badge, mood, refresh timer
│   ├── components/               # Badge, Card, EmptyState, FilterTabs, MetricCard, etc.
│   └── pages/                    # Morning, Dashboard, Memories, Suggestions, Observations,
│                                 # Repos, Team, Systems, Usage, Heartbeats, Runs, Events, Profile
├── vite.config.ts                # Proxy /api to localhost:3700, output to ../../public
└── tailwind.config.ts            # Dark theme config
```

**Dev mode**: `npm run dashboard:dev` → Vite on :5173, proxies API to :3700
**Build**: `npm run dashboard:build` → outputs to `src/web/public/`
**Production**: Daemon serves built files from `src/web/public/` at :3700

### Dashboard Routes

| Route | Page | Purpose |
|-------|------|---------|
| `/morning` | Morning | Daily brief: active projects, enrichment, metrics, runs, memories, observations, suggestions |
| `/dashboard` | Dashboard | Overview metrics grid |
| `/profile` | Profile | Edit displayName, timezone, proactivity, personality, LLM models |
| `/memories` | Memories | Search + layer filter (URL-persisted) + pagination + expandable list |
| `/suggestions` | Suggestions | Filter tabs (status + kind, URL-persisted), pagination, accept/dismiss with reason, scores with tooltips, repo context, deep links |
| `/observations` | Observations | Filter by status (URL-persisted), pagination, votes, ack/resolve/reopen, enriched context, deep links |
| `/repos` | Repos | Registered repos with last observed |
| `/projects` | Projects | Clickable cards with observation/suggestion counters, drill-down to detail |
| `/projects/:id` | ProjectDetail | Header, entity chips, observations, suggestions, memories, enrichment, momentum |
| `/team` | Team | Contacts management |
| `/systems` | Systems | Clickable cards, drill-down to detail |
| `/systems/:id` | SystemDetail | Operational info, related projects, observations, memories |
| `/usage` | Usage | Token usage by period and model |
| `/jobs` | Jobs | Job history with type/status filtering, pagination |
| `/runs` | Runs | Filter tabs (to review default), execute/session/discard/manual, worktree info, markdown results |
| `/digests` | Digests | Generated digests by kind |
| `/events` | Events | Pending event queue |
| `/guide` | Guide | Modular reference: overview, concepts, CLI, MCP tools, status line, config |

## Database Schema

**19 tables** (SQLite, WAL mode, busy_timeout=5000ms for concurrency):

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `repos` | Tracked repos | name, path (unique), default_branch, test/lint/build commands, last_fetched_at |
| `projects` | Groups of repos+systems | kind (long-term/sprint/task), status, repo_ids_json, system_ids_json |
| `user_profile` | Single-row profile | trust_level (1-5), trust_score (0-100), proactivity_level (1-10), personality_level (1-5), focus_mode |
| `memories` | Layered memory | layer, scope, kind, entities_json, memory_type (episodic/semantic), FTS5+vector indexed |
| `observations` | LLM-derived facts | source_kind, kind (incl. cross_project), entities_json, repo_ids_json, votes, severity |
| `suggestions` | LLM proposals | impact/confidence/risk scores, status, entities_json, repo_ids_json |
| `jobs` | Job execution log | type, phase, status, llm_calls, tokens_used, duration_ms |
| `interactions` | User interactions | sentiment, topics, trust_delta |
| `event_queue` | Notifications | kind, priority (1-10), delivered flag |
| `runs` | Task execution | status, snapshot_ref, result_ref, diff_stat, verification_json, verified |
| `audit_events` | Append-only trail | actor, action, target_kind, target_id |
| `llm_usage` | Token tracking | source, model, input_tokens, output_tokens |
| `systems` | Infrastructure | kind (infra/service/database/queue/monitoring), url, health_check |
| `contacts` | Team members | role, team, email, slack_id, github_handle |
| `feedback` | User feedback | target_kind, target_id, action, note |
| `entity_relations` | Entity graph | source_type, source_id, relation, target_type, target_id, confidence |
| `enrichment_cache` | MCP enrichment data | source, entity_type, entity_id, summary, content_hash, reported, expires_at |
| `digests` | Generated reports | kind, period_start, period_end, content_md, model |
| `*_fts` | FTS5 virtual tables | title, body_md/detail/summary_md — auto-synced via triggers |
| `*_vectors` | vec0 virtual tables | 384-dim embeddings for memories, observations, suggestions |

## Entity Linking

All knowledge entities (memories, observations, suggestions) have an `entities_json` column:
```json
[{"type": "repo", "id": "..."}, {"type": "project", "id": "..."}, {"type": "system", "id": "..."}]
```
This enables cross-entity queries: "everything Shadow knows about project X" across all three systems.

## Semantic Dedup

New entities go through `checkDuplicate()` before creation:
- Generates embedding via `all-MiniLM-L6-v2` (local, ~4ms)
- Searches vector table for similar entries (cosine similarity)
- Decision: **skip** (>0.85), **update** existing (>0.70), or **create** new
- Thresholds calibrated per entity type. Suggestions also check against dismissed (>0.75 = blocked).

## MCP Tools (52 total)

### Read-only (25, no trust gate)
`shadow_check_in`, `shadow_status`, `shadow_repos`, `shadow_projects`, `shadow_active_projects`, `shadow_project_detail`, `shadow_observations`, `shadow_suggestions`, `shadow_memory_search`, `shadow_memory_list`, `shadow_search`, `shadow_profile`, `shadow_events`, `shadow_contacts`, `shadow_systems`, `shadow_run_list`, `shadow_run_view`, `shadow_usage`, `shadow_daily_summary`, `shadow_feedback`, `shadow_soul`, `shadow_digests`, `shadow_digest`, `shadow_enrichment_config`, `shadow_enrichment_query`

### Write (26, trust >= 1)
`shadow_repo_add`, `shadow_repo_remove`, `shadow_project_add`, `shadow_project_remove`, `shadow_project_update`, `shadow_contact_add`, `shadow_contact_remove`, `shadow_system_add`, `shadow_system_remove`, `shadow_memory_teach`, `shadow_memory_forget`, `shadow_memory_update`, `shadow_suggest_accept`, `shadow_suggest_dismiss`, `shadow_suggest_snooze`, `shadow_observation_ack`, `shadow_observation_resolve`, `shadow_observation_reopen`, `shadow_profile_set`, `shadow_focus`, `shadow_available`, `shadow_events_ack`, `shadow_soul_update`, `shadow_relation_add`, `shadow_relation_list`, `shadow_relation_remove`

### Write (1, trust >= 2)
`shadow_observe`

## Trust System

| Level | Score | Name | Capabilities |
|-------|-------|------|-------------|
| 1 | 0-15 | observer | Read + teach memories |
| 2 | 15-35 | advisor | + trigger observations |
| 3 | 35-60 | assistant | + execute small tasks, communicate |
| 4 | 60-85 | partner | + auto-fix, medium tasks |
| 5 | 85-100 | shadow | + create branches, propose PRs |

Trust grows with usage: check_in (+0.3), memory_taught (+1.0), heartbeat_completed (+0.5), suggestion_accepted (+2.0).

## Memory Layers

| Layer | Decays | Purpose |
|-------|--------|---------|
| core | Never | Permanent: infra, team, conventions |
| hot | 14 days | Current work context |
| warm | 30 days | Recent knowledge |
| cool | 90 days | Archive |
| cold | Yes | Passive archive |

All memory is **on-demand** — never auto-loaded into prompts. FTS5 search finds relevant memories by context.

## Hooks (Claude Code Integration)

| Hook | Type | Purpose |
|------|------|---------|
| SessionStart | command | Injects personality via `shadow mcp-context` |
| PostToolUse | command (async) | Logs Edit/Write/Read/Bash/Grep to interactions.jsonl |
| StatusLine | command | Shows emoji status bar: activity + trust badge + suggestions + heartbeat countdown |

## Status Line Emojis

| Emoji/State | Color | Meaning |
|-------------|-------|---------|
| `{-_-}z` | dim | Daemon not running |
| `{•‿•}` | purple | Ready (idle) |
| `{•‿•}` | cyan | Watching (few interactions) |
| `{°_°}📚` | cyan | Learning (many interactions) |
| `{•̀_•́}` | purple | Focus mode |
| `{°_°}..` | yellow | Analyzing (heartbeat) |
| `{•ᴗ•}💡` | green | Suggesting |
| `{•_•}⚙` | yellow | Consolidating |
| `{-_-}~` | blue | Reflecting (soul) |
| `{•_•}🔗` | mint/teal | Enriching (MCP context) |
| `{•_•}🔄` | pink | Syncing (git remote) |
| `📋 name` | — | Active project indicator |

Trust badges: 🔍 observer, 💬 advisor, 🤝 assistant, ⚡️ partner, 👾 shadow

## CLI Commands

```bash
# Setup
shadow init                     # Bootstrap everything (DB, hooks, launchd, SOUL.md, CLAUDE.md)

# Daily use (primary interface is Claude CLI, not these)
shadow ask "question"           # One-shot question with personality
shadow summary                  # Daily activity summary
shadow web                      # Open dashboard in browser

# Admin
shadow status / doctor / daemon start|stop|status / usage

# Data management
shadow repo add|list|remove
shadow contact add|list|remove
shadow system add|list|remove
shadow memory list|search|teach|forget
shadow suggest list|view|accept|dismiss
shadow observe / events list|ack / focus [duration] / available
shadow heartbeat                  # Trigger heartbeat immediately
shadow daemon restart             # Full restart (kills processes, frees port, relaunches)
```

## Development

```bash
# Setup
npm install
cd src/web/dashboard && npm install && cd ../../..

# Dev
npm run dev -- <command>         # Run CLI via tsx
npm run dashboard:dev            # Vite dev server (:5173, proxies API to :3700)

# Build
npm run build                    # Compiles TS + builds dashboard
npm link                         # Install `shadow` globally

# Test
npm run typecheck                # TypeScript check only (no tests yet)
```

## Config (env vars)

```bash
SHADOW_BACKEND=cli               # cli (default) | api
SHADOW_PROACTIVITY_LEVEL=5       # 1-10
SHADOW_PERSONALITY_LEVEL=4       # 1-5 (4=Tam-like)
SHADOW_MODEL_ANALYZE=sonnet      # Model for heartbeat analyze
SHADOW_MODEL_SUGGEST=opus        # Model for suggestions
SHADOW_MODEL_CONSOLIDATE=sonnet  # Model for memory consolidation
SHADOW_MODEL_RUNNER=sonnet       # Model for task execution
SHADOW_HEARTBEAT_INTERVAL_MS=900000  # 15 min
SHADOW_DATA_DIR=~/.shadow        # Data directory
```

## Key Patterns

**Adding a new MCP tool**: Add to the `tools` array in `src/mcp/server.ts`. Follow existing pattern: inputSchema + async handler. Use `trustGate(level)` for write tools.

**Adding a new CLI command**: Add to `src/cli.ts` using `program.command()`. Use `withDb()` wrapper for DB access.

**Adding a new observation kind**: Add detection function in `src/observation/watcher.ts`. Use `hasRecentObservation()` for dedup. Call `db.createObservation()`.

**Adding a dashboard page**: Create `src/web/dashboard/src/pages/NewPage.tsx`. Add route in `App.tsx`. Add nav item in `Sidebar.tsx`. Add API endpoint in `src/web/server.ts` if needed.

**Adding a new API endpoint**: Add route handler in `src/web/server.ts` `handleApi()` function.

## Data Flow

```
1. User works in Claude CLI
2. Hooks capture everything (all async, zero impact):
   - UserPromptSubmit → conversations.jsonl (what user says)
   - Stop → conversations.jsonl (what Claude responds)
   - PostToolUse → interactions.jsonl (files edited, commands run)
3. Heartbeat (every 15min):
   a. collect repo context (lightweight git status, branch, recent commits)
   b. analyze: conversations + interactions + repo context → LLM (Sonnet) → memories + observations + mood/energy
   c. suggest: memories + profile → LLM (Opus) → suggestions
   d. consolidate: promote/demote memory layers
   e. notify: queue events based on proactivity level
4. User opens Claude CLI → SessionStart hook injects personality
5. Claude calls shadow_check_in → gets personality, mood, pending events
6. Claude uses MCP tools naturally based on conversation
7. Dashboard at localhost:3700 shows everything visually
```

## Hooks (4 active)

| Hook | File | Captures |
|------|------|----------|
| SessionStart | `~/.shadow/session-start.sh` | Injects personality via `mcp-context` |
| PostToolUse | `~/.shadow/post-tool.sh` | Tool usage → `interactions.jsonl` |
| UserPromptSubmit | `~/.shadow/user-prompt.sh` | User messages → `conversations.jsonl` |
| Stop | `~/.shadow/stop.sh` | Claude responses → `conversations.jsonl` |

## Observations (LLM-generated)

Observations are NOT from git scanning. They are generated by the LLM during the heartbeat analyze phase. The LLM sees conversations + interactions + repo context and flags actionable insights.

Observation kinds: `improvement`, `risk`, `opportunity`, `pattern`, `infrastructure`

Source: `sourceKind: 'llm'` (not `'repo'`)

## Current State (as of 2026-04-04)

- **52 MCP tools** (25 read + 26 write L1 + 1 write L2) — includes projects, project-aware queries, enrichment, unified search
- **4 hooks** (SessionStart, PostToolUse, UserPromptSubmit, Stop)
- **Ghost mascot** `{•‿•}` in status line — 15 states × 3 variants, 9 ANSI colors (incl. mint/teal, pink)
- **Active project** in status line — `📋 project-name` shows daemon-detected active project
- **Job system** — typed jobs: heartbeat (30min), suggest (reactive), consolidate (6h), reflect (24h), remote-sync (30min), context-enrich (2h). Schedule visible in dashboard.
- **Observe-cleanup phase** — MCP-powered cleanup of obsolete/duplicate observations before generating new ones
- **Reflect job** — daily soul reflection with Opus. Synthesizes feedback + memories into coherent developer understanding
- **Daemon** — launchd, graceful shutdown, stale job detector (every tick, 10min threshold), graceful drain (60s)
- **Dashboard** — React at localhost:3700, sidebar badges, markdown rendering, deep linking, job schedule header with countdowns
- **Feedback loop** — unified feedback table. 👍/👎 toggle with persistence. Reason on dismiss/resolve/discard. All fed to LLM prompts.
- **Observation lifecycle** — semantic dedup, auto-expiration by severity (info=7d, warning=14d, high=never), cap per repo (max 10), retroactive consolidation via embeddings, votes, status (active/acknowledged/resolved/expired)
- **Suggestion pipeline** — semantic dedup vs pending+dismissed+accepted, accept creates Run, plan by Claude with MCP + filesystem, execute/session/discard/executed-manual/retry states
- **Runner with MCP delegation** — briefing-only prompt, Claude reads files + searches memories. `--allowedTools "mcp__shadow__*"`. Execution runs also get `Edit,Write,Bash`.
- **Trust L3 complete** — confidence gate (Sonnet high) + auto-execute if no doubts + draft PR button. Schema v21 (confidence, doubts_json) + v22 (pr_url). L4+ designed in docs/plan-trust-levels.md.
- **Project-aware analyze** — detects active projects before heartbeat, injects project context (repos, systems, observations) into extract/observe/suggest prompts. Cross-project observations auto-linked via entities_json.
- **Smart analyze** — 3 LLM calls: extract (memories + mood) + observe-cleanup (MCP resolve) + observe (new observations, incl. cross_project kind). Soul reflection injected.
- **Smart suggest** — separate job, project-aware, no operational suggestions, dedup, learns from feedback patterns
- **MCP Enrichment** — 2-phase: planning (Sonnet) → execution (Opus, `mcp__*` access to all user MCPs). Content hash dedup, 24h TTL. Configurable interval. Results fed into heartbeat context.
- **Project detection** — `detectActiveProjects()` scores projects by file interactions (×2), conversation mentions (×1), linked observations (×0.5). Top 3 with threshold ≥ 3. `computeProjectMomentum()` for 7-day trend.
- **Remote sync** — periodic `git ls-remote` detects remote changes, selective fetch. Results injected as sensor data into heartbeat.
- **CLI adapter** — async spawn, prompt via stdin (avoids ARG_MAX), effort levels per phase, stderr on failure, `activeChild` tracking for graceful SIGTERM
- **Morning page** — daily brief with active projects (MorningProjects), enrichment items (MorningEnrichment), yesterday's digest, 2-column grid, recent jobs, memories, runs, suggestions, observations.
- **Project/System detail pages** — `/projects/:id` with entity chips, counts, observations, suggestions, memories, enrichment. `/systems/:id` with operational info, related projects. Clickable cards on list pages.
- **Dashboard UX overhaul** — RunsPage: status borders + pipeline + action hierarchy + collapsible details. SuggestionsPage: expandable cards + inline dismiss + ScoreBar. ObservationsPage: severity borders + prominent actions + severity filter. DashboardPage: clickable MetricCards with href + trend arrows. MorningPage: 2-column grid + daily digest.
- **New components** — ConfidenceIndicator (3-dot ●●●/●●○/●○○), RunPipeline (plan→exec→PR), ScoreBar (impact/confidence/risk), MorningDigest. FilterTabs: optional dotColor + activeClass. MetricCard: optional href + trend.
- **Dashboard filters** — `useFilterParams` hook syncs all filters with URL search params. Server-side filtering + pagination (`offset`/`limit`) on all list endpoints. `Pagination` component on Suggestions, Observations, Memories, Runs, Jobs pages. Colored FilterTabs per status.
- **Feedback optimization** — `getThumbsState()` dedicated query with index. Feedback state inlined in suggestions/observations API responses (single request, no separate fetch).
- **Job timeout with killActiveChild** — `runJobType` has integrated timeout (8min). Kills LLM child process on timeout. `cancelled` flag prevents background promise from overwriting status. No more 50min heartbeats.
- **Auto-sync remoteUrl** — `collectRepoContext` detects `git remote get-url origin` and updates DB on every heartbeat. Enables draft PR button without manual setup.
- **Draft PR endpoint** — `POST /api/runs/:id/draft-pr`. Validates branch exists, pushes to remote, creates GitHub draft PR via `gh`. Saves `prUrl` to run.

## Backlog

All pending improvements, features, and known issues are tracked in [`BACKLOG.md`](BACKLOG.md).

### Architecture notes for new sessions
- **Heartbeat = 3 LLM calls**: extract (memories + mood, JSON-only), observe-cleanup (MCP, resolves stale obs), observe (new observations incl. cross_project, JSON-only). Active projects + enrichment context injected.
- **Suggest = separate job** triggered after heartbeat with activity. Opus + effort high. Project-aware prompts.
- **Reflect = daily job** that evolves the soul reflection. Opus + effort high. Inline context (not MCP).
- **Enrich = configurable job** (default 2h). 2-phase: plan (Sonnet) → execute (Opus, `mcp__*`). Results cached in `enrichment_cache` with content hash dedup + 24h TTL.
- **Remote sync = periodic job** (default 30min). `git ls-remote` + selective fetch. Results passed as sensor data to heartbeat.
- **Project detection** runs before each heartbeat. `detectActiveProjects()` uses 3 signals: file paths→repos→projects (×2), conversation mentions (×1), linked observations (×0.5). Top 3 with threshold ≥ 3. Persisted in `daemon.json`.
- **Runner = MCP delegation** — briefing-only prompt, Claude reads files + uses shadow_* MCP tools himself.
- **Prompt via stdin** — all LLM calls pass prompt via stdin pipe, not CLI args (avoids ARG_MAX).
- **`--allowedTools "mcp__shadow__*"`** on all CLI spawns — Claude can use Shadow's own tools without permission. Execution runs also get `Edit,Write,Bash` for code changes.
- **Confidence evaluation** — L3 runner evaluates plan with Sonnet (effort high) before auto-executing. JSON response: `{ confidence: 'high'|'medium'|'low', doubts: string[] }`. Safe fallback to low confidence on any failure.
- **Job timeout** — integrated in `runJobType` with `killActiveChild()`. `cancelled` flag prevents background promise from overwriting job status. Max 8min per job. Eliminated all external `Promise.race` wrappers.
- **Soul reflection** injected into extract/observe prompts. Runner mentions it in briefing.
- **Feedback** from dismiss/resolve/thumbs fed into extract + observe + suggest prompts.
- **Models + effort configurable per phase** from dashboard /profile. `getModel(ctx, phase)` + `getEffort(ctx, phase)`.
- **Rotation**: conversations.jsonl and interactions.jsonl rotated (keep last 2h) after each analyze.
- **Semantic dedup**: all three knowledge systems (memories, observations, suggestions) use embeddings-based dedup via `checkDuplicate()`. Thresholds: skip >= 0.85, update >= 0.70 (calibrated per type). Suggestions also check against dismissed (>= 0.75 = blocked).
- **Hybrid search**: `shadow_search` MCP tool combines FTS5 BM25 + vector cosine via Reciprocal Rank Fusion (k=60). Searches across all three systems.
- **Projects**: first-class entity grouping repos + systems + contacts. Long-term, sprint, or task. CLI + MCP + dashboard.
- **Entity linking**: `entities_json` column on memories/observations/suggestions. Format: `[{type, id}]`. Enables cross-entity queries.
- **Embeddings**: `all-MiniLM-L6-v2` via `@huggingface/transformers` + `sqlite-vec`. Lazy init, ~4ms/embedding. Backfill on daemon startup.
- **Prompt tuning**: extract 0-2 insights (not 1-3), observe up to 3 (not 5), expanded BAD lists, core requires 6mo stability, kind rebalancing.
- **Core capacity**: max 30, protected kinds (soul_reflection, taught, knowledge_summary). Eviction by lowest relevanceScore*accessCount.
- **Access count honesty**: heartbeat internal lookups use `touch=false`, only MCP searches increment access counts.
- **Stale job detector** runs every daemon tick (10min threshold). Graceful drain on shutdown (60s). On startup, `cleanOrphanedJobsOnStartup()` fails ALL running jobs/runs immediately (no age threshold).
- **Child process cleanup** — `killActiveChild()` sends SIGTERM to spawned `claude` process on shutdown. `pkill` in daemon stop/restart kills orphaned claude processes matching `--allowedTools.*mcp__shadow`.
- **Pagination** — DB `count*` methods for all entities. API returns `{ items, total }`. Migration v12 (feedback thumbs index) + v13 (suggestions kind, observations status, jobs type indexes).
- **Draft PR** — endpoint validates branch exists → `git push` → `gh pr create --draft`. Schema v22 (pr_url). Button disabled without GitHub remote.
- **Severity filter** — ObservationsPage supports server-side severity filtering (high/warning/info). DB `listObservations` + `countObservations` accept `severity` param.
- **MCP discovery** — `discoverMcpServerNames()` reads `~/.claude/settings.json` → mcpServers keys, excludes 'shadow'. Used by enrichment planner.
- **Enrichment cache** — migration v30. `upsertEnrichment` deduplicates by content_hash. `expireStaleEnrichment` removes expired entries. `buildEnrichmentContext()` marks items as reported after injecting into heartbeat.
- **Project-aware MCP tools** — `shadow_observations` and `shadow_suggestions` accept `projectId` filter (entity link match). `shadow_active_projects` returns detected active projects with momentum. `shadow_project_detail` returns rich project view with counts.
- **Status line active project** — `shadow status --json` includes `activeProject` (top project from daemon detection). Statusline shows `📋 project-name`.
- **Ghost mascot new states** — `enriching` (mint/teal, `\033[38;5;48m`) and `syncing` (pink, `\033[38;5;219m`) for enrich/remote-sync daemon phases.
