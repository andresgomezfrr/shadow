# Shadow

[![CI](https://github.com/andresgomezfrr/shadow/actions/workflows/ci.yml/badge.svg)](https://github.com/andresgomezfrr/shadow/actions/workflows/ci.yml)
[![Latest tag](https://img.shields.io/github/v/tag/andresgomezfrr/shadow?sort=semver&label=latest)](https://github.com/andresgomezfrr/shadow/tags)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-43853D.svg?logo=node.js&logoColor=white)](https://nodejs.org/)

> A local-first memory, observation, and autonomy layer for Claude.

<p align="center">
  <a href="assets/readme/promo.mp4">
    <img src="assets/readme/promo.webp" alt="Shadow — watch. remember. act." width="800">
  </a>
</p>
<p align="center"><sub>Product tour — <a href="assets/readme/promo.mp4">download mp4</a></sub></p>

## Why Shadow?

Using Claude as a pair-programmer is powerful but amnesiac: every session
starts from zero, your project knowledge stays locked in conversation
history, and nothing watches for patterns across days. Shadow closes that
loop. It runs quietly in the background, learns from your sessions,
surfaces what it notices, and keeps track of decisions, repos, and people.
Locally. Yours. One SQLite file under `~/.shadow/`.

## Quickstart

```bash
curl -fsSL https://raw.githubusercontent.com/andresgomezfrr/shadow/main/scripts/install.sh | bash
shadow init
claude   # start talking — Shadow is already listening
```

Dashboard at <http://localhost:3700>.

## Contents

- [What Shadow does](#what-shadow-does)
- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Install from source](#install-from-source)
- [Interfaces](#interfaces)
- [Is Shadow for you?](#is-shadow-for-you)
- [Project status](#project-status)
- [Contributing](#contributing)
- [Documentation](#documentation)
- [Acknowledgments](#acknowledgments)
- [License](#license)

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
- **69 MCP tools** give Claude typed, safe access to everything in Shadow
- **Web dashboard** with 17+ pages: Morning brief, Workspace, Chronicle,
  Memories, Observations, Suggestions, Activity, Runs, Tasks, Digests,
  Usage, Profile, Repos, Projects, Systems, Team, Guide

## How it works

```
You → Claude CLI (MCP tools) → Shadow daemon (:3700)
                                   ├── SQLite (~/.shadow/shadow.db)
                                   ├── Web dashboard (React)
                                   ├── Job system (22 types)
                                   │   ├── heartbeat (summarize → extract → observe)
                                   │   ├── suggest, consolidate, reflect
                                   │   ├── auto-plan, auto-execute
                                   │   ├── enrichment, pr-sync, remote-sync
                                   │   └── … and more
                                   ├── Hooks (SessionStart, PostToolUse, Stop, …)
                                   └── service manager (launchd on macOS, systemd --user on Linux)
```

Shadow is 100% LLM-based — Claude is the brain, Shadow is the persistence,
observation, and orchestration layer. Hooks injected into Claude Code feed
your interactions into Shadow's heartbeat, which summarizes, extracts
memories, and surfaces new observations. Suggestions are ranked and queued.
Accepted work becomes tasks, and tasks become runs.

For the full architecture, see [CLAUDE.md](CLAUDE.md).

## Requirements

- macOS (launchd, `darwin-arm64` primary target) **or** Linux with `systemd --user`
- Node.js 22+
- [Claude CLI](https://claude.com/claude-code) logged in (or an
  `ANTHROPIC_API_KEY` with the API backend)
- `gh` CLI (optional, for PR-aware run lifecycle)

## Install from source

The one-liner in [Quickstart](#quickstart) is the recommended path. If you
prefer to build from source:

```bash
git clone git@github.com:andresgomezfrr/shadow.git
cd shadow
npm install
npm run build
npm link            # installs the `shadow` command globally
shadow init         # bootstraps ~/.shadow/, hooks, and service (launchd/systemd)
shadow web          # open the dashboard at http://localhost:3700
```

## Interfaces

Shadow exposes three surfaces that share the same SQLite state.

1. **Claude CLI (primary).** Shadow exposes 69 MCP tools (`mcp__shadow__*`).
   Claude reaches for them naturally — `shadow_check_in` on every session
   start, `shadow_suggestions` for advice, `shadow_task_create` when an idea
   crystallizes. Start a session via `shadow` (spawns `claude` with the soul
   pre-loaded as `--append-system-prompt`) or `claude` bare (SessionStart
   hook injects the soul). Passthrough: `shadow -- --resume <id>`,
   `shadow -- -p "quick ask"`, `shadow -- --help` for claude's own help.

2. **Web dashboard** at `http://localhost:3700`. Every entity Shadow tracks
   is visible and editable: memories, observations, suggestions, tasks, runs,
   contacts, repos, projects. The Morning page is the daily brief; Workspace
   is the inbox for active work; Chronicle is the bond narrative.

3. **`shadow` CLI** for admin: `shadow status`, `shadow daemon restart`,
   `shadow job <type>`, `shadow profile bond-reset`. See `shadow --help`.

## Is Shadow for you?

- **You'll probably love Shadow if…** you live in Claude CLI, juggle
  multiple repos, and get tired of explaining the same context every
  session. Shadow notices patterns across your work, keeps an opinion about
  it, and can act on the small stuff when you authorize it.

- **Shadow is probably not for you if…** you want a hosted agent, Windows
  support, a cloud sync story, or a polished product experience. This is an
  opinionated personal project released as-is.

- **How is it different from `CLAUDE.md` files or per-project memory?**
  `CLAUDE.md` is static — you write it, Claude reads it. Shadow learns
  continuously from your sessions, generates observations you didn't write,
  ranks suggestions by impact/confidence/risk/effort, and — when you let it —
  runs tasks in isolated worktrees with PR-aware lifecycle.

- **Does anything leave my machine?** No. Embeddings run locally via
  [Transformers.js](https://github.com/huggingface/transformers.js) (384-dim,
  ~30MB model). The only outbound traffic is the Claude API / CLI calls you
  were already making.

## Project status

Shadow is under active development. APIs, database schema, and the MCP tool
surface evolve with the design — breaking changes happen. The project is not
affiliated with Anthropic; you provide your own Claude credentials.

**Supported today**: macOS (launchd, primary target — most tested) and Linux
with `systemd --user`. **Not supported**: Windows. Sleep/wake awareness uses
`pmset` on macOS and `systemd-inhibit --list` on Linux; both fall open when
unavailable so non-standard distros keep working.

## Contributing

Shadow is an opinionated design — the architecture, decisions, and trade-offs
are documented in [CLAUDE.md](CLAUDE.md). If
you're interested in contributing:

- **Bugs and regressions**: open an issue with a reproduction and your env
  (OS version, Node version, Shadow version from `shadow status`)
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

- [GETTING_STARTED.md](GETTING_STARTED.md) — install and first run
- [GUIDE.md](GUIDE.md) — what you can say to Shadow day-to-day
- [CLAUDE.md](CLAUDE.md) — developer guide: architecture, tech stack, schema, conventions
- [CHANGELOG.md](CHANGELOG.md) — release history
- [SECURITY.md](SECURITY.md) — private vulnerability disclosure

## Acknowledgments

Shadow stands on the shoulders of:

- [Claude](https://claude.com) and the [Model Context Protocol](https://modelcontextprotocol.io) — the brain and the lingua franca
- [sqlite-vec](https://github.com/asg017/sqlite-vec) — local vector search sitting inside SQLite
- [Transformers.js](https://github.com/huggingface/transformers.js) — 384-dim embeddings without leaving your laptop
- [Commander](https://github.com/tj/commander.js), [Zod](https://github.com/colinhacks/zod), [React](https://react.dev), [Vite](https://vite.dev), [Tailwind](https://tailwindcss.com) — everyday workhorses

## License

Apache-2.0. See [LICENSE](LICENSE).
