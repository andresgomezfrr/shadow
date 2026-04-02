# Phase 3 — Heartbeat + Profile

> **⚠️ Historical document** — This was the original v0.3 design spec. The implementation has evolved significantly. For current architecture see [CLAUDE.md](../CLAUDE.md) and [docs/README.md](README.md).

**Status: Not started**

## Goal

Give Shadow autonomous life between user interactions. The heartbeat is a periodic state
machine that observes repos, calls Claude to analyze patterns and generate suggestions,
and maintains memory. The profile system tracks user preferences and manages the trust
gradient.

## Components

### 3.1 Heartbeat State Machine

**File:** `src/heartbeat/state-machine.ts`

The heartbeat runs every `heartbeatIntervalMs` (default 15 minutes) and follows a
state machine with LLM-powered reasoning phases. The `observe` phase is programmatic
(free), while `analyze`, `suggest`, and `consolidate` call Claude via CLI or API backend.

**Smart heartbeat:** If no new observations have been created since the last heartbeat,
the analyze/suggest/consolidate phases are skipped entirely. No LLM calls are made, no
cost is incurred. Only the observe phase runs (programmatic, free).

#### Phases

```
wake --> observe --> analyze --> suggest --> consolidate --> notify --> idle
                 \-> idle         (no new observations — skip LLM phases entirely)
```

| Phase | What happens | LLM | Max duration |
|-------|-------------|-----|-------------|
| `wake` | Load config, profile, last heartbeat, pending events. Check if new observations exist since last heartbeat. | No | 100ms |
| `observe` | Run `observeAllRepos()`. Skip repos observed less than 5 min ago. Programmatic — always runs. | No | 30s |
| `analyze` | Build prompt with unprocessed observations + relevant memories (FTS5 lookup). Claude detects patterns and anomalies. | Yes — `config.models.analyze` (default Sonnet) | 30s |
| `suggest` | Build prompt with analysis results + user profile context. Claude generates nuanced suggestions (if trust >= 2). | Yes — `config.models.suggest` (default Opus) | 30s |
| `consolidate` | Build prompt with memory state. Claude reasons about memory promotion/demotion/expiration. Run every 6th heartbeat or daily. | Yes — `config.models.consolidate` (default Sonnet) | 30s |
| `notify` | Check event queue. If user recently active, mark high-priority events as deliverable. | No | 100ms |
| `idle` | Record heartbeat log. Compute next sleep duration. Record LLM token usage. | No | 50ms |

#### Models per phase

All models are user-configurable via `config.models`:

| Phase | Config key | Default | Rationale |
|-------|-----------|---------|-----------|
| analyze | `config.models.analyze` | Sonnet | Fast, cheap, sufficient for pattern detection |
| suggest | `config.models.suggest` | Opus | Quality matters for nuanced, context-rich proposals |
| consolidate | `config.models.consolidate` | Sonnet | Structured summarization does not require top-tier reasoning |

#### State machine implementation

```typescript
export type HeartbeatContext = {
  config: ShadowConfig;
  db: ShadowDatabase;
  profile: UserProfileRecord;
  lastHeartbeat: HeartbeatRecord | null;
  pendingEventCount: number;
  newObservationsSinceLastHeartbeat: boolean;
};

export type HeartbeatPhase =
  | 'wake' | 'observe' | 'analyze' | 'suggest'
  | 'consolidate' | 'notify' | 'idle';

export type HeartbeatResult = {
  id: string;
  phases: HeartbeatPhase[];
  observationsCreated: number;
  suggestionsCreated: number;
  memoriesPromoted: number;
  memoriesDemoted: number;
  eventsQueued: number;
  durationMs: number;
  llmCalls: number;
  tokensUsed: { input: number; output: number };
};

export async function runHeartbeat(ctx: HeartbeatContext): Promise<HeartbeatResult>;
```

#### Phase transition logic

