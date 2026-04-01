# Phase 4 — Suggestion Lifecycle + Runner

**Status: Not started**

## Goal

Manage the lifecycle of LLM-generated suggestions and execute approved work. In v0.3,
suggestion **generation** moved to Phase 3 (the heartbeat's `suggest` phase). Phase 4
is responsible for suggestion **lifecycle management** (accept, dismiss, snooze, expire)
and **task execution** via backend adapters built in Phase 2.

## Architecture overview

```
Phase 3 (heartbeat)          Phase 4 (this phase)
┌──────────────────┐         ┌──────────────────────────────┐
│ suggest phase    │         │ Suggestion lifecycle         │
│ (LLM-powered)   │──writes──▶  accept → create run        │
│                  │         │  dismiss → record feedback   │
│ Claude analyzes: │         │  snooze → postpone           │
│ - observations   │         │  expire → 7-day auto-expire  │
│ - profile        │         ├──────────────────────────────┤
│ - history        │         │ Runner service               │
│ - web search     │         │  claim → build pack → exec   │
└──────────────────┘         │  → post-process              │
                             └──────────────────────────────┘
                                        │
                             Phase 2 backend adapters
                             ┌──────────────────────────────┐
                             │ cli (default) │ api          │
                             └──────────────┴──────────────┘
```

## 100% LLM-generated suggestions

There is no rule-based suggestion engine. Claude analyzes observations, user profile,
and historical feedback, then proposes improvements. Claude can also search the internet
for better ideas (e.g., newer library versions, known bug patterns, community best
practices).

The LLM prompt for generation (built in Phase 3) includes:
- Unprocessed observations grouped by repo and kind
- User profile preferences and work patterns
- Historical suggestion feedback (accepted/dismissed patterns)
- Relevant memories via context-aware FTS5 search

### Suggestion kinds

The LLM produces suggestions classified into these kinds:

| Kind | Description | Example suggestion |
|------|-------------|-------------------|
| `refactor` | Code structure improvements | "src/api/handler.ts has been modified in 12 of the last 20 commits. Consider extracting the validation logic." |
| `test` | Test coverage or flaky test fixes | "Tests for the auth module have failed 3 times this week. Consider adding a regression test." |
| `docs` | Documentation improvements | "You added 3 new API endpoints but didn't update the README. Consider documenting them." |
| `cleanup` | Stale branches, forgotten stashes | "Branch feature/old-auth has no commits in 30 days. Consider deleting it." |
| `dependency` | Dependency updates or issues | "package.json was updated but lock file wasn't regenerated." |
| `workflow` | Development process improvements | "You've been committing directly to main. Consider using feature branches." |
| `habit` | Productivity patterns | "You typically commit 8 times/day but haven't committed today. Starting a session?" |

The LLM is not limited to these kinds but uses them as a classification taxonomy.
It can also propose entirely new feature ideas, bug reports, or architectural improvements.

## Components

### 4.1 Suggestion Lifecycle Manager

**File:** `src/suggestion/lifecycle.ts`

Manages the state transitions of suggestions after they are created by Phase 3.

#### Lifecycle states

```
pending → accepted → run created
pending → dismissed → feedback recorded
pending → snoozed → re-pending (after snooze period)
pending → expired (auto, after 7 days without response)
```

```typescript
export type SuggestionAction = 'accept' | 'dismiss' | 'snooze' | 'expire';

export class SuggestionLifecycleManager {
  constructor(
    private readonly db: ShadowDatabase,
  ) {}

  accept(suggestionId: string): RunRecord;
  dismiss(suggestionId: string, reason?: string): void;
  snooze(suggestionId: string, untilDate: string): void;
  expireStale(): number; // returns count of expired suggestions
}
```

#### Accept

Creates a run from the suggestion. The run inherits the suggestion's repo scope
(which may span multiple repos).

#### Dismiss

Records feedback including the optional reason. This feedback is injected into
future LLM prompts to prevent suggesting similar things. Stored in
`user_profile.preferences_json.suggestion_feedback`.

#### Snooze

Postpones the suggestion until a specified date. The suggestion returns to `pending`
state when the snooze period expires.

#### Expire

Suggestions without a response for 7 days are auto-expired. The heartbeat runs
`expireStale()` periodically.

#### Historical feedback loop

Accepted and dismissed patterns are tracked per suggestion kind and per repo. This
history is included in the Phase 3 LLM prompt so Claude learns the user's preferences
over time:

```typescript
export type SuggestionFeedback = {
  kind: string;
  repoIds: string[];
  action: 'accepted' | 'dismissed';
  reason?: string;
  timestamp: string;
};
```

### 4.2 Multi-repo suggestions and runs

A suggestion can span multiple repositories, and the resulting run operates across
all of them.

#### Schema changes

```sql
-- suggestions table
suggestions.repo_ids_json TEXT  -- JSON array of repo IDs, e.g. ["repo-1", "repo-2"]

-- runs table
runs.repo_ids_json TEXT         -- JSON array of repo IDs
```

#### ObjectivePack

```typescript
export type RepoPack = {
  id: string;
  name: string;
  path: string;   // absolute path on disk
};

export type ObjectivePack = {
  runId: string;
  repos: RepoPack[];              // array of repos, not single repo
  suggestionId: string | null;
  title: string;
  goal: string;
  prompt: string;
  relevantMemories: MemoryRecord[];  // context-aware FTS5 search results
  artifactDir: string;
};
```

Claude CLI receives absolute paths and can edit files in any of the involved repos.

### 4.3 Runner Service

**File:** `src/runner/service.ts`

Executes approved tasks by delegating to a backend adapter (built in Phase 2).
Follows the pattern: claim run, build objective pack, execute, post-process.

#### Run lifecycle

```
queued -> claimed -> running -> completed | failed
```

```typescript
export class RunnerService {
  constructor(
    private readonly config: ShadowConfig,
    private readonly db: ShadowDatabase,
    private readonly adapter: BackendAdapter,  // from Phase 2
  ) {}

  processNextRun(runnerId?: string): {
    processed: boolean;
    run: RunRecord | null;
  };
}
```

#### Runner model

The model used for task execution is configurable:

```typescript
// config
{
  models: {
    runner: "claude-sonnet-4-6"  // default
  }
}
```

This is separate from the model used for suggestion generation in Phase 3.

### 4.4 Prompt Construction

**File:** `src/runner/prompts.ts`

Builds the prompt sent to the backend adapter for task execution.

```typescript
function buildPrompt(
  pack: ObjectivePack,
  profile: UserProfileRecord,
  config: ShadowConfig,
): string;
```

The prompt includes:

1. **Relevant memories** — context-aware FTS5 search based on the task goal and
   involved repos. NOT all hot memories; only the ones relevant to the task.
2. **Repo context** — for each repo in `pack.repos`: absolute path, detected
   languages, current branch, recent activity.
3. **Personality level** — adjusts the tone of the output based on the user's
   configured personality setting.
4. **Task goal and constraints** — what to accomplish and boundaries (e.g., no
   commits, smallest useful change).

```typescript
function buildPrompt(
  pack: ObjectivePack,
  profile: UserProfileRecord,
  config: ShadowConfig,
): string {
  const memorySection = pack.relevantMemories
    .map(m => `- ${m.title}: ${m.bodyMd}`)
    .join('\n');

  const repoSection = pack.repos
    .map(r => `- ${r.name}: ${r.path} (${r.languages?.join(', ') ?? 'unknown'})`)
    .join('\n');

  const personality = config.personalityLevel ?? 'neutral';

  return [
    `You are an engineering assistant.`,
    `Personality: ${personality}`,
    '',
    `## Repositories`,
    repoSection,
    '',
    `## Relevant context`,
    memorySection || '(No relevant memories)',
    '',
    `## Task`,
    `Title: ${pack.title}`,
    `Goal: ${pack.goal}`,
    '',
    `## Constraints`,
    `- Make the smallest useful change that satisfies the goal.`,
    `- Work directly in the repository working tree.`,
    `- Do not create commits or push anything.`,
    `- Print a concise summary of what changed.`,
  ].join('\n');
}
```

### 4.5 Backend Adapters (built in Phase 2)

Backend adapters are defined and implemented in Phase 2. Phase 4 consumes them.

**Files (Phase 2):** `src/backend/types.ts`, `src/backend/claude-cli.ts`,
`src/backend/agent-sdk.ts`, `src/backend/index.ts`

#### Backend interface

```typescript
export interface BackendAdapter {
  readonly kind: string;
  execute(pack: ObjectivePack): Promise<BackendExecutionResult>;
  doctor(): Promise<Record<string, unknown>>;
}

