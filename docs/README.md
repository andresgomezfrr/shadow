# Shadow — Design Documents

## Current Architecture

The authoritative source of truth for Shadow's current state is:

- **[CLAUDE.md](../CLAUDE.md)** — Developer guide with current state, MCP tools, CLI commands, architecture notes
- **[BACKLOG.md](../BACKLOG.md)** — Prioritized backlog with done/pending items

## Active Plans

These documents describe designed-but-not-fully-implemented features:

- **[plan-trust-levels.md](plan-trust-levels.md)** — L1-5 trust level redesign. L2 implemented, L3+ designed.
- **[plan-job-system.md](plan-job-system.md)** — Job system. Phase 1 done (heartbeat, suggest, consolidate, reflect).
- **[plan-feedback-loop.md](plan-feedback-loop.md)** — Feedback loop. Implemented.
- **[plan-mcp-delegation-pattern.md](plan-mcp-delegation-pattern.md)** — MCP delegation for runner + future jobs.
- **[plan-allowed-tools-config.md](plan-allowed-tools-config.md)** — User-configurable allowedTools for MCP access.

## Historical Design Documents (v0.3 original design)

> **Note**: These documents (00-06) were the original design spec for Shadow v0.3.
> Most phases are now implemented but the docs describe the **old architecture**
> (monolithic heartbeat, fewer MCP tools, no job system, no feedback loop).
> They are kept for historical reference. For current architecture, see CLAUDE.md.

- [00-overview.md](00-overview.md) — Original architecture vision
- [01-foundation.md](01-foundation.md) — Phase 1: database, config, CLI scaffold
- [02-observation-memory.md](02-observation-memory.md) — Phase 2: observation engine, memory layers
- [03-heartbeat-profile.md](03-heartbeat-profile.md) — Phase 3: heartbeat state machine (now replaced by job system)
- [04-suggestions-runner.md](04-suggestions-runner.md) — Phase 4: suggestion lifecycle, runner (now with MCP delegation)
- [05-events-mcp.md](05-events-mcp.md) — Phase 5: event queue, MCP server (now 37 tools)
- [06-future.md](06-future.md) — Future roadmap (partially implemented)

## Key Architecture Changes Since v0.3 Design

| Area | v0.3 Design (docs 00-06) | Current Implementation |
|------|--------------------------|----------------------|
| Heartbeat | Monolithic state machine: wake→observe→analyze→suggest→consolidate→notify→idle | Typed jobs: heartbeat (extract+observe), suggest, consolidate, reflect |
| Observations | Git-based watcher | LLM-generated + observe-cleanup (MCP auto-resolve) |
| Runner | Direct execution with injected context | MCP delegation — briefing-only prompt, Claude reads files himself |
| MCP tools | 29 planned | 37 implemented (feedback, soul, memory_update, observation lifecycle) |
| Feedback | Not designed | Unified feedback table + 👍/👎 + reason on all actions |
| Soul | SOUL.md static only | Daily reflect job evolves soul_reflection memory |
| Status line | Emoji-based | Ghost mascot `{•‿•}` with 13 states × 3 variants |
| Dashboard | 13 routes | 15 routes with markdown, deep linking, sidebar badges |
| CLI adapter | spawnSync, prompt as arg | async spawn, prompt via stdin, --allowedTools |
