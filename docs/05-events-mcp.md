# Phase 5 — Events + MCP

> **⚠️ Historical document** — This was the original v0.3 design spec. The implementation has evolved significantly. For current architecture see [CLAUDE.md](../CLAUDE.md) and [docs/README.md](README.md).

**Status: Not started**

## Goal

Give Shadow a voice and an API. The event system delivers notifications to the user at the
right time, respecting the proactivity level (1-10). The MCP server exposes Shadow's
capabilities as tools that other AI agents (including Claude Code) can invoke, and enables
auto-learning from interactions.

## Components

### 5.1 Event Queue

**File:** `src/events/queue.ts`

The event queue decouples "something happened" from "tell the user about it". This pattern
comes from Tam's `project_events.json` but is generalized for engineering events.

#### Event kinds

| Kind | Priority | Example |
|------|----------|---------|
| `trust_level_change` | 9 | "Shadow advanced to advisor (trust level 2)" |
| `observation_notable` | 7 | "Detected 15 commits in the last hour on repo X" |
| `suggestion_ready` | 6 | "New suggestion: consider extracting validation from handler.ts" |
| `run_completed` | 6 | "Run completed: fixed 3 lint errors in auth module" |
| `run_failed` | 8 | "Run failed: test suite exits with code 1" |
| `pattern_detected` | 5 | "You haven't committed today — unusual for a Tuesday" |
| `memory_insight` | 4 | "Consolidated 3 days of observations: test failures correlate with Friday deploys" |
| `consolidation_complete` | 3 | "Memory maintenance: promoted 2, demoted 5, expired 1" |
| `suggestion_expired` | 2 | "3 suggestions expired without response" |

#### Delivery logic — proactivity 1-10

Events are not delivered immediately. They wait in the queue until a delivery check
determines the right moment. Delivery is governed by the user's **proactivity level** (1-10),
which replaces the old quiet/moderate/eager labels.

```typescript
export type DeliveryDecision = {
  eventId: string;
  deliver: boolean;
  reason: string;
};

export function checkDelivery(
  events: EventRecord[],
  profile: UserProfileRecord,
  lastInteractionAt: string | null,
): DeliveryDecision[];
```

Delivery rules based on proactivity:

| Proactivity | Minimum priority | Behavior |
|-------------|-----------------|----------|
| 1-3 | >= 8 | Critical events only (trust changes, run failures) |
| 4-5 | >= 5 | Suggestions, notable observations, patterns |
| 6-7 | >= 3 | Insights, consolidation reports, patterns |
| 8-10 | all | Every event is delivered |

**Focus mode** forces proactivity to 1, which suppresses everything except critical
events (priority >= 8). This prevents Shadow from interrupting deep work sessions.

Activity-based batching still applies on top of proactivity filtering:

1. **User is active** (interaction in last 30 min): deliver eligible events immediately
2. **User is idle** (no interaction in 30 min - 4h): hold for next interaction
3. **User is away** (no interaction in >4h): batch all events for next session

#### CLI delivery

```bash
shadow events list
# Shows pending events, formatted by priority

shadow events ack
# Acknowledges all, marks as delivered
```

Events are also delivered via MCP notifications (see 5.3).

### 5.2 Event Types

**File:** `src/events/types.ts`

```typescript
export type ShadowEventKind =
  | 'trust_level_change'
  | 'observation_notable'
  | 'suggestion_ready'
  | 'run_completed'
  | 'run_failed'
  | 'pattern_detected'
  | 'memory_insight'
  | 'consolidation_complete'
  | 'suggestion_expired';

export type ShadowEventPayload = {
  // Common fields
  message: string;           // Human-readable summary
  detail?: string;           // Extended detail (markdown)

  // Type-specific fields
  trustLevel?: number;
  suggestionId?: string;
  runId?: string;
  repoId?: string;
  observationIds?: string[];
};
```

### 5.3 MCP Server

**Files:** `src/mcp/server.ts`, `src/mcp/stdio.ts`

Shadow exposes an MCP server that other AI agents can connect to. This allows Claude Code
(or any MCP-compatible client) to query Shadow's knowledge and trigger actions.

When configured as an MCP server, Shadow also passively logs interactions for auto-learning
(see section 5.6).

#### Design principles (from MCP best practices research)

1. **Read-only first.** All tools start as read-only. Write tools are gated by trust level.
2. **Small, focused tools.** Each tool does one thing well.
3. **Structured errors.** Every error returns `{ isError: true, message: "..." }`.
4. **Usage examples in descriptions.** Each tool includes example inputs/outputs.
5. **Minimum permissions.** MCP tools cannot bypass trust gates.