```typescript
function nextPhase(current: HeartbeatPhase, ctx: PhaseContext): HeartbeatPhase | null {
  switch (current) {
    case 'wake':
      return 'observe';

    case 'observe':
      // Smart heartbeat: skip LLM phases if nothing new
      if (ctx.observationsCreated === 0 && !ctx.newObservationsSinceLastHeartbeat)
        return 'idle';
      if (ctx.observationsCreated > 0) return 'analyze';
      if (ctx.shouldConsolidate) return 'consolidate';
      return 'idle';

    case 'analyze':
      if (ctx.notableObservations > 0 && ctx.profile.trustLevel >= 2)
        return 'suggest';
      return ctx.shouldConsolidate ? 'consolidate' : 'notify';

    case 'suggest':
      return ctx.shouldConsolidate ? 'consolidate' : 'notify';

    case 'consolidate':
      return 'notify';

    case 'notify':
      return 'idle';

    case 'idle':
      return null; // end
  }
}
```

### 3.2 LLM Prompt Construction

**File:** `src/heartbeat/prompts.ts`

Each LLM phase builds a context-aware prompt. Prompts include relevant memories retrieved
via FTS5 full-text search based on the current observations, ensuring Claude has the
context it needs to reason well.

```typescript
// Build prompt for the analyze phase
// Retrieves memories relevant to observed changes via FTS5 search
export function buildAnalyzePrompt(
  observations: Observation[],
  relevantMemories: Memory[],
  profile: UserProfileRecord,
): { system: string; user: string };

// Build prompt for the suggest phase
// Includes analysis results, user preferences, and trust constraints
export function buildSuggestPrompt(
  analysis: AnalysisResult,
  relevantMemories: Memory[],
  profile: UserProfileRecord,
): { system: string; user: string };

// Build prompt for the consolidate phase
// Includes memory state, decay candidates, and promotion criteria
export function buildConsolidatePrompt(
  memoryState: MemoryConsolidationState,
  profile: UserProfileRecord,
): { system: string; user: string };

// FTS5 search for memories relevant to current observations
// Extracts key terms from observations, queries memory FTS index
export function retrieveRelevantMemories(
  db: ShadowDatabase,
  observations: Observation[],
  limit?: number,
): Memory[];
```

The personality level (see 3.5) is applied via the SOUL.md system prompt, injected into
each LLM call's system message.

### 3.3 Activity Implementations

**File:** `src/heartbeat/activities.ts`

Each phase delegates to a focused function. The analyze, suggest, and consolidate
activities call Claude with prompts built by `prompts.ts`:

```typescript
// Phase: observe (programmatic — no LLM)
export async function activityObserve(ctx: HeartbeatContext): Promise<{
  observationsCreated: number;
  reposObserved: string[];
}>;

// Phase: analyze (LLM — calls Claude with config.models.analyze)
export async function activityAnalyze(ctx: HeartbeatContext): Promise<{
  patternsDetected: number;
  profileUpdated: boolean;
  tokensUsed: { input: number; output: number };
}>;

// Phase: suggest (LLM — calls Claude with config.models.suggest)
export async function activitySuggest(ctx: HeartbeatContext): Promise<{
  suggestionsCreated: number;
  tokensUsed: { input: number; output: number };
}>;

// Phase: consolidate (LLM — calls Claude with config.models.consolidate)
export async function activityConsolidate(ctx: HeartbeatContext): Promise<{
  memoriesPromoted: number;
  memoriesDemoted: number;
  memoriesExpired: number;
  tokensUsed: { input: number; output: number };
}>;

// Phase: notify (programmatic — no LLM)
export async function activityNotify(ctx: HeartbeatContext): Promise<{
  eventsQueued: number;
}>;
```

### 3.4 Anti-Loop Rules

**File:** `src/heartbeat/anti-loop.ts`

Prevents wasteful or repetitive behavior. Adapted from Tam's anti-loop rules but
engineering-focused.

