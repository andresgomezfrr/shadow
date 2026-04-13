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
                                    │   ├── summarize (Opus, text-free → session summary)
                                    │   ├── extract (Opus, JSON → memories + mood)
                                    │   ├── cleanup (Sonnet, MCP → resolve stale obs)
                                    │   └── observe (Opus, JSON → new observations)
                                    ├── Daemon jobs
                                    │   ├── suggest (LLM, project-aware)
                                    │   ├── consolidate (memory maintenance, 6h)
                                    │   ├── reflect (soul reflection, daily)
                                    │   ├── remote-sync (git ls-remote, 30min)
                                    │   └── context-enrich (MCP enrichment)
                                    ├── Hooks (6: sessions + tool use + errors + subagents)
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
| MCP | JSON-RPC over stdio (66 tools) |
| Dashboard | React 19, Vite, Tailwind CSS 4, React Router 7 |
| Daemon | launchd (macOS), KeepAlive=true |

## Project Structure

```
shadow/
├── src/
│   ├── cli.ts                    # CLI dispatcher (~56 lines, registers command modules)
│   ├── cli/
│   │   ├── output.ts             # Human-readable output formatter
│   │   ├── types.ts              # Shared WithDb type
│   │   ├── cmd-init.ts           # init command (hooks, SOUL.md, launchd)
│   │   ├── cmd-entities.ts       # repo, contact, project, system CRUD
│   │   ├── cmd-knowledge.ts      # memory, suggest, digest, observe
│   │   ├── cmd-daemon.ts         # daemon start/stop/restart/status, heartbeat, reflect
│   │   ├── cmd-profile.ts        # status, doctor, profile, focus, available
│   │   └── cmd-misc.ts           # events, run, usage, summary, web, mcp, ask, teach
│   ├── run-heartbeat.ts          # Standalone heartbeat runner
│   ├── config/
│   │   ├── schema.ts             # Zod config schema (backend, models, proactivity, personality)
│   │   └── load-config.ts        # SHADOW_* env var mapping
│   ├── storage/
│   │   ├── database.ts           # ShadowDatabase façade (~372 lines, delegates to stores)
│   │   ├── mappers.ts            # 19 row mappers + utility helpers (r, str, num, jsonParse, toSnake)
│   │   ├── stores/
│   │   │   ├── entities.ts       # repos, systems, projects, contacts (29 methods)
│   │   │   ├── knowledge.ts      # memories, observations, suggestions, embeddings (28 methods)
│   │   │   ├── execution.ts      # runs, tasks, jobs
│   │   │   ├── tracking.ts       # interactions, events, feedback, audit, llm-usage (19 methods)
│   │   │   ├── profile.ts        # user profile (3 methods)
│   │   │   ├── enrichment.ts     # enrichment cache, digests (12 methods)
│   │   │   └── relations.ts      # entity relations (6 methods)
│   │   ├── migrations.ts         # Schema v1-v46 (20 tables, FTS5, triggers, vec0)
│   │   ├── models.ts             # Record types for all tables
│   │   └── index.ts              # Re-exports
│   ├── observation/
│   │   ├── watcher.ts            # Lightweight git context collector (branch, status, commits)
│   │   ├── repo-watcher.ts       # FS watcher: file change detection, debounce, git events
│   │   ├── repo-profile.ts       # Per-repo LLM profile generation
│   │   ├── consolidation.ts      # Merge semantically similar observations via embeddings
│   │   ├── mcp-discovery.ts      # Discover user MCP servers from settings.json
│   │   └── remote-sync.ts        # Git ls-remote + selective fetch
│   ├── memory/
│   │   ├── layers.ts             # 5-layer maintenance (core/hot/warm/cool/cold)
│   │   ├── retrieval.ts          # FTS5 search, context-aware memory loading, corrections
│   │   ├── search.ts             # Hybrid search: FTS5 BM25 + vector cosine via RRF
│   │   ├── dedup.ts              # Semantic dedup thresholds for memories/observations/suggestions
│   │   ├── embeddings.ts         # all-MiniLM-L6-v2 embedding generation + cosine similarity
│   │   ├── lifecycle.ts          # Embedding generation + backfill for all entity types
│   │   └── index.ts              # Re-exports
│   ├── analysis/                  # (renamed from heartbeat/)
│   │   ├── state-machine.ts      # wake→cleanup→analyze→notify→idle
│   │   ├── activities.ts         # Barrel re-exports (5 lines)
│   │   ├── shared.ts             # Entity linking, data loaders, log rotation, getModel/getEffort
│   │   ├── extract.ts            # activityAnalyze — 3 LLM calls (extract + cleanup + observe)
│   │   ├── suggest.ts            # activitySuggest — 2 LLM calls (generate + validate)
│   │   ├── consolidate.ts        # activityConsolidate — layer maintenance + meta-patterns
│   │   ├── notify.ts             # activityNotify — event queue
│   │   ├── reflect.ts            # activityReflect — 2 LLM calls (deltas + soul)
│   │   ├── schemas.ts            # Zod schemas for LLM output validation
│   │   ├── digests.ts            # Daily/weekly/brag digest generation
│   │   ├── project-detection.ts  # Active project detection + momentum scoring
│   │   └── enrichment.ts         # 2-phase MCP enrichment (plan + execute)
│   ├── profile/
│   │   ├── bond.ts              # 5-axis bond model + 8 tiers + applyBondDelta + resetBondState
│   │   ├── unlockables.ts       # evaluateUnlocks engine — marks unlocked + emits events on tier rise
│   │   └── user-profile.ts       # Work hours, commit patterns, energy/mood detection
│   ├── personality/
│   │   └── loader.ts             # SOUL.md personality loader (shared)
│   ├── suggestion/
│   │   ├── engine.ts             # Accept (execute/manual/plan)/dismiss/snooze/expire lifecycle
│   │   └── ranking.ts            # Impact*20 + confidence*0.3 - risk*10 - daysOld
│   ├── runner/
│   │   ├── service.ts            # Run executor (multi-repo ObjectivePack, worktrees)
│   │   ├── queue.ts              # RunQueue: concurrent run processing
│   │   ├── state-machine.ts      # Run status transitions + parent aggregation
│   │   └── schemas.ts            # Zod schemas for confidence evaluation
│   ├── backend/
│   │   ├── types.ts              # BackendAdapter interface, ObjectivePack
│   │   ├── claude-cli.ts         # CLI adapter (--print, stdin prompt, per-job tracking)
│   │   ├── agent-sdk.ts          # Agent SDK adapter (dynamic import)
│   │   ├── json-repair.ts        # Truncated JSON repair + Zod safe parse
│   │   └── index.ts              # selectAdapter(config)
│   ├── daemon/
│   │   ├── runtime.ts            # Main loop, launchd, web server, repo watcher
│   │   ├── job-queue.ts          # JobQueue: concurrent job execution with timeout
│   │   ├── job-handlers.ts       # 13 job type handlers (heartbeat, suggest, reflect, etc.)
│   │   ├── schedules.ts          # Clock-time job scheduling (timezone-aware)
│   │   └── thought.ts            # Status line thought generation (decorative LLM)
│   ├── events/
│   │   ├── queue.ts              # Proactivity-based delivery filtering
│   │   └── types.ts              # 9 event kinds with priority mapping
│   ├── mcp/
│   │   ├── server.ts             # Tool assembly + JSON-RPC handler
│   │   ├── stdio.ts              # JSON-RPC transport
│   │   └── tools/
│   │       ├── types.ts          # McpTool type + ToolContext
│   │       ├── status.ts         # check_in, status, available, alerts
│   │       ├── memory.ts         # memory_search/teach/forget/update/list, correct
│   │       ├── observations.ts   # observations, observe, ack/resolve/reopen
│   │       ├── suggestions.ts    # suggestions, accept/dismiss/snooze
│   │       ├── entities.ts       # repos/projects/systems/contacts CRUD, relations
│   │       ├── profile.ts        # profile, profile_set, focus, feedback, soul
│   │       ├── data.ts           # events, search, runs, usage, digests, enrichment
│   │       └── tasks.ts          # tasks, task_create/update/close/remove
│   └── web/
│       ├── server.ts             # HTTP server dispatcher, static files, SSE, MCP (~203 lines)
│       ├── helpers.ts            # json, readBody, parseBody, Zod schemas, pagination
│       ├── routes/
│       │   ├── suggestions.ts    # list, bulk, accept/dismiss/snooze
│       │   ├── observations.ts   # list, ack/resolve/reopen
│       │   ├── runs.ts           # list, archive/verify/rollback/retry/execute/session/dismiss/draft-pr
│       │   ├── activity.ts       # timeline, summary, daily-summary
│       │   ├── jobs.ts           # list, heartbeats, triggers
│       │   ├── entities.ts       # projects, systems, contacts, repos, entity-graph
│       │   ├── knowledge.ts      # memories, digests, enrichment, soul, corrections
│       │   └── profile.ts        # status, config, usage, events, feedback, profile, focus
│       ├── event-bus.ts          # SSE event bus for real-time dashboard updates
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
│   ├── App.tsx                   # React Router with 16 routes + redirects
│   ├── main.tsx                  # Entry point
│   ├── api/
│   │   ├── client.ts             # Typed fetch wrappers for all /api/* endpoints
│   │   └── types.ts              # Entity types re-exported from backend models
│   ├── hooks/                    # useApi, useFilterParams, useSSERefresh, useEventStream, useHighlight
│   ├── utils/format.ts           # Date/number formatting helpers
│   ├── components/
│   │   ├── layout/
│   │   │   ├── AppShell.tsx      # Sidebar + Topbar + content area
│   │   │   ├── Sidebar.tsx       # Navigation (emoji icons + labels, grouped sections)
│   │   │   └── Topbar.tsx        # Bond tier badge, mood, refresh timer
│   │   ├── common/               # Badge, Card, EmptyState, FilterTabs, MetricCard, Pagination,
│   │   │                         # Markdown, ScoreBar, RunPipeline, ConfidenceIndicator, Toggle,
│   │   │                         # ThumbsFeedback, CorrectionPanel, SearchInput, SettingsField
│   │   ├── activity/             # LiveStatusBar, ScheduleRibbon, ActivityEntry, JobOutputSummary
│   │   └── pages/
│   │       ├── MorningPage.tsx   # + morning/ subcomponents (Projects, Repos, Metrics, etc.)
│   │       ├── ProfilePage.tsx   # + settings/ subcomponents (Identity, Models, Soul, etc.)
│   │       ├── GuidePage.tsx     # + guide/ subcomponents (Overview, Concepts, Jobs, etc.)
│   │       ├── ActivityPage.tsx  # Unified jobs+runs timeline with SSE
│   │       ├── WorkspacePage.tsx # Runs + tasks with execute/session/dismiss/PR actions
│   │       └── ...               # Memories, Suggestions, Observations, Repos, Projects,
│   │                             # Systems, Team, Digests, Events, Usage, Jobs (legacy)
│   └── ...
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
| `/profile` | Profile | Settings sections: identity, behavior, models, soul, thoughts, enrichment, autonomy, system config |
| `/chronicle` | Chronicle | Bond system page: tier badge + lore, 5-axis radar, 8-tier path (silhouettes for unreached), next-step hint, timeline of crossings + milestones, unlocks grid |
| `/memories` | Memories | Search + layer filter (URL-persisted) + pagination + expandable list |
| `/suggestions` | Suggestions | Filter tabs (status + kind), pagination, accept/dismiss with reason, scores, bulk actions |
| `/observations` | Observations | Filter by status/severity, pagination, votes, ack/resolve/reopen, deep links |
| `/repos` | Repos | Repo profile cards with correction panel |
| `/projects` | Projects | Clickable cards with counters, drill-down to detail |
| `/projects/:id` | ProjectDetail | Entity chips, observations, suggestions, memories, enrichment, context |
| `/team` | Team | Contacts management |
| `/systems` | Systems | Clickable cards, drill-down to detail |
| `/systems/:id` | SystemDetail | Operational info, related projects, observations, memories |
| `/workspace` | Workspace | Tasks + runs: execute/session/dismiss/PR, worktree info, pipeline visualization |
| `/activity` | Activity | Unified jobs+runs timeline, SSE live status, schedule ribbon |
| `/usage` | Usage | Token usage by period and model |
| `/digests` | Digests | Daily/weekly/brag with navigation, regenerate |
| `/events` | Events | Pending event queue |
| `/guide` | Guide | Tabbed reference: overview, concepts, CLI, MCP tools, jobs, status line, config |

## Database Schema

**20 tables + virtual tables** (SQLite, WAL mode, busy_timeout=5000ms for concurrency):

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `repos` | Tracked repos | name, path (unique), default_branch, test/lint/build commands, last_fetched_at |
| `projects` | Groups of repos+systems | kind (long-term/sprint/task), status, repo_ids_json, system_ids_json |
| `user_profile` | Single-row profile | bond_axes_json, bond_tier (1-8), bond_reset_at, bond_tier_last_rise_at, proactivity_level (1-10), focus_mode. Legacy trust_level/trust_score/bond_level columns kept but unused (v50 cleanup) |
| `chronicle_entries` | Immutable narrative (v49) | kind ('tier_lore'\|'milestone'), tier (UNIQUE per tier_lore), milestone_key (UNIQUE per milestone), body_md, model |
| `unlockables` | Tier-gated content slots (v49) | tier_required, kind, title, description, payload_json, unlocked, unlocked_at |
| `bond_daily_cache` | 24h TTL cache (v49) | cache_key ('voice_of_shadow'\|'next_step_hint'), body_md, model, expires_at |
| `memories` | Layered memory | layer, scope, kind, entities_json, memory_type (episodic/semantic), FTS5+vector indexed |
| `observations` | LLM-derived facts | source_kind, kind (incl. cross_project), entities_json, repo_ids_json, votes, severity |
| `suggestions` | LLM proposals | impact/confidence/risk scores, status, entities_json, repo_ids_json |
| `jobs` | Job execution log | type, phase, status, llm_calls, tokens_used, duration_ms |
| `interactions` | User interactions | sentiment, topics, trust_delta |
| `event_queue` | Notifications | kind, priority (1-10), delivered flag |
| `tasks` | Work containers | title, status (open/active/blocked/done), suggestion_id, project_id, repo_ids_json, external_refs_json, session_id, archived |
| `runs` | Task execution | status, task_id, outcome, snapshot_ref, result_ref, diff_stat, verification_json, verified |
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

Tasks and runs also participate in entity linking:
- Tasks can have a `suggestion_id` (created when accepting a suggestion with category "plan")
- Runs can have a `task_id` (created when executing a task via `shadow_task_execute` or workspace actions)
- The lifecycle chain flows: Suggestion → (accept "plan") → Task → (execute) → Run

## Semantic Dedup

New entities go through `checkDuplicate()` before creation:
- Generates embedding via `all-MiniLM-L6-v2` (local, ~4ms)
- Searches vector table for similar entries (cosine similarity)
- Decision: **skip** (>0.85), **update** existing (>0.70), or **create** new
- Thresholds calibrated per entity type. Suggestions also check against dismissed (>0.75 = blocked).
- Observations use multi-pass dedup: check active → resolved (done) → expired. Resolved observations with deliberate feedback are protected (votes++ only); auto-capped/expired observations are reopened.

## MCP Tools (66 total)

Tools split across `src/mcp/tools/`: status.ts, memory.ts, observations.ts, suggestions.ts, entities.ts, profile.ts, data.ts, tasks.ts (8 modules).

### Read-only (27)
`shadow_check_in`, `shadow_status`, `shadow_alerts`, `shadow_repos`, `shadow_projects`, `shadow_active_projects`, `shadow_project_detail`, `shadow_observations`, `shadow_suggestions`, `shadow_memory_search`, `shadow_memory_list`, `shadow_search`, `shadow_profile`, `shadow_events`, `shadow_contacts`, `shadow_systems`, `shadow_run_list`, `shadow_run_view`, `shadow_usage`, `shadow_daily_summary`, `shadow_feedback`, `shadow_soul`, `shadow_digests`, `shadow_enrichment_config`, `shadow_enrichment_query`, `shadow_relation_list`, `shadow_tasks`

### Write (40)
`shadow_repo_add`, `shadow_repo_update`, `shadow_repo_remove`, `shadow_project_add`, `shadow_project_remove`, `shadow_project_update`, `shadow_contact_add`, `shadow_contact_update`, `shadow_contact_remove`, `shadow_system_add`, `shadow_system_remove`, `shadow_memory_teach`, `shadow_memory_forget`, `shadow_memory_update`, `shadow_correct`, `shadow_suggest_accept`, `shadow_suggest_dismiss`, `shadow_suggest_snooze`, `shadow_observation_ack`, `shadow_observation_resolve`, `shadow_observation_reopen`, `shadow_observe`, `shadow_profile_set`, `shadow_focus`, `shadow_available`, `shadow_events_ack`, `shadow_soul_update`, `shadow_relation_add`, `shadow_relation_remove`, `shadow_alert_ack`, `shadow_alert_resolve`, `shadow_run_archive`, `shadow_run_create`, `shadow_digest`, `shadow_enrichment_write`, `shadow_task_create`, `shadow_task_update`, `shadow_task_close`, `shadow_task_archive`, `shadow_task_remove`, `shadow_task_execute`

## Bond System (v49)

The bond system replaced the single-score trust model in v49. It tracks the relationship between Andrés and Shadow across **5 axes** and **8 tiers**, dual-gated by time + quality, monotonic (never decreases). **Narrative only** — no capability gating. All MCP tools are available regardless of bond tier.

### 5 axes (all 0-100)

| Axis | Source | Curve |
|------|--------|-------|
| **time** | `now - bond_reset_at` | sqrt over 1 year |
| **depth** | memories kind∈{taught, correction, knowledge_summary, soul_reflection} since reset | saturating 1−e^(−n/60) |
| **momentum** | feedback('accept','dismiss') + runs('done') + observations('done','acknowledged') last 28 days | saturating 1−e^(−n/18) |
| **alignment** | 60% accept/dismiss rate + 30% corrections + 10% soul reflections | weighted |
| **autonomy** | runs with parent_run_id AND status='done' AND outcome∈{executed, executed_manual} | saturating 1−e^(−n/10) |

`time` is a gate-only axis — it does not count toward the quality floor average.

### 8 tiers (dual-gated: min days + quality floor on 4 dynamic axes)

| Tier | Name | Min days | Quality floor |
|------|------|----------|---------------|
| 1 | observer | 0 | 0 |
| 2 | echo | 3 | 15 |
| 3 | whisper | 7 | 28 |
| 4 | shade | 14 | 40 |
| 5 | shadow | 30 | 52 |
| 6 | wraith | 60 | 64 |
| 7 | herald | 120 | 76 |
| 8 | kindred | 240 | 86 |

`applyBondDelta(db, eventKind)` is sync: recomputes all 5 axes from DB, persists, evaluates tier. On tier rise it fires three fire-and-forget hooks: `triggerChronicleLore` (Opus, immutable tier lore), event_queue entry `bond_tier_rise`, and `evaluateUnlocks` (marks eligible unlockables + emits `unlock` events). Event kind is informational only — axes are data-driven.

`resetBondState(db)` wipes bond state transactionally (axes to 0, tier to 1, chronicle_entries/bond_daily_cache cleared, unlockables relocked) but preserves memories, suggestions, observations, runs, interactions, audit events, and soul. Triggered automatically on first daemon boot via `~/.shadow/bond-reset.v49.done` sentinel; also available as `shadow profile bond-reset --confirm`.

### Chronicle

A new `/chronicle` page (sidebar 🌒) visualizes the bond: radar chart of 5 axes, 8-tier path (future tiers are silhouettes until reached), next-step requirements, immutable timeline of tier crossings + milestones, and an unlocks grid (8 placeholder slots seeded in v49, editable later). Four LLM calls drive the narrative:

- **Tier-cross lore** (Opus, immutable, `chronicle_entries.kind='tier_lore'`) — one per tier crossed, 2-3 sentences authored by Shadow's voice
- **Milestone commentary** (Opus, immutable, `chronicle_entries.kind='milestone'`) — memories:100/200/…, first_correction, first_auto_execute
- **Voice of Shadow** (Haiku, 24h cache in `bond_daily_cache`) — one-line ambient phrase, shown in Chronicle header + Morning page
- **Next-step hint** (Haiku, 24h cache) — personalized behavior suggestion for the next tier

Config: `models.chronicleLore` (default `opus`), `models.chronicleDaily` (default `haiku`), env vars `SHADOW_MODEL_CHRONICLE_LORE` / `SHADOW_MODEL_CHRONICLE_DAILY`.

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
| PostToolUse | command (async) | Logs tool usage with rich detail (jq pipeline) to interactions.jsonl |
| UserPromptSubmit | command (async) | User messages (full text) → conversations.jsonl |
| Stop | command (async) | Claude responses (full text) → conversations.jsonl |
| StopFailure | command (async) | API errors → events.jsonl |
| SubagentStart | command (async) | Subagent spawns → events.jsonl |
| StatusLine | command | Shows emoji status bar: activity + bond tier badge + suggestions + heartbeat countdown |

All capture hooks check `$SHADOW_JOB` env var and exit early for daemon LLM calls (prevents self-traffic contamination).

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

Bond badges (8 tiers): 🔍 observer, 💭 echo, 🤫 whisper, 🌫 shade, 👾 shadow, 👻 wraith, 📯 herald, 🌌 kindred

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
shadow job <type>                  # Trigger any daemon job (heartbeat, suggest, reflect, etc.)
shadow job list                   # List all available job types
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
SHADOW_MODEL_RUNNER=opus         # Model for task execution
SHADOW_HEARTBEAT_INTERVAL_MS=900000  # 15 min
SHADOW_DATA_DIR=~/.shadow        # Data directory
```

