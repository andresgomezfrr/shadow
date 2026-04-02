# Phase 2 — Observation + Memory + Infrastructure

> **⚠️ Historical document** — This was the original v0.3 design spec. The implementation has evolved significantly. For current architecture see [CLAUDE.md](../CLAUDE.md) and [docs/README.md](README.md).

**Status: Not started**

## Goal

Give Shadow eyes, a brain, and the plumbing for LLM execution. This phase covers:

- **Observation engine**: watch repos and other sources for changes, generate structured observations.
- **Memory system**: store, retrieve, promote, and demote knowledge across five layers with FTS5 search — always on-demand, never auto-loaded.
- **Backend adapters**: pluggable LLM execution layer (needed by Phase 3 heartbeat, so built here).
- **Schema expansion**: new tables (systems, contacts, llm_usage), profile fields, and multi-repo support.
- **CLI commands**: contacts CRUD, systems CRUD, focus mode.

---

## Components

### 2.1 Observation Watcher

**File:** `src/observation/watcher.ts`

The watcher polls registered repos using git commands and generates observations for anything noteworthy.

#### Source-agnostic observations

Observations are no longer tied exclusively to repositories. Each observation carries:

| Field | Type | Description |
|-------|------|-------------|
| `source_kind` | `repo \| system \| log \| manual \| general` | What produced the observation |
| `source_id` | `TEXT \| NULL` | Foreign key to `repos.id`, `systems.id`, or NULL for manual/general |
| `repo_id` | `TEXT \| NULL` | **Kept for backwards compatibility.** Populated when `source_kind = 'repo'`. |

This means observations can originate from monitored systems, log files, manual user input, or general context — not just git repos.

#### Data sources (per repo)

| Command | What it captures |
|---------|-----------------|
| `git log --since=<lastObservedAt> --format='%H\|%aI\|%s' --numstat` | New commits with file-level stats |
| `git status --porcelain` | Uncommitted changes |
| `git diff --stat HEAD` | Working tree diff size |
| `git branch -a --sort=-committerdate` | Branch freshness |
| `git stash list` | Forgotten stashes |

#### Observation kinds

The same 9 observation kinds are used as programmatic pre-filters. They detect structural changes; the actual semantic analysis is deferred to the LLM in Phase 3's heartbeat.

| Kind | Trigger | Severity |
|------|---------|----------|
| `commit_burst` | >5 commits in 1 hour window | info |
| `file_hotspot` | Same file modified in >3 of last 10 commits | notice |
| `stale_branch` | Branch with no commits in >14 days | info |
| `large_diff` | Uncommitted diff >500 lines | notice |
| `test_failure` | `test_command` exits non-zero (if configured) | warning |
| `forgotten_stash` | Stash entries older than 7 days | info |
| `dependency_update` | package.json/requirements.txt/Cargo.toml changed | info |
| `work_session_start` | First commit after >4h gap | info |
| `work_session_end` | No commits for >2h after activity | info |

#### Implementation approach

```typescript
export type ObserveResult = {
  sourceKind: 'repo' | 'system' | 'log' | 'manual' | 'general';
  sourceId: string | null;
  repoId: string | null;       // backwards compat
  repoName: string | null;
  observations: ObservationRecord[];
  lastCommitAt: string | null;
  commitsSinceLastObservation: number;
};

export async function observeRepo(
  db: ShadowDatabase,
  repo: RepoRecord,
): Promise<ObserveResult>;

export async function observeAllRepos(
  db: ShadowDatabase,
): Promise<ObserveResult[]>;
```

Git commands are executed via `execFileSync` or `spawnSync` with:
- `cwd` set to repo path
- Timeout of 10 seconds per command
- Graceful error handling (repo might not exist, might not be a git repo)

After observing, `db.updateRepo(id, { lastObservedAt: now })` is called.

### 2.2 Pattern Detection

**File:** `src/observation/patterns.ts`

Analyzes raw observations to detect higher-level patterns across time. These are programmatic pre-filters; Phase 3's heartbeat runs the LLM for deeper analysis.

#### Patterns detected

