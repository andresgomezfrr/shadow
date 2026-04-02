# Phase 6+ — Future Roadmap

> **⚠️ Historical document** — This was the original v0.3 design spec. The implementation has evolved significantly. For current architecture see [CLAUDE.md](../CLAUDE.md) and [docs/README.md](README.md).

**Status: Not started**

## Overview

Post-MVP enhancements that extend Shadow from a CLI tool into a comprehensive engineering
companion platform. Each item is independent and can be prioritized based on user need.

Note: basic multi-repo correlation (suggestions and runs across repos) is already part of
the core architecture (Phases 2-4). Items here cover deeper analysis and new capabilities
beyond what the MVP provides.

---

## 6.1 Semantic Search with sqlite-vec

**Priority:** P1 — significantly improves memory retrieval quality

### Problem

FTS5 (Phase 2) provides keyword-based search with BM25 ranking. This works well for exact
term matches but fails when the user asks conceptually related questions. Example:
searching for "login flow" won't find a memory titled "authentication handler refactoring".

### Solution

Add sqlite-vec for vector similarity search alongside FTS5, creating a hybrid retrieval
system.

#### Architecture

```
User query: "how does the login work?"
           |
     +-----+-----+
     |           |
   FTS5        sqlite-vec
   (keyword)   (semantic)
     |           |
   BM25 rank   cosine similarity
     |           |
     +-----+-----+
           |
     Reciprocal Rank Fusion (RRF)
           |
     Merged results
```

#### Implementation

```sql
-- New migration: add vector column to memories
CREATE VIRTUAL TABLE IF NOT EXISTS memories_vec USING vec0(
  embedding float[384]   -- MiniLM-L6-v2 dimension
);
```

Embedding generation options (no external service required):
1. **sqlite-lembed** with Snowflake Arctic Embed 1.5 (all in-process)
2. **llama.cpp** local inference (separate process)
3. **Ollama** local API (if already running)

#### Hybrid search function

```typescript
export function hybridSearch(
  db: ShadowDatabase,
  query: string,
  options?: { limit?: number; repoId?: string },
): MemorySearchResult[] {
  // 1. FTS5 keyword search -> ranked results
  // 2. Vector similarity search -> ranked results
  // 3. Reciprocal Rank Fusion to merge
  // 4. Return top-N
}
```

#### References

