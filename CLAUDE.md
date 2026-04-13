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
                                    │   ├── pr-sync (gh pr view for awaiting_pr runs, 30min)
                                    │   ├── context-enrich (MCP enrichment)
                                    │   └── auto-plan / auto-execute (autonomy)
                                    ├── Hooks (6: sessions + tool use + errors + subagents)
                                    └── launchd service (auto-start, auto-restart)
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js 22+ (ESM) |
| Language | TypeScript 5.9+ (strict) |
| Storage | SQLite (node:sqlite DatabaseSync, WAL mode, busy_timeout=5000) |
| Search | FTS5 (BM25) + sqlite-vec (cosine) — hybrid via RRF |
| Embeddings | @huggingface/transformers, all-MiniLM-L6-v2 (384 dims, local) |
| CLI | Commander.js 14 |
| Validation | Zod 4 |
| LLM Backend | Claude CLI (`--print --output-format json`) or Agent SDK |
| MCP | JSON-RPC over stdio (67 tools) |
| Dashboard | React 19, Vite, Tailwind CSS 4, React Router 7 |
| Daemon | launchd (macOS), KeepAlive=true |

## Dashboard Routes

| Route | Page | Purpose |
|-------|------|---------|
| `/morning` | Morning | Daily brief: active projects, metrics, runs, memories, observations, suggestions |
| `/profile` | Profile | Settings: identity, behavior, models, soul, thoughts, enrichment, autonomy |
| `/chronicle` | Chronicle | Bond system: radar, tier path, timeline, unlocks |
| `/memories` | Memories | Search + layer filter + pagination |
| `/suggestions` | Suggestions | Filter tabs, pagination, accept/dismiss, bulk actions |
| `/observations` | Observations | Filter by status/severity, votes, ack/resolve/reopen |
| `/repos` | Repos | Repo profile cards with correction panel |
| `/projects`, `/projects/:id` | Projects | Cards + drill-down to detail |
| `/team` | Team | Contacts management |
| `/systems`, `/systems/:id` | Systems | Cards + drill-down |
| `/workspace` | Workspace | Tasks + runs: execute/session/dismiss/PR |
| `/activity` | Activity | Unified jobs+runs timeline, SSE live status |
| `/usage` | Usage | Token usage by period and model |
| `/digests` | Digests | Daily/weekly/brag with navigation |
| `/events` | Events | Pending event queue |
| `/guide` | Guide | Tabbed reference: overview, concepts, CLI, MCP tools, jobs |

**Dev**: `npm run dashboard:dev` → Vite on :5173, proxies API to :3700. **Build**: `npm run dashboard:build` → outputs to `src/web/dashboard/dist/`, served by daemon at :3700 via `server.ts` (which checks this path first, then falls back to `src/web/public/index.html` for legacy).

## Database Schema

20 tables + virtual tables (SQLite, WAL mode, busy_timeout=5000ms):

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `repos` | Tracked repos | name, path (unique), default_branch, test/lint/build commands, last_fetched_at |
| `projects` | Groups of repos+systems | kind (long-term/sprint/task), status, repo_ids_json, system_ids_json |
| `user_profile` | Single-row profile | bond_axes_json, bond_tier (1-8), bond_reset_at, proactivity_level, focus_mode |
| `chronicle_entries` | Immutable narrative (v49) | kind ('tier_lore'\|'milestone'), tier, milestone_key, body_md, model |
| `unlockables` | Tier-gated content slots (v49) | tier_required, kind, title, description, payload_json, unlocked |
| `bond_daily_cache` | 24h TTL cache (v49) | cache_key, body_md, expires_at |
| `memories` | Layered memory | layer, scope, kind, entities_json, memory_type, FTS5+vector indexed |
| `observations` | LLM-derived facts | source_kind, kind, entities_json, repo_ids_json, votes, severity |
| `suggestions` | LLM proposals | impact/confidence/risk/effort, status, entities_json |
| `jobs` | Job execution log | type, phase, status, llm_calls, tokens_used, duration_ms |
| `interactions` | User interactions | sentiment, topics, trust_delta |
| `event_queue` | Notifications | kind, priority (1-10), delivered |
| `tasks` | Work containers | title, status, suggestion_id, project_id, repo_ids_json, external_refs_json, session_id, archived |
| `runs` | Task execution | status, task_id, outcome, snapshot_ref, result_ref, diff_stat, verification_json, verified |
| `audit_events` | Append-only trail | actor, action, target_kind, target_id |
| `llm_usage` | Token tracking | source, model, input_tokens, output_tokens |
| `systems` | Infrastructure | kind, url, health_check |
| `contacts` | Team members | role, team, email, slack_id, github_handle |
| `feedback` | User feedback | target_kind, target_id, action, note |
| `entity_relations` | Entity graph | source_type, source_id, relation, target_type, target_id, confidence |
| `enrichment_cache` | MCP enrichment data | source, entity_type, entity_id, summary, content_hash, reported, expires_at |
| `digests` | Generated reports | kind, period_start, period_end, content_md, model |
| `*_fts` | FTS5 virtual tables | auto-synced via triggers |
| `*_vectors` | vec0 virtual tables | 384-dim embeddings for memories, observations, suggestions |