## Key Patterns

**Adding a new MCP tool**: Add to the appropriate file in `src/mcp/tools/`. Follow existing pattern: inputSchema + async handler. Trust gates removed — all tools available regardless of bond tier. Register in `src/mcp/server.ts` tool assembly.

**Adding a new CLI command**: Create or extend the appropriate `src/cli/cmd-*.ts` module. Export a register function, call it from `src/cli.ts`. Use `withDb()` wrapper for DB access.

**Adding a new DB method**: Add to the appropriate store in `src/storage/stores/`. Add delegation one-liner in `src/storage/database.ts`. Add mapper in `mappers.ts` if needed.

**Adding a new API endpoint**: Add route handler in the appropriate `src/web/routes/*.ts` module. Import helpers from `src/web/helpers.ts`.

**Adding a dashboard page**: Create component in `src/web/dashboard/src/components/pages/`. Add route in `App.tsx`. Add nav item in `Sidebar.tsx`.

## Data Flow

```
1. User works in Claude CLI
2. Hooks capture everything (all async, zero impact):
   - UserPromptSubmit → conversations.jsonl (full text, no cap)
   - Stop → conversations.jsonl (full text, no cap)
   - PostToolUse → interactions.jsonl (rich detail per tool via jq)
   - StopFailure → events.jsonl (API errors)
   - SubagentStart → events.jsonl (subagent spawns)
   - All hooks skip daemon LLM calls (SHADOW_JOB=1 env filter)
3. Heartbeat (every 30min):
   a. consume-and-delete: rename JSONL files → .rotating (claim batch)
   b. collect repo context (lightweight git status, branch, recent commits)
   c. summarize: all raw data → Opus (text-free) → session summary (~1-3KB)
   d. extract: summary + soul + memories → Opus (JSON) → insights + mood
   e. cleanup: open observations → Sonnet (MCP) → resolve stale obs
   f. observe: summary + feedback → Opus (JSON) → new observations
   g. delete .rotating files
   h. suggest (separate job): memories + profile → LLM (Opus) → suggestions
   i. notify: queue events based on proactivity level
4. User opens Claude CLI → SessionStart hook injects personality
5. Claude calls shadow_check_in → gets personality, mood, pending events
6. Claude uses MCP tools naturally based on conversation
7. Dashboard at localhost:3700 shows everything visually
```