#### Tool catalog

##### Read-only tools (always available)

| Tool | Description | Parameters |
|------|------------|------------|
| `shadow_status` | Get Shadow's current state, trust level, and token usage summary | none |
| `shadow_repos` | List watched repositories | `{ filter?: string }` |
| `shadow_observations` | List recent observations | `{ repoId?: string, limit?: number }` |
| `shadow_suggestions` | List pending suggestions | `{ status?: string }` |
| `shadow_memory_search` | FTS5 memory search — context-aware, on-demand retrieval | `{ query: string, limit?: number }` |
| `shadow_profile` | Get user profile and trust info | none |
| `shadow_events` | Get pending events | none |
| `shadow_contacts` | List known team members | `{ filter?: string }` |
| `shadow_systems` | List known systems and infrastructure | `{ filter?: string }` |

> **Note:** `shadow_memory_hot` has been removed. No memory is auto-loaded at startup.
> All memory retrieval goes through `shadow_memory_search`, which uses SQLite FTS5 for
> ranked, on-demand lookups. This keeps the tool surface clean and avoids bloating context
> with potentially irrelevant memories.

##### Write tools (trust-gated)

| Tool | Required trust | Description | Parameters |
|------|---------------|------------|------------|
| `shadow_memory_teach` | 1 | Teach Shadow a fact to any layer including core | `{ title: string, body: string, layer?: string, scope?: string }` |
| `shadow_suggest_accept` | 1 | Accept a suggestion | `{ suggestionId: string }` |
| `shadow_suggest_dismiss` | 1 | Dismiss a suggestion | `{ suggestionId: string, note?: string }` |
| `shadow_observe` | 2 | Trigger observation on repos | `{ repoId?: string }` |
| `shadow_run_create` | 3 | Create and queue a run | `{ repoId: string, prompt: string }` |

#### Implementation

```typescript
import type { ShadowDatabase } from '../storage/index.js';
import type { ShadowConfig } from '../config/load-config.js';

export type McpTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (params: Record<string, unknown>) => Promise<unknown>;
};

export function createMcpTools(
  db: ShadowDatabase,
  config: ShadowConfig,
): McpTool[];

export function handleJsonRpcRequest(
  tools: McpTool[],
  request: unknown,
): Promise<unknown>;
```

#### JSON-RPC transport

```typescript
// src/mcp/stdio.ts
// Reads JSON-RPC messages from stdin, writes responses to stdout
// Follows the MCP specification for tool listing and invocation

export async function startStdioMcpServer(
  config: ShadowConfig,
): Promise<void>;
```

#### Example MCP interaction

```json
// Client -> Server (list tools)
{"jsonrpc": "2.0", "id": 1, "method": "tools/list"}

// Server -> Client
{"jsonrpc": "2.0", "id": 1, "result": {
  "tools": [
    {
      "name": "shadow_memory_search",
      "description": "Search Shadow's memory using FTS5. Returns ranked results with BM25 scoring. All memory retrieval goes through this tool.

Example: { \"query\": \"authentication testing\" }",
      "inputSchema": {
        "type": "object",
        "properties": {
          "query": { "type": "string", "description": "Search query" },
          "limit": { "type": "number", "description": "Max results (default 10)" }
        },
        "required": ["query"]
      }
    }
  ]
}}

// Client -> Server (call tool)
{"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {
  "name": "shadow_memory_search",
  "arguments": { "query": "deploy process" }
}}

// Server -> Client
{"jsonrpc": "2.0", "id": 2, "result": {
  "content": [
    {
      "type": "text",
      "text": "[{\"title\": \"deploy process\", \"body\": \"Run npm build then deploy\", \"rank\": 0.85}]"
    }
  ]
}}
```

### 5.4 Interactive Teaching

Shadow supports natural, conversational teaching through a dedicated command:

```bash
shadow teach
```

This spawns `claude --mcp-server shadow`, opening an interactive Claude session where Shadow
is available as an MCP server. The user can converse naturally, and Claude processes the
input — including links, docs, and repos — and uses `shadow_memory_teach` to store
knowledge in any memory layer, including core.

This is more natural than the direct CLI approach:

```bash
# Old way — rigid, one fact at a time
shadow memory teach "deploy process" --body "Run npm build then deploy to staging first"

# New way — conversational, can process complex inputs
shadow teach
# > "Here's our deploy runbook: https://wiki.internal/deploy
#    The key thing is we always deploy to staging first on Tuesdays,
#    and production on Thursdays. CI must be green."
# Claude reads the link, extracts facts, calls shadow_memory_teach for each one
```