## Entity Linking

All knowledge entities (memories, observations, suggestions) have an `entities_json` column:
```json
[{"type": "repo", "id": "..."}, {"type": "project", "id": "..."}, {"type": "system", "id": "..."}]
```
Enables cross-entity queries: "everything Shadow knows about project X" across all three systems.

Tasks and runs also participate in entity linking:
- Tasks can have a `suggestion_id` (created when accepting a suggestion with category "plan")
- Runs can have a `task_id` (created via `shadow_task_execute` or workspace actions)
- Lifecycle chain: Suggestion → (accept "plan") → Task → (execute) → Run

## Semantic Dedup

New entities go through `checkDuplicate()` before creation:
- Generates embedding via `all-MiniLM-L6-v2` (local, ~4ms)
- Searches vector table for similar entries (cosine similarity)
- Decision: **skip** (>0.85), **update** existing (>0.70), or **create** new
- Thresholds calibrated per entity type. Suggestions also check against dismissed (>0.75 = blocked).
- Observations use multi-pass dedup: active → resolved → expired. Resolved with deliberate feedback are protected (votes++ only); auto-capped/expired are reopened.

## Memory Layers

| Layer | Decays | Purpose |
|-------|--------|---------|
| core | Never | Permanent: infra, team, conventions (cap: 30, eviction by `relevanceScore * accessCount`) |
| hot | 14 days | Current work context |
| warm | 30 days | Recent knowledge |
| cool | 90 days | Archive |
| cold | Yes | Passive archive |

All memory is **on-demand** — never auto-loaded into prompts. FTS5 search finds relevant memories by context.

## Bond System (v49)

5-axis bond + 8 tiers, dual-gated by time + quality floor, monotonic. **Narrative only — no capability gating.** All MCP tools are available regardless of bond tier.

- **Axes** (0-100): `time` (sqrt over 1y, gate-only), `depth` (taught/correction/summary/reflection memories), `momentum` (feedback+runs+obs last 28d), `alignment` (accept/dismiss rate + corrections + reflections), `autonomy` (auto-executed runs)
- **Tiers**: observer → echo → whisper → shade → shadow → wraith → herald → kindred
- **Chronicle** at `/chronicle`: radar, tier path, immutable timeline (tier lore + milestones), unlocks grid. LLM-authored narrative (Opus for lore/milestones, Haiku for daily voice/hint, 24h cache)
- **Reset**: `shadow profile bond-reset --confirm`. Auto-runs on first boot via `~/.shadow/bond-reset.v49.done` sentinel. Preserves memories/suggestions/observations/runs/soul.
- Implementation: `src/profile/bond.ts`, `src/profile/unlockables.ts`

## Hooks (Claude Code Integration)

| Hook | Purpose |
|------|---------|
| SessionStart | Injects personality via `shadow mcp-context` |
| PostToolUse | Tool usage with rich per-tool detail (jq) → `interactions.jsonl` |
| UserPromptSubmit | User messages (full text) → `conversations.jsonl` |
| Stop | Claude responses (full text) → `conversations.jsonl` |
| StopFailure | API errors → `events.jsonl` |
| SubagentStart | Subagent spawns → `events.jsonl` |
| StatusLine | Emoji status bar: activity + bond badge + suggestions + heartbeat countdown |

All capture hooks filter daemon self-traffic via `SHADOW_JOB=1` env var (prevents contamination when the daemon itself spawns Claude).

## Observations (LLM-generated)

Observations are NOT from git scanning. They are generated by the LLM during the heartbeat analyze phase. The LLM sees conversations + interactions + repo context and flags actionable insights.

Kinds: `improvement`, `risk`, `opportunity`, `pattern`, `infrastructure`. Source: `sourceKind: 'llm'` (not `'repo'`).

## CLI Commands

```bash
# Setup
shadow init                     # Bootstrap (DB, hooks, launchd, SOUL.md)

# Daily use (primary interface is Claude CLI, not these)
shadow ask "question"           # One-shot question with personality
shadow summary                  # Daily activity summary
shadow web                      # Open dashboard in browser

# Admin
shadow status / doctor / daemon start|stop|restart|status / usage

# Data management
shadow repo add|list|remove
shadow contact add|list|remove
shadow system add|list|remove
shadow memory list|search|teach|forget
shadow suggest list|view|accept|dismiss
shadow observe / events list|ack / focus [duration] / available
shadow job <type>               # Trigger any daemon job
shadow job list                 # List all job types
shadow profile bond-reset --confirm
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
npm run typecheck                # TypeScript check only
```