## Hooks (6 active)

| Hook | File | Captures |
|------|------|----------|
| SessionStart | `~/.shadow/session-start.sh` | Injects personality via `mcp-context` |
| PostToolUse | `~/.shadow/post-tool.sh` | Tool usage with rich per-tool detail (jq) → `interactions.jsonl` |
| UserPromptSubmit | `~/.shadow/user-prompt.sh` | User messages (full text, no cap) → `conversations.jsonl` |
| Stop | `~/.shadow/stop.sh` | Claude responses (full text, no cap) → `conversations.jsonl` |
| StopFailure | `~/.shadow/stop-failure.sh` | API errors (rate_limit, overloaded) → `events.jsonl` |
| SubagentStart | `~/.shadow/subagent-start.sh` | Subagent spawns → `events.jsonl` |

All capture hooks filter daemon self-traffic via `SHADOW_JOB=1` env var.

## Observations (LLM-generated)

Observations are NOT from git scanning. They are generated by the LLM during the heartbeat analyze phase. The LLM sees conversations + interactions + repo context and flags actionable insights.

Observation kinds: `improvement`, `risk`, `opportunity`, `pattern`, `infrastructure`

Source: `sourceKind: 'llm'` (not `'repo'`)

## Current State (as of 2026-04-11)

- **67 MCP tools** (27 read + 40 write, no bond gating) — split across `src/mcp/tools/` (8 modules)
- **6 hooks** (SessionStart, PostToolUse, UserPromptSubmit, Stop, StopFailure, SubagentStart) — SHADOW_JOB env filter prevents daemon self-traffic
- **15 job types** — heartbeat, suggest, suggest-deep, suggest-project, consolidate, reflect, remote-sync, context-enrich, repo-profile, project-profile, digest-daily, digest-weekly, digest-brag, auto-plan, auto-execute. Parallel execution via JobQueue (maxConcurrentJobs=3 LLM + IO unlimited). Per-job timeout support (default 15min, auto-plan 30min, auto-execute 60min).
- **Ghost mascot** `{•‿•}` in status line — 15 states × 3 variants, 9 ANSI colors. Thoughts system generates LLM status line phrases.
- **Daemon** — launchd, JobQueue with per-job timeout (default 15min), per-job adapter tracking via AsyncLocalStorage, stale job detector, graceful drain (60s), repo watcher (FS events + debounce).
- **Dashboard** — React at localhost:3700. Activity page (unified timeline + SSE), Workspace (tasks + runs), Morning brief, Profile (settings sections), Guide (tabbed reference). Sidebar grouped by intention.
- **Corrections system** — `kind: 'correction'` memories, consumed by consolidate. `shadow_correct` MCP tool + CorrectionPanel in dashboard.
- **Suggest v3** — 3 specialized jobs: `suggest` (incremental, reactive), `suggest-deep` (full codebase review), `suggest-project` (cross-repo analysis).
- **Runner** — worktree isolation for execution runs, confidence evaluation (Opus), draft PR via `gh`, auto-cleanup on completion.
- **Autonomy** — two-job autonomous execution: `auto-plan` (3h, revalidates open suggestions, auto-dismisses stale, creates plan runs) + `auto-execute` (3h offset 1.5h, executes planned runs with high confidence + 0 doubts). Configurable rules (plan rules + execute rules) stored in `preferences_json.autonomy`. Per-repo opt-in, OFF by default. Settings UI section in dashboard Profile page.
- **API validation** — Zod schemas on POST endpoints, `clampLimit`/`clampOffset` on all pagination, SSE event bus for real-time updates.
- **JSONL rotation** — atomic rename-then-append pattern to prevent data loss from concurrent hook writes.