| Rule | Enforcement |
|------|------------|
| **Observation cooldown** | Min 5 minutes between observations of the same repo |
| **Suggestion rate limit** | Max 3 pending suggestions at any time. Skip `suggest` phase if at limit. |
| **Consolidation frequency** | At most once every 6 hours. Forced once daily (first heartbeat after 00:00). |
| **Suggestion expiry** | Suggestions older than 7 days without user response auto-expire. Generates a `preference` memory: "User ignores suggestions of kind X". |
| **Kind rotation** | If last 3 suggestions are the same `kind`, next must differ or skip. |
| **Idle escalation** | After 5 consecutive idle heartbeats (no observations), increase heartbeat interval by 2x (max 1 hour). Reset on first observation. |

```typescript
export type AntiLoopState = {
  lastObservedPerRepo: Map<string, string>;   // repoId -> ISO timestamp
  pendingSuggestionCount: number;
  lastConsolidationAt: string | null;
  recentSuggestionKinds: string[];            // last 3
  consecutiveIdleHeartbeats: number;
};

export function shouldObserveRepo(repoId: string, state: AntiLoopState): boolean;
export function shouldSuggest(state: AntiLoopState): boolean;
export function shouldConsolidate(state: AntiLoopState): boolean;
export function computeNextHeartbeatMs(config: ShadowConfig, state: AntiLoopState): number;
```

### 3.5 User Profile System

**File:** `src/profile/user-profile.ts`

The profile combines explicit user configuration (proactivity, personality) with
passively learned dimensions (work hours, energy, mood). All passive learning is
incremental — no single observation overwrites preferences.

#### Proactivity (1-10) — explicit config

Replaces the old `quiet/moderate/eager` enum. Set by user via `shadow config proactivity <N>`.

| Level | Mode | Behavior |
|-------|------|----------|
| 1 | Silent | No output. Shadow observes only. |
| 2-3 | Quiet | Only critical events (priority >= 8). Minimal interruption. |
| 4-5 | Moderate | Suggestions on notable observations. Periodic summaries. |
| 6-7 | Active | Insights, nudges, reminders. Contextual check-ins. |
| 8-9 | Eager | Proactive check-ins, unsolicited analysis, pattern alerts. |
| 10 | Full companion | Always-on presence. Comments on everything relevant. |

#### Personality (1-5) — explicit config

Set by user via `shadow config personality <N>`. Applied via SOUL.md in system prompts.

| Level | Style | Description |
|-------|-------|-------------|
| 1 | Purely technical | No personality. Raw data and analysis only. |
| 2 | Professional | Polished but impersonal. Corporate-friendly tone. |
| 3 | Friendly | Warm, approachable. Occasional humor. |
| 4 | Companion (default) | Tam-like presence. Knows the user, has opinions. |
| 5 | Full Tam | Maximum personality. Whimsical, opinionated, creative. |

**SOUL.md:** Located at `~/.shadow/SOUL.md`. User-customizable. Injected into all LLM
system prompts to shape Shadow's voice and personality at the selected level.

#### Temporal modes

Focus mode temporarily reduces proactivity and heartbeat frequency.

| Command | Effect |
|---------|--------|
| `shadow focus [duration]` | Set proactivity to 1. Optional duration: `"2h"`, `"until 14:00"`. |
| `shadow available` | Restore previous proactivity level. |

Stored in `user_profile`:

```typescript
{
  focus_mode: null | 'focus' | 'available';
  focus_until: string | null;  // ISO timestamp, null = indefinite
  focus_previous_proactivity: number | null;  // restore target
}
```

When focus mode is active, heartbeat frequency is also reduced (2x interval).

#### What Shadow learns (passive)

