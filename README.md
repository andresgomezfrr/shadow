# Shadow

> A local-first memory, observation, and autonomy layer for Claude.

![Shadow dashboard](assets/readme/dashboard.png)

Shadow is a background daemon that runs alongside Claude and turns your coding
sessions into persistent knowledge. It watches what you work on, remembers it,
surfaces suggestions grounded in your own history, and — when you let it —
plans and executes tasks on its own. Everything lives locally in a single
SQLite file under `~/.shadow/`.

## What Shadow does

- **Persistent memory** across sessions, layered (core / hot / warm / cool /
  cold) and searchable via FTS5 + local vector embeddings
- **LLM-generated observations and suggestions** ranked by impact, confidence,
  risk, and effort. Reviewed and accepted through the dashboard
- **Entity graph** of repos, projects, systems, contacts, tasks, and runs —
  everything Shadow knows is linked
- **Autonomy (opt-in)**: auto-plan and auto-execute jobs that promote accepted
  suggestions into tasks and run them in isolated worktrees
- **Bond system**: Shadow grows with you across 5 axes and 8 tiers, with a
  narrative Chronicle authored by the LLM as you cross thresholds
- **67 MCP tools** give Claude typed, safe access to everything in Shadow
- **Web dashboard** with 15+ routes: Morning brief, Workspace, Chronicle,
  Memories, Observations, Suggestions, Activity, Runs, and more

## How it works

```
You → Claude CLI (MCP tools) → Shadow daemon (:3700)
                                   ├── SQLite (~/.shadow/shadow.db)
                                   ├── Web dashboard (React)
                                   ├── Job system (15+ types)
                                   │   ├── heartbeat (summarize → extract → observe)
                                   │   ├── suggest, consolidate, reflect
                                   │   ├── auto-plan, auto-execute
                                   │   ├── enrichment, pr-sync, remote-sync
                                   │   └── … and more
                                   ├── Hooks (SessionStart, PostToolUse, Stop, …)
                                   └── launchd service (auto-start, auto-restart)
```

Shadow is 100% LLM-based — Claude is the brain, Shadow is the persistence,
observation, and orchestration layer. Hooks injected into Claude Code feed
your interactions into Shadow's heartbeat, which summarizes, extracts
memories, and surfaces new observations. Suggestions are ranked and queued.
Accepted work becomes tasks, and tasks become runs.

For the full architecture, see [CLAUDE.md](CLAUDE.md).

## Requirements

- macOS (launchd, `darwin-arm64` tested)
- Node.js 22+
- [Claude CLI](https://claude.com/claude-code) logged in (or an
  `ANTHROPIC_API_KEY` with the API backend)
- `gh` CLI (optional, for PR-aware run lifecycle)

## Install

One-liner via the install script:

```bash
curl -fsSL https://raw.githubusercontent.com/andresgomezfrr/shadow/main/scripts/install.sh | bash
```

Or from source:

```bash
git clone git@github.com:andresgomezfrr/shadow.git
cd shadow
npm install
npm run build
npm link            # installs the `shadow` command globally
shadow init         # bootstraps ~/.shadow/, hooks, and launchd service
```

Open the dashboard:

```bash
shadow web          # http://localhost:3700
```

## Interfaces

Shadow exposes three surfaces that share the same SQLite state.

1. **Claude CLI (primary).** Shadow exposes 67 MCP tools (`mcp__shadow__*`).
   Claude reaches for them naturally — `shadow_check_in` on every session
   start, `shadow_suggestions` for advice, `shadow_task_create` when an idea
   crystallizes.

2. **Web dashboard** at `http://localhost:3700`. Every entity Shadow tracks
   is visible and editable: memories, observations, suggestions, tasks, runs,
   contacts, repos, projects. The Morning page is the daily brief; Workspace
   is the inbox for active work; Chronicle is the bond narrative.

3. **`shadow` CLI** for admin: `shadow status`, `shadow daemon restart`,
   `shadow job <type>`, `shadow profile bond-reset`. See `shadow --help`.

## Project status

Shadow is under active development. APIs, database schema, and the MCP tool
surface evolve with the design — breaking changes happen. The project is not
affiliated with Anthropic; you provide your own Claude credentials.

**Supported today**: macOS. **Not supported**: Linux and Windows. The daemon
relies on launchd and `pmset`; porting to systemd or Windows service managers
is possible but not done.

## Contributing

Shadow is an opinionated design — the architecture, decisions, and trade-offs
are documented in [CLAUDE.md](CLAUDE.md) and [BACKLOG.md](BACKLOG.md). If
you're interested in contributing:

- **Bugs and regressions**: open an issue with a reproduction and your env
  (macOS version, Node version, Shadow version from `shadow status`)
- **New features or architectural changes**: open a discussion first. Shadow
  has strong opinions on abstractions, naming, and lifecycle semantics — it's
  best to align on the design before writing code
- **Docs and fixes**: PRs welcome directly. Keep them focused and grounded in
  the actual state of the code

PRs that add abstraction for its own sake, introduce premature optimizations,
or ignore the conventions in CLAUDE.md are unlikely to land. Shadow's
principle is "code must earn its abstractions" — three similar lines beat a
premature generalization.

## Documentation

- [CLAUDE.md](CLAUDE.md) — developer guide: architecture, tech stack, schema, conventions
- [GETTING_STARTED.md](GETTING_STARTED.md) — install and first run
- [GUIDE.md](GUIDE.md) — in-app Guide page mirrored here
- [BACKLOG.md](BACKLOG.md) — prioritized upcoming work
- [COMPLETED.md](COMPLETED.md) — changelog of shipped work

## License

Apache-2.0. See [LICENSE](LICENSE).
