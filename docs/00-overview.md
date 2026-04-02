# Shadow v0.3 — Architecture Overview

> **⚠️ Historical document** — This was the original v0.3 design spec. The implementation has evolved significantly. For current architecture see [CLAUDE.md](../CLAUDE.md) and [docs/README.md](README.md).

## Vision

Shadow is a **full engineering teammate** — not just a repo watcher. It knows your code,
your infrastructure, your team, and you personally. It runs as a **global instance** with
no dependency on the current working directory; it can reason across multiple repos,
systems, and contacts simultaneously.

**Core thesis**: current AI coding tools are either cold utilities (run command, get output)
or novelty companions (personality without substance). Shadow bridges both: it is useful
first and warm second. The personality is the interface, not the product.

**Key shift in v0.3**: Shadow is **100% LLM-based**. There is no rule-based analysis engine.
Claude (via CLI or API) is the brain. Shadow is the **persistence and observation layer** —
it collects context, manages memory, and orchestrates when and how the LLM is invoked.

## Heritage

Shadow inherits from two projects:

| Source | What it provides |
|--------|-----------------|
| **Engineering Sidecar** | SQLite storage with migrations, daemon with adaptive sleep, runner with objective packs, backend adapter pattern, CLI via Commander.js, MCP server, application services facade |
| **Tam** | Layered memory with consolidation, heartbeat as state machine, user profile that evolves over time, trust/bond gradient, event queue for decoupled notifications, anti-loop rules |

## Design Principles

1. **Useful before warm.** Every feature must deliver engineering value. Personality is how
   Shadow communicates, not what it does.

2. **100% LLM-based.** No rule-based analysis. Claude is the brain for every analytical task
   (analyze, consolidate, suggest). Shadow provides persistence, observation, and orchestration.

3. **Observe before acting.** Shadow watches repositories and learns patterns before making
   suggestions. It earns trust through accurate observations, not by asking for permission.

4. **Global instance, multi-repo.** Shadow is not tied to a single directory. Suggestions,
   runs, and objectives span multiple repositories. The user has one Shadow, not one per project.

5. **Local-first, no external services required.** SQLite for structured data, FTS5 for
   full-text search, optional sqlite-vec for semantic search later. No Redis, no Postgres,
   no cloud vector database.

6. **Append-only audit trail.** Every observation, suggestion, and action is recorded.
   Shadow can explain why it made any recommendation by tracing back through its event log.

7. **Small surface, deep roots.** Start with CLI + daemon. Add MCP, then web. Each
   interface is a thin layer over the same application services.

## Architecture Layers

```
                              USER
                               |
                 +-------------+-------------+
                 |             |             |
              CLI (P1)     MCP (P5)      Web (P6+)
                 |             |             |
                 +------+------+-------------+
                        |
                 Application Services
                 (facade over all subsystems)
                        |
       +--------+-------+-------+--------+-----------+
       |        |       |       |        |           |
   Observation  Memory  Profile  Suggestion  Systems  Contacts
     Engine    System   System    Engine    Registry  Registry
       |        |       |        |           |         |
       +--------+---+---+--------+-----------+---------+
                    |
                  SQLite
              (single file DB)
                    |
       +------------+-----------+-----------+
       |            |           |           |
     Tables     FTS5 Index   Audit Log  llm_usage
   (12+ tables) (memories)  (append-only) (cost tracking)

       LLM Backend (configurable)
         |
    +----+----+
    |         |
  Claude    Claude
   CLI     Agent SDK
 (default) (api mode)

       Daemon (background)
         |
    Smart Heartbeat
    (skips if no new observations)
         |
    +----+----+----+
    |    |         |
  Runner Bidirectional  External
    |     MCP w/       MCP Servers
    |    Claude CLI   (communication)
    |
  Multi-repo filesystem
```

## LLM Backend

Shadow supports two explicit backend modes, configured via `shadow.backend`:

| Mode | Config | How it works | Requires |
|------|--------|-------------|----------|
| **cli** (default) | `backend: "cli"` | Spawns Claude CLI using the logged-in session | Claude CLI installed, user logged in |
| **api** | `backend: "api"` | Uses `@anthropic-ai/agent-sdk` programmatically | `ANTHROPIC_API_KEY` env var |

### Models per phase

| Phase | Default Model | Rationale |
|-------|--------------|-----------|
| Analyze (observations) | Sonnet | High volume, needs speed and cost efficiency |
| Consolidate (memory) | Sonnet | Summarization task, Sonnet is sufficient |
| Suggest (recommendations) | Opus | Highest quality reasoning for actionable suggestions |

Models are configurable via `shadow.models.analyze`, `shadow.models.consolidate`, `shadow.models.suggest`.

## Proactivity and Personality

### Proactivity (1-10)

Controls how aggressively Shadow surfaces suggestions and takes action. Combined with
**temporal modes**:

| Mode | Meaning |
|------|---------|
| **focus** | Shadow is silent unless explicitly asked. Heartbeat runs but does not notify. |
| **available** | Shadow proactively surfaces suggestions based on the proactivity level. |

### Personality (1-5)