### 5.5 CLI additions

| Command | Description |
|---------|------------|
| `shadow mcp serve` | Start MCP server over stdio |
| `shadow events list --priority <min>` | Filter events by minimum priority |
| `shadow teach` | Start interactive teaching session via Claude + MCP |
| `shadow usage [--period day\|week\|month]` | Show token usage from `llm_usage` table |

### 5.6 Auto-Learning via MCP

When Claude CLI (or any MCP client) has Shadow configured as an MCP server, Shadow
passively logs interactions in the `interactions` table. This enables automatic knowledge
acquisition without explicit user action.

#### How it works

1. **Logging:** Every MCP tool call is recorded in the `interactions` table, capturing
   the tool name, arguments, and context (active repo, files discussed, topics).
2. **Heartbeat analysis:** During the next heartbeat cycle, the LLM analyze phase reviews
   recent interactions and identifies learnable patterns.
3. **Memory creation:** The LLM creates or updates memories based on what it learns from
   the interaction log — topics discussed, repos worked on, files modified, preferences
   expressed.
4. **Core promotion:** If the LLM determines something is foundational (e.g., "user always
   uses vitest, never jest"), it promotes the memory to the core layer automatically.

#### Example flow

```
User in Claude Code:  "Fix the auth tests in shadow-api"
Claude calls:         shadow_memory_search({ query: "shadow-api auth tests" })
Claude calls:         shadow_repos({ filter: "shadow-api" })
Shadow logs:          interaction { tool: "shadow_memory_search", topic: "auth tests", repo: "shadow-api" }

... next heartbeat ...

LLM analyze phase:    "User is working on auth tests in shadow-api, they searched for
                       auth test patterns — this confirms testing is important to them"
LLM action:           shadow_memory_teach({ title: "shadow-api auth testing",
                       body: "User actively maintains auth test suite", layer: "project" })
```

### 5.7 Cost Tracking

Shadow tracks all LLM token usage in the `llm_usage` table. Users can review costs with:

```bash
shadow usage
# Shows today's token usage: input tokens, output tokens, estimated cost

shadow usage --period week
# Shows this week's usage breakdown by day

shadow usage --period month
# Shows this month's usage breakdown by week
```

This helps users understand and control the cost of Shadow's background operations
(heartbeats, observations, consolidation, runs).

### 5.8 Claude Code Integration

Users can add Shadow as an MCP server in their Claude Code config:

```json
// ~/.claude/settings.json
{
  "mcpServers": {
    "shadow": {
      "command": "npx",
      "args": ["shadow", "mcp", "serve"],
      "env": {
        "SHADOW_DATA_DIR": "~/.shadow"
      }
    }
  }
}
```

This allows Claude Code to:
- Query Shadow's memories when working on a repo via `shadow_memory_search`
- Check recent observations before making changes
- Review pending suggestions
- Teach Shadow new facts discovered during a coding session
- Browse known team members and systems

Auto-learning happens passively when Shadow is configured as an MCP server. Every tool
call Claude Code makes to Shadow is logged, and the next heartbeat cycle extracts learnable
knowledge from those interactions. No additional configuration is required beyond adding
the MCP server entry above.

## New files

```
src/events/queue.ts    # Delivery logic (proactivity 1-10 filtering)
src/events/types.ts    # Event kinds and payloads
src/mcp/server.ts      # MCP tool definitions and JSON-RPC handler
src/mcp/stdio.ts       # Stdio transport
src/mcp/interactions.ts # Interaction logging for auto-learning
```

## Verification

```bash
# Test event delivery with proactivity levels
shadow config set proactivity 3
shadow observe
shadow events list
# Should only show priority >= 8 events

shadow config set proactivity 7
shadow events list
# Should show priority >= 3 events

# Test MCP server
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | shadow mcp serve
# Should return tool catalog (no shadow_memory_hot, includes shadow_contacts and shadow_systems)

echo '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"shadow_status","arguments":{}}}' | shadow mcp serve
# Should return status including token usage summary

# Test interactive teaching
shadow teach
# Should open Claude session with Shadow as MCP server

# Test cost tracking
shadow usage --period week
# Should show token usage breakdown

# Test Claude Code integration
# Add shadow as MCP server in Claude Code settings
# In Claude Code session: "What does Shadow know about this repo?"
# Claude Code should invoke shadow_memory_search
# Check that the interaction was logged for auto-learning
```
