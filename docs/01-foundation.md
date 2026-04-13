# Phase 1 — Foundation

> **⚠️ Historical document** — This was the original v0.3 design spec. The implementation has evolved significantly. For current architecture see [CLAUDE.md](../CLAUDE.md) and [docs/README.md](README.md).

**Status: DONE**

## Goal

Bootstrap the project with config management, SQLite storage, and a CLI skeleton that
proves the data layer works end-to-end.

## Components

### 1.1 Project Configuration

**Files:** `package.json`, `tsconfig.json`, `.env.example`, `.gitignore`

- Node.js 22+ (required for native `node:sqlite` DatabaseSync)
- ESM modules, TypeScript strict mode
- Dependencies: `commander@14`, `zod@4`, `dotenv@17`
- Dev dependencies: `tsx`, `typescript@5.9`, `@types/node`
- Scripts: `dev` (tsx), `build` (tsc), `typecheck`, `test`, `clean`

### 1.2 Config Module

**Files:** `src/config/schema.ts`, `src/config/load-config.ts`

**Pattern:** Zod schema validation with environment variable mapping (from Sidecar).

```typescript
// Environment variables (all optional, sensible defaults)
SHADOW_ENV             // development | test | production
SHADOW_DATA_DIR        // default: ~/.shadow
SHADOW_LOG_LEVEL       // debug | info | warn | error
SHADOW_CLAUDE_BIN      // default: claude
SHADOW_CLAUDE_EXTRA_PATH
SHADOW_RUNNER_TIMEOUT_MS       // default: 600000 (10 min)
SHADOW_HEARTBEAT_INTERVAL_MS   // default: 900000 (15 min)
SHADOW_DAEMON_POLL_INTERVAL_MS // default: 30000
SHADOW_LOCALE                  // default: es
SHADOW_BACKEND=cli                    # cli (default, uses logged-in claude) | api (uses ANTHROPIC_API_KEY)
SHADOW_PROACTIVITY_LEVEL=5            # 1-10 proactivity scale
SHADOW_PERSONALITY_LEVEL=4            # 1-5 personality scale (4 = Tam-like)
SHADOW_MODEL_ANALYZE=sonnet           # Model for heartbeat analyze phase
SHADOW_MODEL_SUGGEST=opus             # Model for heartbeat suggest phase
SHADOW_MODEL_CONSOLIDATE=sonnet       # Model for heartbeat consolidate phase
SHADOW_MODEL_RUNNER=sonnet            # Model for task runner
```

**Resolved paths** (computed post-validation):
- `resolvedDataDir` — absolute path to data directory
- `resolvedDatabasePath` — `{dataDir}/shadow.db`
- `resolvedArtifactsDir` — `{dataDir}/artifacts`

**ConfigSchema** additional fields (added for Phase 2+):

```typescript
backend: z.enum(['cli', 'api']).default('cli'),
proactivityLevel: z.coerce.number().int().min(1).max(10).default(5),
personalityLevel: z.coerce.number().int().min(1).max(5).default(4),
models: z.object({
  analyze: z.string().default('sonnet'),
  suggest: z.string().default('opus'),
  consolidate: z.string().default('sonnet'),
  runner: z.string().default('sonnet'),
}).default({}),
```

Directories are created on load (`mkdirSync` with `recursive: true`).

### 1.3 Storage Layer

**Files:** `src/storage/models.ts`, `src/storage/migrations.ts`, `src/storage/database.ts`,
`src/storage/index.ts`

**Pattern:** Sidecar's storage pattern — `DatabaseSync` wrapper class with typed mappers,
`CreateXInput` types separate from `XRecord` types, camelCase in TypeScript / snake_case
in SQL.