| Dimension | Source | Storage |
|-----------|--------|---------|
| Work hours | Commit timestamps aggregated over 14 days | `work_hours_json`: `{ "weekday": { "start": "09:00", "end": "18:00" }, "weekend": { "active": false } }` |
| Commit patterns | Git log analysis | `commit_patterns_json`: `{ "avgPerDay": 8, "style": "conventional", "avgSize": "small" }` |
| Preferred PR size | Accepted vs dismissed suggestions | `preferences_json.pr_size: "small"` |
| Energy | Interaction frequency and depth over time | `energy`: "low" / "normal" / "high" |
| Mood | Interaction sentiment patterns | `mood`: "neutral" / "focused" / "frustrated" / "exploratory" |
| Dislikes | Dismissed suggestions with notes | `dislikes_json`: `["auto-format suggestions", "large refactor proposals"]` |

#### Profile update function

```typescript
export type ProfileUpdate = {
  source: 'observation' | 'interaction' | 'suggestion-feedback' | 'explicit';
  field: string;
  value: unknown;
  confidence: number;  // 0-100
};

export function applyProfileUpdate(
  db: ShadowDatabase,
  update: ProfileUpdate,
): void;

// Recalculate trust level from trust score
export function recalculateTrustLevel(
  currentScore: number,
): { level: number; name: string };
```

### 3.6 Trust System

**File:** `src/profile/trust.ts`

Trust is a numeric score (0-100) mapped to 5 discrete levels. It grows through compound
positive interactions and decays through negative signals or inactivity.

#### Trust levels

| Level | Score | Name | Autonomy |
|-------|-------|------|----------|
| 1 | 0-15 | `observer` | Read-only. Report observations. Never modify code. No external communication. |
| 2 | 15-35 | `advisor` | Generate suggestions. Consolidate memory. No code changes. No external communication. |
| 3 | 35-60 | `assistant` | Execute `scope:small` tasks without approval. Others need confirmation. Can communicate with contacts via external MCP servers. |
| 4 | 60-85 | `partner` | Execute medium tasks. Auto-fix lint/type errors. Request approval for large changes. Can communicate with contacts via external MCP servers. |
| 5 | 85-100 | `shadow` | Create branches, propose PRs. Can communicate with contacts via external MCP servers. Only restriction: no push to main without approval. |

#### Trust score deltas

| Event | Delta | Rationale |
|-------|-------|-----------|
| User accepts suggestion | +2.0 | Direct positive signal |
| User converts suggestion to task | +3.0 | Strong trust signal |
| Run completes successfully | +1.5 | Shadow delivered value |
| User teaches memory | +1.0 | User invests in Shadow |
| Positive interaction sentiment | +0.5 | Micro-trust compound |
| User dismisses suggestion | -0.5 | Mild negative signal |
| User dismisses 3 in a row | -3.0 (additional) | Pattern of irrelevance |
| Run fails | -2.0 | Shadow broke something |
| User overrides/reverts Shadow's work | -5.0 | Trust violation |
| 7+ days without interaction | -1.0/day | Relationship decay |

#### Autonomy dial

Users can override per action type, independent of trust level:

```typescript
export type AutonomyOverride = {
  action: string;          // e.g., 'auto-fix-lint', 'create-branch', 'run-tests'
  allowed: boolean;        // true = allow regardless of trust, false = block
  minTrustLevel?: number;  // override the default required trust level
};

// Stored in user_profile.preferences_json.autonomy_overrides
```

Example: user at trust level 2 can allow `run-tests` (normally level 3) while blocking
`create-branch` (normally level 3).

```typescript
export function isActionAllowed(
  action: string,
  profile: UserProfileRecord,
): { allowed: boolean; reason: string };
```

### 3.7 Cost Tracking

**File:** `src/llm/usage.ts`

Every LLM call records token usage in the `llm_usage` table for transparency and
budget control.

```sql
CREATE TABLE llm_usage (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  source TEXT NOT NULL,          -- 'analyze' | 'suggest' | 'consolidate' | 'chat' | ...
  model TEXT NOT NULL,           -- e.g. 'claude-sonnet-4-20250514'
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL
);
```