| Pattern | How detected | Memory created |
|---------|-------------|---------------|
| Work schedule | Aggregate commit timestamps over 14 days | `preference`: "User typically works 9-18 CET" |
| Commit style | Analyze commit message patterns | `preference`: "User uses conventional commits" |
| Hot files | Files in >3 `file_hotspot` observations | `pattern`: "src/api/handler.ts is frequently modified" |
| Recurring failures | Same test_failure observation >3 times | `pattern`: "Tests in module X are flaky" |
| Language preference | Count language_hint across repos | `fact`: "Primary language is TypeScript" |

Pattern detection runs after observations are created, processing `observations` with
`processed = false`. After processing, observations are marked processed.

### 2.3 Memory Layers

**File:** `src/memory/layers.ts`

Manages the five-tier memory system. **All memory is on-demand** — no layer is auto-loaded into prompts. Layers define **durability** (how long a memory lives before decay), not visibility.

#### Layer definitions

| Layer | Decay window | Purpose |
|-------|-------------|---------|
| `core` | **No decay** | Permanent foundational knowledge — infra, team structure, processes. Only removed explicitly. |
| `hot` | 14 days | Active, frequently relevant context. Decays to warm after 14d without access. |
| `warm` | 30 days | Recent knowledge, slightly less active. Decays to cool. |
| `cool` | 90 days | Historical archive, still keyword-searchable. Decays to cold. |
| `cold` | None (passive) | Passive archive. Append-only, never auto-deleted. |

> **Key principle:** There is no "load all hot memories" pattern. Every retrieval is a context-aware search (see section 2.4). Layers control how aggressively a memory decays, not whether it appears in prompts.

#### Memory scopes

Scopes define the boundary of a memory's relevance:

| Scope | Description |
|-------|-------------|
| `personal` | Specific to the user (preferences, habits, schedule) |
| `repo` | Scoped to a single repository |
| `team` | Shared across the user's team |
| `system` | Tied to a monitored system |
| `cross-repo` | Spans multiple repositories (e.g., shared library patterns) |

#### Memory cognitive types

In addition to layers and scopes, memories are classified by cognitive type:

| Type | `kind` values | Examples |
|------|--------------|----------|
| **Episodic** | `observation`, `interaction-summary`, `heartbeat-result` | "User committed 12 times on Monday", "Session about auth refactor" |
| **Semantic** | `fact`, `preference`, `pattern` | "User prefers small PRs", "Repo uses Jest for testing" |
| **Procedural** | `recipe`, `workflow`, `fix-template` | "To deploy: run npm build && npm deploy", "Fix lint: run eslint --fix" |

#### Promotion / demotion rules

```
warm -> hot:  accessed >= 3 times in 7 days
              OR explicitly taught (sourceType = 'teach')
              OR pattern confirmed by user feedback

hot -> warm:  not accessed in 14 days
              OR confidence_score drops below 50

warm -> cool: not accessed in 30 days

cool -> cold: not accessed in 90 days
              OR confidence_score drops below 30
```

The `core` layer is exempt from all decay rules. Memories are placed there explicitly (e.g., `shadow memory teach --layer core "Team uses Kubernetes on GKE"`).

#### Lifecycle function

```typescript
export function maintainMemoryLayers(db: ShadowDatabase): {
  promoted: number;
  demoted: number;
  expired: number;
};
```

This function is called during heartbeat consolidation and:
1. Skips all `core`-layer memories (no decay)
2. Checks all hot memories — demotes stale ones to warm
3. Checks all warm memories — promotes frequently accessed, demotes stale to cool
4. Checks cool memories — demotes stale to cold
5. Expires memories past their `expires_at` date

### 2.4 Memory Retrieval with FTS5

**File:** `src/memory/retrieval.ts`

Uses SQLite FTS5 for ranked full-text search. **All retrieval is context-aware** — there is no "load all hot memories" function. Callers always provide a query, file paths, topics, or other context to scope the search.

#### FTS5 setup (migration v2)