#### Schema (Migration v1 — 11 tables)

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `schema_migrations` | Migration versioning | version, name, applied_at |
| `repos` | Watched repositories | path (UNIQUE), language_hint, test/lint/build commands |
| `user_profile` | Single-row user state | bond_axes_json, bond_tier (1-8), bond_reset_at, preferences (JSON). Legacy trust_level/trust_score/bond_level kept but unused since v49 |
| `memories` | Layered memory system | layer, scope, kind, FTS-indexed title+body |
| `observations` | Raw signals from repo watching | kind, severity, processed flag |
| `suggestions` | Proactive recommendations | impact/confidence/risk scores (required_trust_level legacy, unused since v49) |
| `heartbeats` | Autonomous activity log | phase, activity, duration_ms |
| `interactions` | User conversation log | sentiment, topics (JSON) (trust_delta legacy, unused since v49) |
| `event_queue` | Decoupled notifications | kind, priority, delivered flag |
| `runs` | Task executions via AI backend | status, prompt, result_summary_md |
| `audit_events` | Append-only action trail | actor, interface, action, detail (JSON) |

**SQLite pragmas:** `PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;`

**Migration system:** Transactional per-migration application with rollback on error.

> **Note:** Migration 2 (Phase 2) will add: `systems` table, `contacts` table, `llm_usage` table, FTS5 virtual table + triggers, profile expansion columns (`proactivity_level`, `personality_level`, `focus_mode`, `focus_until`, `energy_level`, `mood_hint`), observation source columns (`source_kind`, `source_id`), multi-repo columns (`repo_ids_json` on suggestions and runs), and core layer index.
>
> **Note:** The existing `proactive_level TEXT` column will be superseded by `proactivity_level INTEGER` in migration 2.

#### Database CRUD

Each table gets: `create`, `get`, `list` (with filters), and targeted `update` methods.

Notable additions:
- `ensureProfile()` — upsert pattern for single-row user profile
- `touchMemory(id)` — increment access_count + update last_accessed_at
- `countPendingSuggestions()` — aggregate for anti-loop enforcement
- `deliverAllEvents()` — bulk acknowledge with count return

### 1.4 CLI Skeleton

**Files:** `src/cli.ts`, `src/cli/output.ts`

**Pattern:** Sidecar's `withApp` pattern adapted as `withDb` — opens database, executes
handler, closes database in `finally` block.

**Commands implemented:**

| Command | Description |
|---------|------------|
| `shadow init` | Bootstrap ~/.shadow, create DB, ensure profile |
| `shadow status` | Bond tier, repos count, pending suggestions/events |
| `shadow doctor` | Node version, platform, config values |
| `shadow repo add <path>` | Register a repo to watch |
| `shadow repo list` | List watched repos |
| `shadow repo remove <id>` | Stop watching a repo |
| `shadow memory list` | List hot+warm memories (filterable by layer/scope) |
| `shadow memory teach <title>` | Teach Shadow a fact (goes to hot layer) |
| `shadow memory forget <id>` | Archive a memory |
| `shadow suggest list` | List pending suggestions |
| `shadow suggest view <id>` | View suggestion detail |
| `shadow suggest accept <id>` | Accept suggestion |
| `shadow suggest dismiss <id>` | Dismiss suggestion (with optional --note) |
| `shadow profile show` | Show full user profile |
| `shadow profile bond` | Show bond tier and axes |
| `shadow profile bond-reset --confirm` | Reset bond state to tier 1 (memories preserved) |
| `shadow events list` | Show pending events |
| `shadow events ack` | Acknowledge all pending events |

All commands support `--json` flag for structured output.

## Verification

```bash
npm run typecheck          # Compiles without errors
npm run dev -- init        # Creates ~/.shadow with DB and directories
npm run dev -- status      # Shows bond tier 1, 0 repos, 0 suggestions
npm run dev -- doctor      # Shows Node version, config values
npm run dev -- repo add .  # Registers current directory
npm run dev -- repo list   # Shows registered repos
npm run dev -- memory teach "test" --body "test memory"
npm run dev -- memory list # Shows the taught memory
npm run dev -- profile bond   # Shows bond tier 1, axes all 0
```