```typescript
export function recordLLMUsage(
  db: ShadowDatabase,
  source: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
): void;

export function getUsageSummary(
  db: ShadowDatabase,
  since?: string,  // ISO timestamp, default last 30 days
): {
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  bySource: Record<string, { calls: number; input: number; output: number }>;
  byModel: Record<string, { calls: number; input: number; output: number }>;
};
```

CLI: `shadow usage` displays a summary table with per-source and per-model breakdowns.

### 3.8 Daemon Runtime

**File:** `src/daemon/runtime.ts`

Adapted from Sidecar's daemon pattern with a dual-tick architecture.

#### Dual tick

| Tick type | Interval | What it does |
|-----------|----------|-------------|
| **Fast tick** | `daemonPollIntervalMs` (30s) | Process queued runs, deliver pending events |
| **Heartbeat tick** | `heartbeatIntervalMs` (15 min) | Run full heartbeat state machine |

#### Adaptive sleep

Same exponential backoff as Sidecar:

```typescript
function computeSleepMs(timing: DaemonTiming, worked: boolean, idleTicks: number): number {
  if (worked) return timing.activeSleepMs;      // 5s when active
  const multiplier = Math.min(idleTicks, 4);     // max 4x backoff
  return Math.min(
    timing.idleSleepMs * multiplier,
    timing.maxIdleSleepMs,                       // cap at 120s
  );
}
```

#### Daemon state persistence

```typescript
type DaemonState = {
  pid: number | null;
  startedAt: string | null;
  lastHeartbeatAt: string | null;
  lastTickAt: string | null;
  nextHeartbeatAt: string | null;
  lastHeartbeatPhase: string | null;
  lastConsolidationAt: string | null;
  consecutiveIdleTicks: number;
  currentSleepMs: number | null;
  pendingEventCount: number;
};
```

Stored as `~/.shadow/daemon.json`. PID file at `~/.shadow/daemon.pid`.

#### CLI commands

| Command | Description |
|---------|------------|
| `shadow daemon start` | Start background daemon (detached child process) |
| `shadow daemon stop` | Stop daemon (SIGTERM via PID file) |
| `shadow daemon status` | Show daemon state (running, last heartbeat, sleep) |

## New files

```
src/heartbeat/state-machine.ts   # Phase transitions, smart heartbeat skip
src/heartbeat/activities.ts      # Phase implementations (LLM calls for analyze/suggest/consolidate)
src/heartbeat/prompts.ts         # Prompt construction, FTS5 memory retrieval
src/heartbeat/anti-loop.ts       # Rate limiting, rotation
src/profile/user-profile.ts      # Profile: explicit config + passive learning
src/profile/trust.ts             # Trust gradient + autonomy dial
src/llm/usage.ts                 # Cost tracking, token recording
src/daemon/runtime.ts            # Daemon loop, dual tick, adaptive sleep
```

## Verification

```bash
# Start daemon
shadow daemon start
shadow daemon status
# Should show: running, pid, nextHeartbeatAt

# Wait for a heartbeat cycle (or trigger manually)
shadow daemon status --json
# Should show lastHeartbeatPhase, observations created, tokensUsed

# If no new observations, heartbeat should skip LLM phases
# Check logs: "No new observations since last heartbeat — skipping LLM phases"

# Check trust
shadow profile trust
# Should show trust level 1, score 0

# Accept a suggestion to increase trust
shadow suggest accept <id>
shadow profile trust
# Trust score should have increased by 2.0

# Check LLM cost
shadow usage
# Should show per-source and per-model token usage

# Adjust proactivity
shadow config proactivity 7
# Should show: proactivity set to 7 (Active)

# Adjust personality
shadow config personality 4
# Should show: personality set to 4 (Companion)

# Enter focus mode
shadow focus 2h
shadow daemon status
# Should show: focus mode active, proactivity 1, heartbeat interval doubled

# Exit focus mode
shadow available
# Should show: proactivity restored to 7

# Stop daemon
shadow daemon stop
shadow daemon status
# Should show: not running
```