## Config (env vars)

```bash
SHADOW_BACKEND=cli                   # cli (default) | api
SHADOW_PROACTIVITY_LEVEL=5           # 1-10
SHADOW_MODEL_ANALYZE=sonnet          # Heartbeat analyze
SHADOW_MODEL_SUGGEST=opus            # Suggestions
SHADOW_MODEL_CONSOLIDATE=sonnet      # Memory consolidation
SHADOW_MODEL_RUNNER=opus             # Task execution + confidence eval
SHADOW_MODEL_CHRONICLE_LORE=opus     # Chronicle tier/milestone lore
SHADOW_MODEL_CHRONICLE_DAILY=haiku   # Voice of shadow + next-step hint
SHADOW_HEARTBEAT_INTERVAL_MS=900000  # 15 min
SHADOW_DATA_DIR=~/.shadow            # Data directory
```

## Key Patterns

**Adding a new MCP tool**: Add to the appropriate file in `src/mcp/tools/` (status, memory, observations, suggestions, entities, profile, data, tasks). Follow existing pattern: inputSchema + async handler. Register in `src/mcp/server.ts` tool assembly.

**Adding a new CLI command**: Extend the appropriate `src/cli/cmd-*.ts` module. Export a register function, call it from `src/cli.ts`. Use `withDb()` wrapper for DB access.

**Adding a new DB method**: Add to the appropriate store in `src/storage/stores/` (entities, knowledge, execution, tracking, profile, enrichment, relations). Add delegation one-liner in `src/storage/database.ts`. Add mapper in `mappers.ts` if needed.

**Adding a new API endpoint**: Add route handler in `src/web/routes/*.ts`. Import helpers from `src/web/helpers.ts`. Use Zod via `parseBody`/`parseOptionalBody`. Use `clampLimit`/`clampOffset` on pagination.

**Adding a dashboard page**: Create component in `src/web/dashboard/src/components/pages/`. Add route in `App.tsx`. Add nav item in `Sidebar.tsx`.

**`updateProfile` JSON fields**: writes to `_json` columns need a `Json` suffix in the TS key, otherwise the write is silently dropped.

**SQLite migrations**: never modify an applied migration — the daemon applies on restart and silently ignores SQL added to a version already recorded in `schema_version`. Always create a new version. `ALTER TABLE ... ADD COLUMN` rejects non-constant defaults — use placeholder + UPDATE in the same migration.

## Invariants & gotchas

- **Prompt via stdin** — all LLM calls pass prompt via stdin pipe, not CLI args (avoids ARG_MAX).
- **`--allowedTools "mcp__shadow__*"`** on all CLI spawns — Claude uses Shadow's tools without permission prompts. Execution runs also get `Edit,Write,Bash`.
- **Runner = MCP delegation** — briefing-only prompt; Claude reads files and uses `shadow_*` tools itself rather than receiving pre-loaded context.
- **Rotation = consume-and-delete** — at heartbeat start, JSONL files are renamed to `.rotating` atomically. Each heartbeat processes exactly the data since the last one. Orphaned `.rotating` from crashed heartbeats are consumed in the next run.
- **Unified status vocabulary** — all entities use `open` / `done` / `dismissed`. Observations add `acknowledged` / `expired`. Runs use `queued/running/planned/awaiting_pr/done/dismissed/failed` with `outcome` recording *how* a `done` was reached (executed / executed_manual / merged / no_changes / closed_manual). `awaiting_pr` is non-terminal: parent plan waits for PR merge/close, finalized by the `pr-sync` job.
- **Per-job timeout** — JobQueue supports per-job `timeoutMs` via `JobHandlerEntry` (default 15min, auto-plan 30min, auto-execute 60min). Timeout kills spawned adapters via `killJobAdapters`.
- **Confidence eval model** — uses `config.models.runner` (default Opus). Critical gate decision for autonomous execution warrants highest quality.
- **Access count honesty** — heartbeat internal lookups use `touch=false`; only MCP searches increment access counts.
- **Child process cleanup** — `killJobAdapters(jobId)` sends SIGTERM to spawned `claude` processes per job. `pkill` in daemon stop/restart kills orphaned matches to `--allowedTools.*mcp__shadow`.

## Backlog

Pending work tracked in [`BACKLOG.md`](BACKLOG.md). Completed items archived in [`COMPLETED.md`](COMPLETED.md).