- [Hybrid full-text and vector search with SQLite](https://alexgarcia.xyz/blog/2024/sqlite-vec-hybrid-search/index.html)
- [Building a RAG on SQLite](https://blog.sqlite.ai/building-a-rag-on-sqlite)
- [sqlite-memory](https://github.com/sqliteai/sqlite-memory)

---

## 6.2 Memory Consolidation Improvements

**Priority:** P1 — improves long-term memory quality

### Overview

Port Tam's `memory_consolidate.py` concept to Shadow. Periodically analyze recent memories
to extract meta-patterns and create higher-level reflections.

#### Consolidation process

1. Read last N days of observations, interactions, and heartbeat logs
2. Extract recurring themes (files, error types, suggestion kinds)
3. Detect sentiment trends from interactions
4. Identify cross-repo patterns
5. Create `reflection` memories summarizing findings
6. Demote low-value memories that are superseded by reflections

#### Schedule

Runs as the `consolidate` phase of the heartbeat, at most once every 6 hours. Forced daily
during the first heartbeat after midnight.

---

## 6.3 Communication (Slack/Email via MCP)

**Priority:** P1 — enables Shadow to interact with colleagues on behalf of the user

### Problem

Developers frequently need to notify colleagues about code changes, ask questions about
shared modules, or follow up on reviews. Switching context to Slack or email interrupts
flow.

### Solution

Shadow communicates with colleagues via external MCP servers (Slack MCP, email MCP).
Requires trust >= 3 to use. All messages are logged in `audit_events`.

#### Flow

```
User: "Tell Maria the auth migration is ready for review"
           |
     Shadow looks up "Maria" in contacts table
           |
     Finds preferred_channel='slack', slack_id='U04ABC123'
           |
     Invokes Slack MCP server's send_message tool
           |
     Message sent, logged in audit_events
           |
     Shadow confirms to user: "Sent Slack message to Maria"
```

#### Data model

The `contacts` table stores colleague information:

```sql
CREATE TABLE contacts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  preferred_channel TEXT NOT NULL,  -- 'slack' | 'email'
  slack_id TEXT,
  email TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

#### Trust gate

- Trust < 3: Shadow refuses to send messages, suggests the user do it manually
- Trust >= 3: Shadow sends messages via the appropriate MCP server
- All messages are logged in `audit_events` with `event_kind='message_sent'`

#### External MCP servers

- **Slack MCP**: Connects to Slack workspace, exposes `send_message`, `read_channel` tools
- **Email MCP**: Connects to email provider, exposes `send_email` tool

---

## 6.4 Log Analysis

**Priority:** P2 — low effort, leverages existing heartbeat infrastructure

### Problem

Developers often miss error spikes or anomalies in application logs until they escalate
into production issues.

### Solution

Shadow can be taught log file paths. During the heartbeat observe phase, it scans log
files for patterns (error spikes, anomalies). Observations are created with
`source_kind='log'`. The LLM analyzes these observations during the analyze phase.

#### Configuration

```bash
shadow config set log_paths "/var/log/myapp/*.log,./logs/dev.log"
```

#### Observation flow

1. **Observe phase**: Scan configured log files since last heartbeat
2. Detect patterns: error count spikes, new exception types, repeated warnings
3. Create observations with `source_kind='log'`
4. **Analyze phase**: LLM reviews log observations alongside code observations
5. Generate suggestions when log patterns correlate with recent code changes

---

## 6.5 Infrastructure Monitoring

**Priority:** P2 — low effort, uses existing systems table

### Problem

Developers working on services need visibility into whether their systems are healthy,
but checking dashboards or health endpoints manually breaks flow.

### Solution

The `systems` table already has a `health_check` field. During the heartbeat, Shadow can
check the health of registered systems and create observations with
`source_kind='system'`.

#### Flow

1. User registers a system with a health check URL:
   ```bash
   shadow system add my-api --health-check "http://localhost:3000/health"
   ```
2. During heartbeat observe phase, Shadow pings health check endpoints
3. Creates observations with `source_kind='system'`
4. LLM correlates system health with recent code changes
5. Suggests rollback or investigation when health degrades after a deploy

---

## 6.6 Web Panel

**Priority:** P2 — valuable for visualization but CLI is sufficient for v1

### Overview

A local web dashboard for reviewing Shadow's state, browsing suggestions, and managing
memory. Same pattern as Sidecar's web panel: token-gated, React + Vite.

#### Pages

| Route | Content |
|-------|---------|
| `/` | Dashboard: trust level, recent observations, pending suggestions |
| `/repos` | Watched repos, last observed, observation count |
| `/suggestions` | Suggestion inbox with accept/dismiss/snooze actions |
| `/memory` | Memory browser by layer, with FTS5 search |
| `/profile` | User profile, trust history, autonomy settings |
| `/heartbeats` | Heartbeat log with phase visualization |
| `/runs` | Run history with artifact links |
| `/events` | Event timeline |

#### Stack

- React 19 + Vite
- Tailwind CSS for styling
- Chart.js or similar for trust/activity graphs
- Token-gated auth (same as Sidecar)

#### CLI

```bash
shadow web serve              # Start web panel on localhost:4319
shadow web serve --port 8080  # Custom port
```

---

## 6.7 Natural Language Mode (`shadow ask`)

**Priority:** P2 — lower effort than originally estimated since Shadow is already 100% LLM-based

### Overview

Allow users to interact with Shadow using natural language instead of structured commands:

```bash
shadow ask "what have I been working on this week?"
shadow ask "any suggestions for the auth module?"
shadow ask "remember that I prefer small PRs"
```

#### Implementation

Since Shadow is already entirely LLM-based, `shadow ask` simply builds a prompt with
relevant context (recent observations, memories, profile) and sends it to Claude. There is
no separate "agent mode" needed — it is a thin wrapper that assembles context and calls the
same LLM backbone.

```typescript
export async function handleAsk(
  db: ShadowDatabase,
  config: ShadowConfig,
  input: string,
): Promise<string> {
  // 1. Parse intent from input
  // 2. Gather relevant context: recent observations, memories, profile
  // 3. Build prompt with context + user question
  // 4. Send to Claude
  // 5. Return response
}
```

The agent has access to all MCP tools and can chain them:
1. User: "what should I focus on today?"
2. Shadow: searches recent observations, checks pending suggestions, reviews profile
   work patterns, and synthesizes a prioritized answer

---

## 6.8 Deep Cross-Repo Analysis

**Priority:** P3 — basic multi-repo correlation is in MVP; this covers advanced patterns

### Problem

The MVP handles multi-repo suggestions and runs, but deeper analysis across repositories
can reveal structural patterns that are invisible when looking at repos in isolation.

### Solution

Advanced cross-repo analysis beyond what the MVP provides:

```typescript
export type DeepCrossRepoPattern = {
  kind: 'dependency_chain' | 'shared_hotspot' | 'style_inconsistency' | 'version_drift';
  repos: string[];
  title: string;
  detail: string;
  severity: 'info' | 'warning' | 'critical';
};

export function detectDeepCrossRepoPatterns(
  db: ShadowDatabase,
): DeepCrossRepoPattern[];
```

Advanced patterns:
- **Dependency chain**: repo A depends on repo B, and a breaking change in B affects A
  (detected via import analysis and version comparison)
- **Shared hotspot**: same file pattern modified frequently in multiple repos, suggesting
  shared abstractions that should be extracted
- **Style inconsistency**: different conventions across repos (tabs vs spaces, naming
  patterns, test structure) that should be unified
- **Version drift**: shared dependencies at different versions across repos

---

## 6.9 CI/CD Integration

**Priority:** P3 — natural extension for engineering workflows

### Concept

Shadow runs as a GitHub Action or CI step:

```yaml
# .github/workflows/shadow.yml
name: Shadow Check
on: [push, pull_request]
jobs:
  shadow:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npx shadow observe --json
      - run: npx shadow suggest list --json
```

This enables:
- Automated observation on every push
- PR comments with Shadow's suggestions
- Trust score visible in CI badges

#### References

- [GitHub Agentic Workflows](https://www.infoq.com/news/2026/02/github-agentic-workflows/)
- [Copilot Coding Agent Architecture](https://itnext.io/github-copilot-coding-agent-the-complete-architecture-behind-agentic-devops-at-enterprise-scale-1f42c1c132aa)

---

## 6.10 Git-Native Memory Branches

**Priority:** P3 — interesting for transparency but adds complexity

### Concept (from research)

Instead of storing all memory in SQLite only, Shadow could maintain a git branch
(`shadow/memory`) in each watched repo that contains:
- Markdown files with repo-specific memories
- A `shadow.json` with observation history
- Suggestion logs

This makes Shadow's knowledge transparent and version-controlled. Users can review what
Shadow knows about their repo by checking the branch.

#### References

- [gitagent: git-native standard for defining AI agents](https://github.com/open-gitagent/gitagent)
- [GitHub Agentic Workflows](https://github.blog/ai-and-ml/automate-repository-tasks-with-github-agentic-workflows/)

---

## 6.11 Team Shadow (Multi-User)

**Priority:** P4 — requires significant architecture changes

### Concept

Multiple developers share a Shadow instance. Each has their own profile and trust level,
but they share repo observations and memory.

#### Changes required

- `user_profile` table: multiple rows (one per user)
- Authentication: who is running the command?
- Trust isolation: each user's trust is independent
- Memory scoping: `personal` memories are user-specific, `repo` memories are shared
- Suggestion targeting: some suggestions are user-specific

---

## 6.12 Plugin System

**Priority:** P4 — only needed when community wants to extend Shadow

### Concept

Allow users to define custom observation kinds, suggestion rules, and memory types via
plugins:

```typescript
// ~/.shadow/plugins/custom-check.ts
export default {
  name: 'security-audit',
  observationKind: 'security_issue',
  detect: (repo: RepoRecord) => {
    // Custom detection logic
  },
  suggest: (observations: ObservationRecord[]) => {
    // Custom suggestion generation
  },
};
```

---

## Implementation Priority Matrix

| Feature | Impact | Effort | Priority |
|---------|--------|--------|----------|
| Semantic search (6.1) | High | Medium | P1 |
| Memory consolidation improvements (6.2) | Medium | Low | P1 |
| Communication — Slack/email via MCP (6.3) | High | Medium | P1 |
| Log analysis (6.4) | Medium | Low | P2 |
| Infrastructure monitoring (6.5) | Medium | Low | P2 |
| Web panel (6.6) | Medium | High | P2 |
| Natural language mode — `shadow ask` (6.7) | Medium | Low | P2 |
| Deep cross-repo analysis (6.8) | Medium | Medium | P3 |
| CI/CD integration (6.9) | Medium | Low | P3 |
| Git-native branches (6.10) | Low | Medium | P3 |
| Team Shadow — multi-user (6.11) | Low | High | P4 |
| Plugin system (6.12) | Low | High | P4 |
