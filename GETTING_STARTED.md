# Getting Started with Shadow

Shadow is a local-first engineering companion that runs as a background daemon, learns from your work, and interacts via Claude CLI. It uses 53 MCP tools to manage memory, observations, suggestions, projects, and more.

## Prerequisites

- **Node.js 22+**
- **Claude Code** installed and working (`claude` command available)
- macOS (launchd for daemon auto-start) or Linux

## Installation

```bash
# 1. Clone the repo
git clone git@github.com:andresgomezfrr/shadow.git
cd shadow

# 2. Install dependencies
npm install

# 3. Initialize Shadow (creates DB, personality, hooks, daemon service)
npx tsx src/cli.ts init

# 4. Start the daemon
npx tsx src/cli.ts daemon start
```

`shadow init` does the following:
- Creates `~/.shadow/` with SQLite database
- Writes Shadow's identity to `~/.claude/CLAUDE.md`
- Installs hooks and MCP server in `~/.claude/settings.json`
- Installs a launchd service for auto-start on login (macOS)

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

## Plugin (alternative registration)

Shadow ships as a Claude Code plugin. Instead of manual MCP registration, you can install it as a plugin:

```bash
claude plugin install /path/to/shadow
```

This registers the MCP server and all 4 hooks (SessionStart, PostToolUse, UserPromptSubmit, Stop) automatically.

## Verify it works

```bash
# Restart Claude Code, then open a session:
claude

# Say hello:
> Shadow, que tal?
```

Shadow should respond with its personality, greet you by name, and share any pending events or observations.

You can also verify the daemon and MCP endpoint directly:

```bash
# Daemon status
npx tsx src/cli.ts daemon status

# MCP endpoint (53 tools)
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
                                  ├── Heartbeat (every 15-30 min)
                                  │   ├── Analyze conversations (LLM)
                                  │   ├── Create memories + observations
                                  │   └── Generate suggestions
                                  ├── Background jobs
                                  │   ├── Memory consolidation (6h)
                                  │   ├── Soul reflection (daily)
                                  │   ├── Git remote sync (30min)
                                  │   └── Context enrichment
                                  └── 4 hooks (auto-learning from your sessions)
```

## Configuration

All optional — sensible defaults are provided:

```bash
SHADOW_PROACTIVITY_LEVEL=5          # 1-10 (how proactive Shadow is)
SHADOW_PERSONALITY_LEVEL=4          # 1-5 (1=technical, 4=companion, 5=expressive)
SHADOW_MODEL_ANALYZE=sonnet         # Model for heartbeat analysis
SHADOW_MODEL_SUGGEST=opus           # Model for suggestions
SHADOW_HEARTBEAT_INTERVAL_MS=1800000 # 30 minutes
SHADOW_LOCALE=es                    # Language (Shadow speaks your language)
```

## Useful commands

```bash
npx tsx src/cli.ts daemon start|stop|status|restart
npx tsx src/cli.ts status
npx tsx src/cli.ts doctor
npx tsx src/cli.ts web              # Open dashboard in browser
npx tsx src/cli.ts summary          # Daily summary
npx tsx src/cli.ts heartbeat        # Trigger heartbeat now
```

After building (`npm run build`), you can link globally:

```bash
npm run build
npm link
shadow daemon status   # works globally now
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

- [GUIDE.md](GUIDE.md) — detailed user guide (Spanish)
- [CLAUDE.md](CLAUDE.md) — developer reference for contributing
- [BACKLOG.md](BACKLOG.md) — pending improvements and features