## Backlog

All pending improvements, features, and known issues are tracked in [`BACKLOG.md`](BACKLOG.md).

### Architecture notes for new sessions
- **Heartbeat = 4 LLM calls**: summarize (Opus, text-free → session summary), extract (Opus, JSON → memories + mood), cleanup (Sonnet, MCP → resolve open obs), observe (Opus, JSON → new observations). Active projects + enrichment context injected. The summarize phase reads all raw data (conversations + interactions); extract/observe receive only the summary (~1-3KB).
- **Suggest = separate job** triggered after heartbeat with activity. Opus + effort high. Project-aware prompts.
- **Reflect = 2-phase daily job**: Phase 1 (Sonnet) extracts deltas since last reflect. Phase 2 (Opus) evolves soul with focused change report (not full context dump). 5 sections: Developer profile, Decision patterns, Blind spots, What to watch for, Communication preferences. Soul snapshots saved before each update.
- **Enrich = configurable job** (default 2h). 2-phase: plan (Sonnet) → execute (Opus, `mcp__*`). Results cached in `enrichment_cache` with content hash dedup + 24h TTL.
- **Remote sync = periodic job** (default 30min). `git ls-remote` + selective fetch. Results passed as sensor data to heartbeat.
- **Project detection** runs before each heartbeat. `detectActiveProjects()` uses 3 signals: file paths→repos→projects (×2), conversation mentions (×1), linked observations (×0.5). Top 3 with threshold ≥ 3. Persisted in `daemon.json`.
- **Runner = MCP delegation** — briefing-only prompt, Claude reads files + uses shadow_* MCP tools himself.
- **Prompt via stdin** — all LLM calls pass prompt via stdin pipe, not CLI args (avoids ARG_MAX).
- **`--allowedTools "mcp__shadow__*"`** on all CLI spawns — Claude can use Shadow's own tools without permission. Execution runs also get `Edit,Write,Bash` for code changes.
- **Confidence evaluation** — L3 runner evaluates plan with Sonnet (effort high) before auto-executing. JSON response: `{ confidence: 'high'|'medium'|'low', doubts: string[] }`. Safe fallback to low confidence on any failure.
- **Job timeout** — integrated in `JobQueue` with `killJobAdapters(jobId)`. Per-job adapter tracking via `AsyncLocalStorage`. `cancelled` flag prevents background promise from overwriting job status. Max 15min per job.
- **Soul reflection** injected into extract/observe prompts. Runner mentions it in briefing.
- **Feedback** from dismiss/resolve/thumbs fed into extract + observe + suggest prompts.
- **Models + effort configurable per phase** from dashboard /profile. `getModel(ctx, phase)` + `getEffort(ctx, phase)`.
- **Rotation**: consume-and-delete model. At heartbeat START, JSONL files are renamed to `.rotating` (atomic). Each heartbeat processes exactly the data since the last one (zero overlap). Orphaned `.rotating` from crashed heartbeats are detected and consumed in the next run. No 2h filter — the rename is the batch boundary.
- **Semantic dedup**: all three knowledge systems (memories, observations, suggestions) use embeddings-based dedup via `checkDuplicate()`. Thresholds: skip >= 0.85, update >= 0.70 (calibrated per type). Suggestions also check against dismissed (>= 0.75 = blocked).
- **Hybrid search**: `shadow_search` MCP tool combines FTS5 BM25 + vector cosine via Reciprocal Rank Fusion (k=60). Searches across all three systems.
- **Projects**: first-class entity grouping repos + systems + contacts. Long-term, sprint, or task. CLI + MCP + dashboard.
- **Entity linking**: `entities_json` column on memories/observations/suggestions. Format: `[{type, id}]`. Enables cross-entity queries.
- **Embeddings**: `all-MiniLM-L6-v2` via `@huggingface/transformers` + `sqlite-vec`. Lazy init, ~4ms/embedding. Backfill on daemon startup.
- **Prompt tuning**: extract 0-2 insights (not 1-3), observe up to 3 (not 5), expanded BAD lists, core requires 6mo stability, kind rebalancing.
- **Core capacity**: max 30, protected kinds (soul_reflection, taught, knowledge_summary). Eviction by lowest relevanceScore*accessCount.
- **Access count honesty**: heartbeat internal lookups use `touch=false`, only MCP searches increment access counts.
- **Stale job detector** runs every daemon tick (10min threshold). Graceful drain on shutdown (60s). On startup, `cleanOrphanedJobsOnStartup()` fails ALL running jobs/runs immediately (no age threshold).
- **Child process cleanup** — `killJobAdapters(jobId)` sends SIGTERM to spawned `claude` processes per job. `killAllActiveChildren()` on shutdown. `pkill` in daemon stop/restart kills orphaned claude processes matching `--allowedTools.*mcp__shadow`.
- **JobQueue** — `src/daemon/job-queue.ts`. Concurrent execution with same-type mutual exclusion. LLM jobs capped by `maxConcurrentJobs`, IO jobs unlimited. Per-job timeout (15min) via `Promise.race` + `killJobAdapters`. SSE events on start/phase/complete.
- **Job handlers** — `src/daemon/job-handlers.ts`. 13 handlers registered by type. Category: `llm` (heartbeat, suggest*, consolidate, reflect, digest*, repo-profile, project-profile) or `io` (remote-sync, context-enrich).
- **Worktree cleanup** — Runner creates git worktrees for execution runs, removes them after completion (success or failure). Branch kept for draft PR.
- **Corrections** — `shadow_correct` MCP tool + `/api/corrections` endpoint. Creates `kind: 'correction'` memory in core layer. `enforceCorrections()` in consolidate job processes corrections against existing memories (archive/edit). CorrectionPanel in dashboard.
- **Thoughts** — `src/daemon/thought.ts`. Decorative LLM-generated status line phrases. Configurable interval + duration. Non-fatal (never crashes daemon).
- **Pagination** — DB `count*` methods for all entities. API returns `{ items, total }`. `clampLimit` (max 200) + `clampOffset` (min 0) on all endpoints. Zod validation on POST bodies via `parseBody`/`parseOptionalBody` helpers.
- **Draft PR** — endpoint validates branch exists → `git push` → `gh pr create --draft`. Schema v22 (pr_url). Button disabled without GitHub remote.
- **Severity filter** — ObservationsPage supports server-side severity filtering (high/warning/info). DB `listObservations` + `countObservations` accept `severity` param.
- **MCP discovery** — `discoverMcpServerNames()` reads `~/.claude/settings.json` → mcpServers keys, excludes 'shadow'. Used by enrichment planner.
- **Enrichment cache** — migration v30. `upsertEnrichment` deduplicates by content_hash. `expireStaleEnrichment` removes expired entries. `buildEnrichmentContext()` marks items as reported after injecting into heartbeat.
- **Project-aware MCP tools** — `shadow_observations` and `shadow_suggestions` accept `projectId` filter (entity link match). `shadow_active_projects` returns detected active projects with momentum. `shadow_project_detail` returns rich project view with counts.
- **Status line active project** — `shadow status --json` includes `activeProject` (top project from daemon detection). Statusline shows `📋 project-name`.
- **Ghost mascot new states** — `enriching` (mint/teal, `\033[38;5;48m`) and `syncing` (pink, `\033[38;5;219m`) for enrich/remote-sync daemon phases.
- **Unified status vocabulary** — All entities use consistent status names: `open` (new/active), `done` (completed/resolved), `dismissed` (rejected). Observations: open/acknowledged/done/expired. Suggestions: open/accepted/dismissed/snoozed. Tasks: open/active/blocked/done (+ archived flag). Runs: queued/running/completed/done/dismissed/failed (+ outcome field for done runs).
- **Run state machine** — `src/runner/state-machine.ts`. Directed graph: queued→running/failed, running→completed/done/failed, completed→done/dismissed/failed. Terminal: done, dismissed, failed. Parent aggregation from children.
- **Tasks** — First-class work containers (`src/mcp/tools/tasks.ts`, `src/storage/stores/execution.ts`). Link to suggestions via `suggestion_id` (created from accept "plan"), to projects via `project_id`, to repos via `repo_ids_json`. Runs link back to tasks via `task_id`. External refs (Jira, GitHub) and session resume support.
- **Run outcome** — When a run reaches `done`, the `outcome` field records how it got there (e.g., executed, executed_manual, closed). This replaces the old status-as-outcome pattern where executed/executed_manual/closed were separate statuses.
- **Autonomy system** — `src/autonomy/rules.ts` defines Zod schemas for plan/execute rules. `src/daemon/handlers/autonomy.ts` implements both job handlers. Auto-plan: filters open suggestions by rules (DB-level, 0 tokens), revalidates each against code (LLM), auto-dismisses outdated, accepts valid ones as plan runs. Auto-execute: filters planned runs by rules + hardcoded confidence gate (high + 0 doubts), creates child execution runs in worktree. Config stored in `user_profile.preferences_json.autonomy`. Per-repo opt-in, OFF by default.
- **Bond system (v49)** — Replaced single-score trust with 5-axis bond + 8 tiers + Chronicle page. Dual-gated (time + quality floor), monotonic. Chronicle writes immutable tier lore (Opus) + milestone commentaries (Opus) + daily Voice of Shadow (Haiku, 24h cache) + next-step hint (Haiku, 24h cache). Reset on first boot via `~/.shadow/bond-reset.v49.done` sentinel. All MCP tools remain available regardless of bond tier — narrative only, no capability gating.
- **Per-job timeout** — `JobHandlerEntry` now supports optional `timeoutMs` field. JobQueue uses per-job timeout when set, falls back to global 15min default. Auto-plan: 30min, auto-execute: 60min.
- **Suggestion effort field** — `effort` (small/medium/large) now persisted in DB (migration v47). Generated by LLM in suggest pipeline, used by autonomy rules for filtering.
- **Confidence eval model** — Changed from hardcoded Sonnet to `config.models.runner` (default Opus). Critical gate decision for autonomous execution warrants highest quality model.
