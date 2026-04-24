# Getting Started with Shadow

Shadow is a local-first engineering companion that runs as a background
daemon, learns from your work, and interacts via Claude CLI. It exposes 69
MCP tools to manage memory, observations, suggestions, projects, runs, and
more.

## Prerequisites

- **Node.js 22+**
- **Claude Code** installed and working (`claude` command available)
- **macOS** (launchd, primary target) or **Linux** with `systemd --user`

## Installation

One-liner (recommended):

```bash
curl -fsSL https://raw.githubusercontent.com/andresgomezfrr/shadow/main/scripts/install.sh | bash
```

From source:

```bash
git clone git@github.com:andresgomezfrr/shadow.git
cd shadow
npm install
npm run build
npm link               # install the `shadow` command globally
shadow init            # bootstraps ~/.shadow/, hooks, MCP server, service
shadow daemon start    # or let init start it for you
```

`shadow init` does the following:
- Creates `~/.shadow/` with the SQLite database
- Writes Shadow's identity to `~/.claude/CLAUDE.md`
- Installs hooks and the MCP server in `~/.claude/settings.json`
- Installs a service for auto-start on login: launchd on macOS, `systemd --user` on Linux

Shadow's personality lives as a `soul_reflection` memory inside the database,
authored and evolved automatically by the daily `reflect` job. You can view
and edit it from the dashboard at `/profile`.

## Register the MCP server

`shadow init` automatically registers Shadow as an HTTP MCP server in Claude Code. The daemon serves MCP on port 3700:

```json
{
  "mcpServers": {
    "shadow": {
      "type": "http",
      "url": "http://localhost:3700/api/mcp"
    }
  }
}
```

Alternatively, you can register it manually:

```bash
claude mcp add --transport http shadow http://localhost:3700/api/mcp
```

## Verify it works

```bash
# Preferred: spawn Claude with soul pre-loaded as --append-system-prompt
shadow

# Or the classic path (SessionStart hook injects the soul at session start):
claude

# Say hello:
> Shadow, que tal?
```

Shadow should respond with its personality, greet you by name, and share any pending events or observations.

**Tip**: `shadow -- <claude args>` passes flags through to claude — e.g.
`shadow -- --resume <session-id>` to resume a previous session,
`shadow -- -p "quick question"` for a one-shot, `shadow -- --help` to see
claude's own help. Anything after `--` is opaque to Shadow.

You can also verify the daemon and MCP endpoint directly:

```bash
# Daemon status
shadow daemon status

# MCP endpoint (69 tools)
curl -s -X POST http://localhost:3700/api/mcp \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq '.result.tools | length'

# Dashboard
open http://localhost:3700
```

## First steps

Once Shadow is running, interact with it naturally through Claude CLI:

### Register your repos

```
"Shadow, register the repo at ~/workspace/my-api as 'api'"
"What repos do you have?"
```

### Teach it things

```
"Remember that our Kafka cluster is on AWS MSK with 3 brokers in eu-west-1"
"Remember that we're in sprint 14, the goal is to finish the auth refactor"
```

### Ask about your work

```
"What have you noticed in my repos?"
"Do you have any suggestions?"
"What do you know about the deploy process?"
```

### Focus mode

```
"I need to focus for 2 hours"    → Shadow goes quiet
"I'm available now"              → Shadow returns to normal
```

## Architecture

```
You ← Claude CLI (MCP tools) → Shadow daemon (port 3700)
                                  ├── SQLite DB (~/.shadow/shadow.db)
                                  ├── Web dashboard (localhost:3700)
                                  ├── Heartbeat (every 30 min)
                                  │   ├── summarize → extract → observe (LLM)
                                  │   ├── Create memories + observations
                                  │   └── Generate suggestions (via suggest job)
                                  ├── Background jobs (22 types)
                                  │   ├── Memory consolidation (6h)
                                  │   ├── Soul reflection (daily)
                                  │   ├── Git remote sync (30min)
                                  │   ├── PR sync (for awaiting_pr runs, 30min)
                                  │   ├── Auto-plan / auto-execute (opt-in)
                                  │   └── Context enrichment, digests, etc.
                                  └── 6 hooks + statusLine (auto-learning from your sessions)
```

## Configuration

All optional — sensible defaults are provided. See `.env.example` for the
full list:

```bash
SHADOW_PROACTIVITY_LEVEL=5            # 1-10 (how proactive Shadow is)
SHADOW_PERSONALITY_LEVEL=4            # 1-5 (1=terse/technical, 5=warm/companion-like)
SHADOW_MODEL_ANALYZE=sonnet           # Model for heartbeat analysis
SHADOW_MODEL_SUGGEST=opus             # Model for suggestions
SHADOW_HEARTBEAT_INTERVAL_MS=1800000  # 30 minutes
SHADOW_LOCALE=en                      # Language Shadow speaks (en, es, …)
```

## Useful commands

```bash
shadow daemon start|stop|status|restart
shadow status
shadow doctor
shadow web                          # Open dashboard in browser
shadow summary                      # Daily summary
shadow job heartbeat                # Trigger any daemon job manually
shadow job list                     # List all job types
shadow statusline                   # Inspect the Claude status-line entry
shadow statusline enable|disable    # Turn Shadow's status line on/off
```

## Dashboard

Open `http://localhost:3700` in your browser. The dashboard shows:

- **Morning** — daily brief with active projects, metrics, and suggestions
- **Memories** — searchable knowledge base with layer filters
- **Observations** — LLM-generated insights about your repos
- **Suggestions** — actionable recommendations (accept/dismiss/snooze)
- **Activity** — unified timeline of daemon jobs with live status
- **Workspace** — task execution runs with worktree isolation
- **Profile** — settings, personality, trust level, model configuration

## More info

- [GUIDE.md](GUIDE.md) — detailed user guide (what you can say to Shadow)
- [CLAUDE.md](CLAUDE.md) — developer reference for contributing
- [CHANGELOG.md](CHANGELOG.md) — release history
- [SECURITY.md](SECURITY.md) — vulnerability disclosure