```sql
-- Migration v2: FTS5 index for memories
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  title,
  body_md,
  tags_text,
  content='memories',
  content_rowid='rowid',
  tokenize='unicode61'
);

-- Triggers to keep FTS index in sync
CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, title, body_md, tags_text)
  VALUES (NEW.rowid, NEW.title, NEW.body_md, NEW.tags_json);
END;

CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, title, body_md, tags_text)
  VALUES ('delete', OLD.rowid, OLD.title, OLD.body_md, OLD.tags_json);
END;

CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, title, body_md, tags_text)
  VALUES ('delete', OLD.rowid, OLD.title, OLD.body_md, OLD.tags_json);
  INSERT INTO memories_fts(rowid, title, body_md, tags_text)
  VALUES (NEW.rowid, NEW.title, NEW.body_md, NEW.tags_json);
END;
```

#### Retrieval API

```typescript
export type MemorySearchResult = {
  memory: MemoryRecord;
  rank: number;       // BM25 relevance score
  snippet: string;    // FTS5 highlight snippet
};

// Full-text search — always context-aware
export function searchMemories(
  db: ShadowDatabase,
  query: string,
  options?: {
    layer?: string;
    scope?: string;
    sourceKind?: string;
    sourceId?: string;
    repoId?: string;   // backwards compat shorthand
    limit?: number;
  },
): MemorySearchResult[];

// Find memories relevant to a set of file paths / topics
export function findRelevantMemories(
  db: ShadowDatabase,
  context: {
    filePaths?: string[];
    topics?: string[];
    sourceKind?: string;
    sourceId?: string;
    repoId?: string;
  },
  limit?: number,
): MemoryRecord[];
```

> Note: the old `loadHotMemories()` function is removed. All retrieval goes through `searchMemories` or `findRelevantMemories`, which always require context.

#### FTS5 query examples

```sql
-- Basic search
SELECT m.*, rank
FROM memories_fts fts
JOIN memories m ON m.rowid = fts.rowid
WHERE memories_fts MATCH 'authentication AND testing'
  AND m.archived_at IS NULL
ORDER BY rank
LIMIT 10;

-- Search with BM25 ranking
SELECT m.*, bm25(memories_fts, 2.0, 1.0, 0.5) as rank
FROM memories_fts fts
JOIN memories m ON m.rowid = fts.rowid
WHERE memories_fts MATCH ?
ORDER BY rank
LIMIT ?;
```

### 2.5 Backend Adapters

Moved from Phase 4 to Phase 2 because Phase 3's heartbeat requires an LLM backend.

**Files:**
- `src/backend/types.ts` — interfaces and shared types
- `src/backend/claude-cli.ts` — Claude CLI adapter (default)
- `src/backend/agent-sdk.ts` — Agent SDK adapter
- `src/backend/index.ts` — adapter selection

#### Types

```typescript
// src/backend/types.ts

export interface BackendExecutionResult {
  content: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

export interface ObjectivePack {
  objective: string;
  repoIds: string[];           // multi-repo support
  contextMemories: MemoryRecord[];
  observations: ObservationRecord[];
}

export interface BackendAdapter {
  name: string;
  execute(prompt: string, options?: BackendOptions): Promise<BackendExecutionResult>;
  executeObjective(pack: ObjectivePack): Promise<BackendExecutionResult>;
  isAvailable(): Promise<boolean>;
}
```

#### Adapters

| Adapter | File | Auth | When used |
|---------|------|------|-----------|
| **Claude CLI** | `claude-cli.ts` | Logged-in session (no API key) | Default. Uses the `claude` CLI binary. |
| **Agent SDK** | `agent-sdk.ts` | `ANTHROPIC_API_KEY` env var | When `config.backend = 'agent-sdk'` or CLI is unavailable. |

#### Adapter selection

```typescript
// src/backend/index.ts
export function selectAdapter(config: ShadowConfig): BackendAdapter;
```

Selection logic:
1. If `config.backend` is explicitly set, use that adapter.
2. Otherwise, try Claude CLI first (check `isAvailable()`).
3. Fall back to Agent SDK if `ANTHROPIC_API_KEY` is set.
4. Throw if no adapter is available.

### 2.6 CLI Additions