Controls communication style. Default is **4** (Tam-like: warm, direct, slightly irreverent).

| Level | Style |
|-------|-------|
| 1 | Minimal, robotic |
| 2 | Professional, concise |
| 3 | Friendly, clear |
| 4 | Tam-like (default): warm, opinionated, uses humor |
| 5 | Full character, expressive |

Personality is defined in `SOUL.md` and loaded into every LLM prompt as system context.

## Memory System

### On-demand retrieval

No memory layer is auto-loaded into context. All retrieval is **context-aware via FTS5** —
Shadow queries only what is relevant to the current task.

### Core layer

The **core** layer is the exception: it contains permanent, always-true facts about the user
and is included in every LLM call. Everything else (episodic, semantic, procedural) is
retrieved on demand.

### Cognitive types

| Type | What it stores | Examples |
|------|---------------|----------|
| **Episodic** | What happened | Observations, interaction logs, heartbeat results |
| **Semantic** | What I know | User preferences, repo facts, learned patterns |
| **Procedural** | How to do things | Command recipes, workflow patterns, fix templates |

## Auto-learning

Shadow learns through a **bidirectional MCP** relationship with Claude CLI:

1. **Shadow as MCP server**: Claude CLI can query Shadow's memory, repos, and context.
2. **Shadow observes Claude CLI**: Shadow logs interactions and the heartbeat creates
   memories from observed patterns.

### Interactive teaching

`shadow teach` opens Claude CLI with Shadow's MCP tools pre-configured, allowing the user
to interactively teach Shadow about their preferences, workflows, and systems.

## Expanded Scope

### Systems table (infrastructure)