export type BackendExecutionResult = {
  status: 'success' | 'failure' | 'timeout' | 'interrupted';
  exitCode: number | null;
  startedAt: string;
  finishedAt: string;
  output: string;
  summaryHint: string | null;
  tokenUsage?: { input: number; output: number };
};
```

#### `cli` backend (default)

Uses the `claude` CLI with the user's logged-in session. No API key needed.

```typescript
// spawnSync('claude', ['--print', prompt], { cwd: workingDirectory })
```

#### `api` backend

Uses `@anthropic-ai/agent-sdk` with `ANTHROPIC_API_KEY`. Provides hooks,
streaming, subagents, and structured output.

#### Adapter selection

Selection is based on the explicit `config.backend` setting (not auto-detection):

```typescript
export function selectAdapter(config: ShadowConfig): BackendAdapter {
  if (config.backend === 'api') {
    return new AgentSdkAdapter(config);
  }
  // Default: cli
  return new ClaudeCliAdapter(config);
}
```

### 4.6 Post-processing

After a run completes:

1. **Capture git outcome**: `git diff --stat`, changed files, branch name
2. **Write artifacts**: `summary.md`, `backend-result.json` to `~/.shadow/artifacts/runs/<runId>/`
3. **Update trust**: successful run -> +1.5, failed run -> -2.0
4. **Extract memories**: LLM extracts patterns worth remembering from the run output (not rule-based extraction)
5. **Mark suggestion as executed**: if the run was triggered by a suggestion
6. **Create audit event**: record the full execution trace

### 4.7 Cost Tracking

Each run records token usage in the `llm_usage` table:

```sql
CREATE TABLE llm_usage (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

This allows users to track cost per run and aggregate cost over time.

### 4.8 CLI additions

| Command | Description |
|---------|------------|
| `shadow suggest list` | List pending suggestions |
| `shadow suggest accept <id>` | Accept a suggestion and create a run |
| `shadow suggest dismiss <id>` | Dismiss a suggestion with optional reason |
| `shadow suggest snooze <id> --until <date>` | Snooze a suggestion |
| `shadow run create --repos <id,...> --prompt "..."` | Manually create a run (multi-repo) |
| `shadow run list` | List recent runs |
| `shadow run view <id>` | View run detail, result, and cost |
| `shadow runner once` | Process next queued run (manual trigger) |

## New files

```
src/suggestion/lifecycle.ts    # Suggestion lifecycle management
src/runner/service.ts          # Run executor
src/runner/prompts.ts          # Prompt construction for runs
```

## Verification

```bash
# Register repos
shadow repo add /path/to/repo-a
shadow repo add /path/to/repo-b

# Run heartbeat to generate suggestions (Phase 3)
shadow heartbeat once
shadow suggest list --json
# Should show LLM-generated suggestions, possibly spanning multiple repos

# Accept a suggestion and create a run
shadow suggest accept <id>
shadow run list
# Should show a queued run with repo_ids_json

# Execute the run
shadow runner once --json
# Should show execution result with token usage

# Check artifacts
ls ~/.shadow/artifacts/runs/<runId>/
# Should contain summary.md, backend-result.json

# Check cost tracking
shadow run view <runId>
# Should show token usage and cost estimate

# Check trust after successful run
shadow profile trust
# Trust score should have increased

# Dismiss a suggestion and verify feedback loop
shadow suggest dismiss <id> --reason "not relevant"
shadow heartbeat once
shadow suggest list --json
# Future suggestions should avoid similar patterns
```