| Command | Description |
|---------|------------|
| `shadow observe` | Run observation on all repos (or `--repo <id>`) |
| `shadow observe --dry-run` | Show what would be observed without writing |
| `shadow memory search <query>` | Full-text search across memories |
| `shadow contact add <name> [--role R] [--team T] [--email E] [--slack S] [--github G]` | Add a contact |
| `shadow contact list` | List all contacts |
| `shadow contact remove <id>` | Remove a contact |
| `shadow system add <name> --kind K --url U [--access-method M] [--health-check CMD]` | Register a monitored system |
| `shadow system list` | List all systems |
| `shadow system remove <id>` | Remove a system |
| `shadow focus [duration]` | Enter focus mode (optional duration, e.g. `2h`, `until 17:00`) |
| `shadow available` | Exit focus mode |

---

## Migration v2

Migration v2 covers FTS5 setup, new tables, profile expansion, and multi-repo support.

### FTS5 virtual table and triggers

See section 2.4 for the full SQL.

### New tables

#### `systems`

```sql
CREATE TABLE IF NOT EXISTS systems (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,                -- e.g. 'api', 'database', 'queue', 'storage', 'service'
  url TEXT,
  description TEXT,
  access_method TEXT,                -- e.g. 'http', 'ssh', 'cli'
  config_json TEXT DEFAULT '{}',
  health_check TEXT,                 -- command or URL to check health
  last_checked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

#### `contacts`

```sql
CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT,
  team TEXT,
  email TEXT,
  slack_id TEXT,
  github_handle TEXT,
  notes_md TEXT,
  preferred_channel TEXT,            -- e.g. 'slack', 'email', 'github'
  last_mentioned_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

#### `llm_usage`

```sql
CREATE TABLE IF NOT EXISTS llm_usage (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,              -- e.g. 'heartbeat', 'suggest', 'chat'
  source_id TEXT,                    -- FK to runs, heartbeats, etc.
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Profile expansion (ALTER)

```sql
ALTER TABLE profiles ADD COLUMN proactivity_level INTEGER DEFAULT 5;
ALTER TABLE profiles ADD COLUMN personality_level INTEGER DEFAULT 4;
ALTER TABLE profiles ADD COLUMN focus_mode TEXT;          -- NULL | 'focus' | 'available'
ALTER TABLE profiles ADD COLUMN focus_until TEXT;
ALTER TABLE profiles ADD COLUMN energy_level TEXT;
ALTER TABLE profiles ADD COLUMN mood_hint TEXT;
```

### Multi-repo support (ALTER)

```sql
ALTER TABLE suggestions ADD COLUMN repo_ids_json TEXT DEFAULT '[]';
ALTER TABLE runs ADD COLUMN repo_ids_json TEXT DEFAULT '[]';
```

---

## New files

```
src/observation/watcher.ts         # Git-based repo scanning (source-agnostic)
src/observation/patterns.ts        # Pattern detection from observations
src/memory/layers.ts               # Five-layer management with core layer, promote/demote
src/memory/retrieval.ts            # FTS5 search, context-aware retrieval only
src/backend/types.ts               # BackendAdapter interface, ObjectivePack, BackendExecutionResult
src/backend/claude-cli.ts          # Claude CLI adapter (default, logged-in session)
src/backend/agent-sdk.ts           # Agent SDK adapter (ANTHROPIC_API_KEY)
src/backend/index.ts               # selectAdapter(config) — adapter factory
```

## Verification

```bash
# Register a repo with git history
shadow repo add /path/to/repo --name test-repo

# Run observation
shadow observe --json
# Should return observations (commit_burst, file_hotspot, etc.)

# Teach a memory and search for it
shadow memory teach "deploy process" --body "Run npm build then npm deploy to staging"
shadow memory search "deploy"
# Should return the taught memory with BM25 rank

# Teach a core memory (permanent, no decay)
shadow memory teach "infra setup" --body "Production runs on GKE, us-central1" --layer core
shadow memory search "GKE"
# Should return the core memory

# Check observation records
shadow observe --repo <repoId> --json
# Should show new observations since last run

# Add a contact and a system
shadow contact add "Alice" --role "backend lead" --team platform --github alice
shadow system add "prod-api" --kind api --url https://api.example.com --health-check "curl -sf https://api.example.com/health"

# Focus mode
shadow focus 2h
shadow status     # should show focus mode active
shadow available  # exit focus mode

# Verify backend adapter selection
shadow config set backend agent-sdk
shadow status     # should show active backend
```