Shadow tracks infrastructure: servers, services, databases, cloud resources. This enables
infra-aware suggestions (e.g., "your staging DB is running Postgres 14, but the migration
uses a PG16 feature").

### Contacts table (team)

Shadow knows the team: who owns what, who to ask about specific systems, communication
preferences. Enables team-aware suggestions.

### Communication

Shadow can communicate via **external MCP servers** (Slack, email, etc.) — it does not
implement communication protocols directly.

## Multi-repo

Shadow is not scoped to a single repository. Key implications:

- **ObjectivePack** has a `repos` array — a single objective can span multiple repos.
- Suggestions can reference and correlate patterns across repos.
- Runs can execute across repo boundaries.

## Smart Heartbeat

The heartbeat is cost-aware:

1. **Skip if idle**: Only calls the LLM if new observations exist since the last heartbeat.
2. **Cost tracking**: Every LLM call is logged to the `llm_usage` table with input/output
   tokens and estimated cost.
3. **Adaptive interval**: Heartbeat interval adjusts based on activity level.

## Tech Stack

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Runtime | Node.js 22+ (ESM) | Native SQLite support |
| Language | TypeScript 5.9+ (strict) | Type safety |
| Storage | SQLite (DatabaseSync) | Local-first, zero config, WAL mode |
| Search | FTS5 (built into SQLite) | Full-text memory search, no external deps |
| Validation | Zod 4 | Runtime schema validation, config parsing |
| CLI | Commander.js 14 | Subcommand groups, proven pattern |
| LLM (cli mode) | Claude CLI | Uses logged-in session, no API key needed |
| LLM (api mode) | `@anthropic-ai/agent-sdk` | Programmatic control, hooks, subagents |
| MCP | JSON-RPC over stdio | Standard protocol for AI tool integration |
| Daemon | Native Node.js (detached child) | No systemd dependency, cross-platform |
| Personality | SOUL.md | LLM system prompt for personality definition |
| Cost tracking | llm_usage table | Per-call token and cost logging |

## Improvement Decisions from Research

### 1. 100% LLM-based analysis (no rule engine)

**Before (Sidecar/v0.1):** Mix of rule-based heuristics and LLM calls. Pattern detection
was partially hard-coded.

**After (v0.3):** Every analytical task goes through the LLM. Shadow's value is in
persistence, observation collection, and orchestration — not in implementing analysis rules
that the LLM already handles better. This dramatically simplifies the codebase and improves
quality of insights.

### 2. Explicit backend: CLI vs API

**Before:** Agent SDK as primary, CLI as fallback. Ambiguous selection logic.

**After:** User explicitly sets `backend: "cli"` (default) or `backend: "api"`. CLI mode
requires no API key — it uses the logged-in Claude CLI session. API mode uses the Agent SDK
with `ANTHROPIC_API_KEY`. No magic fallback, no ambiguity.

### 3. FTS5 for memory retrieval

**Before (plan v0.1):** SQL queries with `LIKE` for memory search.

**After:** FTS5 virtual table indexed on memory title + body. Enables ranked full-text
search with BM25 scoring. No memory layer is auto-loaded; all retrieval is context-aware.
Future upgrade path to sqlite-vec for semantic search without changing the query interface.

Sources:
- [Hybrid full-text and vector search with SQLite](https://alexgarcia.xyz/blog/2024/sqlite-vec-hybrid-search/index.html)
- [Building a RAG on SQLite](https://blog.sqlite.ai/building-a-rag-on-sqlite)

### 4. Episodic / Semantic / Procedural memory taxonomy

**Before:** Memory classified only by layer (hot/warm/cool/cold) and kind (observation,
preference, pattern, fact, reflection).

**After:** Memory also classified by cognitive type (episodic, semantic, procedural).
This aligns with current AI memory research and improves retrieval relevance.

Sources:
- [AI Agent Memory Architecture: Three Layers](https://tacnode.io/post/ai-agent-memory-architecture-explained)
- [Beyond Short-term Memory: 3 Types of Long-term Memory](https://machinelearningmastery.com/beyond-short-term-memory-the-3-types-of-long-term-memory-ai-agents-need/)

### 5. Proactivity scale + temporal modes

**Before:** Single "autonomy dial" mapped to trust levels.

**After:** Proactivity (1-10) controls suggestion aggressiveness. Temporal modes
(focus/available) control when Shadow interrupts. These are orthogonal to trust — a user
can have high trust but be in focus mode.

### 6. Personality via SOUL.md

**Before:** Hard-coded personality traits in prompt templates.

**After:** Personality defined in `SOUL.md`, loaded as system context. Personality level
(1-5) selects how much of the SOUL is expressed. Default level 4 = Tam-like warmth.

### 7. Smart heartbeat with cost tracking

**Before:** Heartbeat always calls the LLM on every tick.

**After:** Heartbeat checks for new observations first. If nothing has changed, it skips
the LLM call. Every LLM invocation is logged to `llm_usage` (model, tokens in/out,
estimated cost). This prevents runaway costs and enables usage dashboards.

### 8. Multi-repo ObjectivePack

**Before:** One ObjectivePack = one repo.

**After:** ObjectivePack includes a `repos` array. A single objective (e.g., "update the
API schema and regenerate clients") can span multiple repositories. The runner resolves
repo paths and executes across boundaries.

### 9. Bidirectional MCP for auto-learning

**Before:** Shadow calls Claude. One-directional.

**After:** Shadow exposes MCP tools to Claude CLI. When the user works with Claude CLI,
Shadow observes the interaction. The heartbeat creates memories from these observations.
`shadow teach` opens an interactive session with Shadow's MCP tools available.

### 10. MCP best practices

**Decision:** Shadow's MCP server starts read-only. Write tools are gated behind trust
levels. Every tool includes usage examples in its description. Structured error responses
with `isError: true`.

Sources:
- [MCP Best Practices: Architecture & Implementation Guide](https://modelcontextprotocol.info/docs/best-practices/)

## Implementation Phases

| Phase | Name | Scope |
|-------|------|-------|
| 1 | Foundation | Config (with backend/proactivity/personality), storage (with systems/contacts/llm_usage tables), CLI skeleton (init/status/doctor/repo/memory/suggest/profile/events/teach) |
| 2 | Observation + Memory | Git-based repo watcher, FTS5 memory search, memory lifecycle, LLM backend adapters (cli + api) |
| 3 | Heartbeat + Profile | Smart heartbeat, user profile learning, SOUL.md, proactivity/personality system, daemon |
| 4 | Suggestions + Runner | Multi-repo suggestion engine, LLM-based analysis, run execution across repos |
| 5 | Events + MCP | Event queue delivery, bidirectional MCP server, external MCP integration |
| 6+ | Future | Semantic search (sqlite-vec), web panel, communication via external MCP servers, advanced auto-learning |

## File Structure

```
shadow/
  package.json
  tsconfig.json
  .env.example
  .gitignore
  SOUL.md                           <- personality definition
  docs/
    00-overview.md                  <- this file
    01-foundation.md
    02-observation-memory.md
    03-heartbeat-profile.md
    04-suggestions-runner.md
    05-events-mcp.md
    06-future.md
  src/
    cli.ts
    cli/output.ts
    config/
      schema.ts                     <- includes backend, proactivity, personality, models
      load-config.ts
    storage/
      database.ts
      migrations.ts
      models.ts                     <- includes systems, contacts, llm_usage models
      index.ts
    observation/
      watcher.ts
      patterns.ts
    memory/
      layers.ts
      retrieval.ts                  <- FTS5 context-aware queries
      consolidation.ts
    heartbeat/
      state-machine.ts
      activities.ts
      anti-loop.ts
      prompts.ts                    <- LLM prompt templates for heartbeat phases
    profile/
      user-profile.ts
      trust.ts
      personality.ts                <- personality level + SOUL.md loading
    suggestion/
      engine.ts
      ranking.ts
    runner/
      service.ts
    backend/                        <- Phase 2 (LLM backend adapters)
      types.ts                      <- LlmBackend interface
      claude-cli.ts                 <- cli mode adapter
      agent-sdk.ts                  <- api mode adapter
      index.ts                      <- factory: resolves backend from config
      cost.ts                       <- llm_usage tracking
    daemon/
      runtime.ts
    events/
      queue.ts
      types.ts
    mcp/
      server.ts
      stdio.ts
    systems/
      registry.ts                   <- infrastructure tracking
    contacts/
      registry.ts                   <- team tracking
```
