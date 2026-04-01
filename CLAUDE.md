# Shadow — Developer Guide

## What is Shadow

Shadow is a local-first engineering companion that runs as a background daemon, learns from your work, and interacts via Claude CLI (MCP) and a web dashboard. It's 100% LLM-based — Claude is the brain, Shadow is the persistence and observation layer.

## Architecture

```
User ← Claude CLI (MCP tools) → Shadow daemon (port 3700)
                                    ├── SQLite DB (~/.shadow/shadow.db)
                                    ├── Web dashboard (React, localhost:3700)
                                    ├── Heartbeat (every 15min)
                                    │   ├── observe (git, programmatic)
                                    │   ├── analyze (LLM, creates memories)
                                    │   ├── suggest (LLM, creates suggestions)
                                    │   └── consolidate (memory maintenance)
                                    ├── interactions.jsonl (PostToolUse hook)
                                    └── launchd service (auto-start, auto-restart)
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js 22+ (ESM) |
| Language | TypeScript 5.9+ (strict) |
| Storage | SQLite (node:sqlite DatabaseSync, WAL mode, busy_timeout=5000) |
| Search | FTS5 (full-text, BM25 ranking) |
| CLI | Commander.js 14 |
| Validation | Zod 4 |
| LLM Backend | Claude CLI (`--print --output-format json`) or Agent SDK |
| MCP | JSON-RPC over stdio (29 tools) |
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
│   │   ├── migrations.ts         # Schema v1 + v2 (12 tables, FTS5, triggers)
│   │   ├── models.ts             # 14 record types
│   │   └── index.ts              # Re-exports
│   ├── observation/
│   │   ├── watcher.ts            # Git observation engine (4 kinds, dedup)
│   │   └── patterns.ts           # Cross-observation pattern detection
│   ├── memory/
│   │   ├── layers.ts             # 5-layer maintenance (core/hot/warm/cool/cold)
│   │   └── retrieval.ts          # FTS5 search, context-aware memory loading
│   ├── heartbeat/
│   │   ├── state-machine.ts      # wake→observe→analyze→suggest→consolidate→notify→idle
│   │   ├── activities.ts         # Phase implementations (LLM prompts, memory creation)
│   │   └── anti-loop.ts          # Cooldowns, rate limits, backoff
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
│   │   ├── server.ts             # 29 MCP tools (read + trust-gated write)
│   │   └── stdio.ts              # JSON-RPC transport
│   └── web/
│       ├── server.ts             # HTTP API server (15+ endpoints)
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
| `/morning` | Morning | Daily brief: greeting, new observations, memories, suggestions |
| `/dashboard` | Dashboard | Overview metrics grid |
| `/profile` | Profile | Edit displayName, timezone, proactivity, personality |
| `/memories` | Memories | Search + layer filter + expandable list |
| `/suggestions` | Suggestions | Accept/dismiss with impact/confidence/risk |
| `/observations` | Observations | Kind-specific renderers (commits, branches, etc.) |
| `/repos` | Repos | Registered repos with last observed |
| `/team` | Team | Contacts management |
| `/systems` | Systems | Infrastructure registry |
| `/usage` | Usage | Token usage by period and model |
| `/heartbeats` | Heartbeats | Timeline with phase badges |
| `/runs` | Runs | Execution history |
| `/events` | Events | Pending event queue |

## Database Schema

**14 tables** (SQLite, WAL mode, busy_timeout=5000ms for concurrency):

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `repos` | Tracked repos | name, path (unique), default_branch, test/lint/build commands |
| `user_profile` | Single-row profile | trust_level (1-5), trust_score (0-100), proactivity_level (1-10), personality_level (1-5), focus_mode |
| `memories` | Layered memory | layer (core/hot/warm/cool/cold), scope, kind, FTS5 indexed |
| `observations` | Git-derived facts | source_kind, kind (recent_commits/uncommitted_work/project_structure/active_branches) |
| `suggestions` | LLM proposals | impact/confidence/risk scores, status, repo_ids_json (multi-repo) |
| `heartbeats` | State machine log | phase, observations_created, suggestions_created, duration_ms |
| `interactions` | User interactions | sentiment, topics, trust_delta |
| `event_queue` | Notifications | kind, priority (1-10), delivered flag |
| `runs` | Task execution | status (queued/running/completed/failed), repo_ids_json |
| `audit_events` | Append-only trail | actor, action, target_kind, target_id |
| `llm_usage` | Token tracking | source, model, input_tokens, output_tokens |
| `systems` | Infrastructure | kind (infra/service/database/queue/monitoring), url, health_check |
| `contacts` | Team members | role, team, email, slack_id, github_handle |
| `memories_fts` | FTS5 virtual table | title, body_md, tags — auto-synced via triggers |

## MCP Tools (29 total)

### Read-only (no trust gate)
`shadow_check_in`, `shadow_status`, `shadow_repos`, `shadow_observations`, `shadow_suggestions`, `shadow_memory_search`, `shadow_memory_list`, `shadow_profile`, `shadow_events`, `shadow_contacts`, `shadow_systems`, `shadow_run_list`, `shadow_run_view`, `shadow_usage`, `shadow_daily_summary`

### Write (trust >= 1)
`shadow_repo_add`, `shadow_repo_remove`, `shadow_contact_add`, `shadow_contact_remove`, `shadow_system_add`, `shadow_system_remove`, `shadow_memory_teach`, `shadow_memory_forget`, `shadow_suggest_accept`, `shadow_suggest_dismiss`, `shadow_profile_set`, `shadow_focus`, `shadow_available`, `shadow_events_ack`

### Write (trust >= 2)
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

| Emoji | State |
|-------|-------|
| 😴 | Daemon not running |
| 😊 | Ready (idle) |
| 👀 | Watching (few interactions) |
| 📝 | Learning (many interactions) |
| 🎯 | Focus mode |
| 🧠 | Heartbeat: analyzing |
| 💡 | Heartbeat: suggesting |

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

## Current State (as of 2026-04-01)

- **30 MCP tools** (15 read + 15 write + check_in)
- **4 hooks** (SessionStart, PostToolUse, UserPromptSubmit, Stop)
- **Status line** with emojis (activity, trust badge, mood, energy, suggestions, heartbeat countdown)
- **Daemon** via launchd (auto-start, auto-restart, KeepAlive)
- **Dashboard** React app at localhost:3700 (13 routes + emoji guide)
- **Web server** integrated in daemon (serves dashboard + API)
- **Conversation capture** — Shadow learns from what you discuss, not just files
- **LLM-powered observations** — actionable insights, not git statistics
- **Auto mood/energy** — inferred from conversations by heartbeat
- **Model config from dashboard** — /profile page has LLM model dropdowns
- **`shadow ask`** — one-shot questions from any terminal
- **`shadow summary`** — daily activity summary
- **Trust score**: ~9 (growing with usage, needs 15 for level 2/suggestions)

## Next Steps (for new sessions)

### Priority 1: Observation improvements (planned, not implemented)
1. **Enriched context** — observations should include: repo name, file paths involved, session ID where discussed. Currently only have kind + title + detail string.
2. **Vote system** — when the same observation is detected again (e.g., "uncommitted files" persists), don't create a duplicate — increment a `votes` counter on the existing one. Higher votes = higher priority in dashboard.
3. **Lifecycle** — observations need states:
   - `active` → new, visible in dashboard
   - `acknowledged` → user saw it (clicked in dashboard or `events ack`)
   - `resolved` → condition no longer applies, or auto after 48h
   - `expired` → after 7 days without interaction
   Dashboard morning brief should only show `active` observations.
4. **Schema changes needed**: Add columns to `observations` table:
   - `votes INTEGER DEFAULT 1`
   - `status TEXT DEFAULT 'active'` (active/acknowledged/resolved/expired)
   - `first_seen_at TEXT` (when first detected)
   - `last_seen_at TEXT` (when last voted)
   - `context_json TEXT` (repo name, files, session ID)

### Priority 2: Other improvements
5. **Suggest phase** — trust needs to reach 15+ (level 2) for suggestions to generate. Currently ~9. Consider accelerating trust growth or manually boosting for testing.
6. **Dashboard observations page** — render LLM observations with enriched context (repo badges, file lists, vote count). Group by kind.
7. **Semantic search (sqlite-vec)** — hybrid FTS5 + vector search for memories. Requires embedding model.
8. **Tests** — zero test coverage. At minimum: database CRUD, FTS5 search, heartbeat state machine, observation creation.

### Known issues
- Dashboard observations page still has `[object Object]` rendering for some detail fields (arrays of objects)
- `observationsCreated` in heartbeat result always shows 0 because observations are created inside analyze, not observe phase. The counter needs updating.
- Old git-based observations still in DB from before the rewrite. Consider purging with: `DELETE FROM observations WHERE source_kind = 'repo'`

### Architecture notes for new sessions
- **Conversations are the richest data source** — the analyze prompt prioritizes them. Tool interactions and repo context are secondary.
- **The analyze prompt returns 3 things**: insights (→ memories), observations (→ observations table), profileUpdates (→ mood/energy)
- **Models are configurable per phase** from the dashboard /profile page. Stored in `preferences_json` field of user_profile.
- **`getModel(ctx, phase)`** helper in activities.ts reads from profile preferences first, falls back to config.
- **Rotation**: conversations.jsonl and interactions.jsonl are rotated (keep last 2h) after each analyze to prevent bloat.
- **Dedup**: existing hot/core memories are included in the analyze prompt so the LLM doesn't create duplicates.
