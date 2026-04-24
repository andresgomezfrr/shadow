# Shadow — User Guide

Shadow is your engineering companion. You interact with it through **Claude CLI** — you talk naturally and Claude uses Shadow's tools automatically.

---

## Setup (one-time)

```bash
cd shadow
npm install
npm run build
npm link
shadow init            # DB, identity, hooks, MCP, service
shadow daemon start    # or let init start it
```

`shadow init` does three things:
1. Creates the database at `~/.shadow/shadow.db`
2. Writes Shadow's identity to `~/.claude/CLAUDE.md`
3. Installs hooks, the MCP server, and the service (launchd on macOS,
   `systemd --user` on Linux)

Shadow's personality (soul) lives as a `soul_reflection` memory inside the
database, written and evolved automatically by the daily `reflect` job.
You can view and edit it from the dashboard at `/profile`.

`shadow init` also registers Shadow as an **HTTP MCP server** in Claude Code
(the daemon serves it on port 3700). The resulting `~/.claude/settings.json`
entry looks like:

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

Restart Claude Code. Done — you can now talk to Shadow.

---

## Daily use — everything via Claude CLI

Open Claude CLI in any terminal and speak naturally:

### Registering repos

```
"Shadow, register the repo ~/workspace/api as 'api'"
"Also add ~/workspace/frontend, call it 'frontend'"
"What repos do you have registered?"
```

### Observing repos

```
"What have you seen lately in my repos?"
"Run an observation across all repos"
"Only observe the api repo"
```

### Memory

Shadow has 5 memory layers — `core` is permanent, the rest decay over time.

```
"Remember that our Kafka runs on AWS MSK with 3 brokers in eu-west-1"
→ Shadow stores this in the core layer (permanent)

"Remember we're in sprint 14, the goal is to close the auth refactor"
→ Shadow stores in the hot layer (active, 14 days)

"What do you know about the deploy?"
→ Shadow searches its memory

"What do you have in permanent memory?"
→ Shadow lists memories from the core layer

"Forget the memory about sprint 14, it's over"
```

### Team

```
"Add Carlos as a contact, he's backend on the platform team, his github is carlos-dev"
"Add Ana, she's devops, her email is ana@company.com"
"Who's on the platform team?"
"Remove Carlos from contacts"
```

### Systems and infrastructure

```
"Register our postgres as a system, it's an RDS database in eu-west-1"
"Add grafana as a monitoring system, the URL is https://grafana.internal"
"What systems do we have registered?"
"What databases do you know about?"
```

### Suggestions

The daemon generates suggestions automatically by analyzing your repos.

```
"Do you have any suggestions?"
"Show me the open suggestions"
"Accept the refactor suggestion"
"Dismiss that suggestion, it doesn't apply to our case"
```

### Focus mode

```
"I need to concentrate for 2 hours"
→ Shadow enters focus mode, won't disturb you

"I'm available again"
→ Shadow returns to normal

"Set focus mode for 30 minutes"
```

### Profile

```
"What's my bond tier?"
"Bump my proactivity to 7"
"Set my timezone to Europe/Madrid"
```

### Events and status

```
"Are there any pending events?"
"Mark all events as read"
"Give me a summary of your status"
"How many tokens have I spent today?"
"How much have I spent this week?"
```

### Tasks (work containers)

```
"What tasks do I have open?"
"Create a task for the auth refactor"
"Close the deploy task"
"Archive that task"
```

Tasks are created automatically when you accept a suggestion with category "plan". They can also be created manually.

### Runs (task execution)

```
"Are there any open runs?"
"Show me the detail of the last run"
```

---

## How it works behind the scenes

```
Your terminal                        Shadow (background)
    |                                      |
    |  Open Claude CLI                     |  Daemon running
    |  "what have you seen in my repos?"   |  Heartbeat every 30 min
    |          |                           |      |
    |    Claude CLI                        |  1. Observe (git commands)
    |    calls MCP tool:                   |  2. Analyze (Claude Sonnet)
    |    shadow_observations               |  3. Suggest (Claude Opus)
    |          |                           |  4. Consolidate memory
    |    Shadow DB                         |  5. Notify events
    |    returns data                      |
    |          |                           |
    |    Claude summarizes                 |
    |    the findings for you              |
```

### Auto-learning

While you use Claude CLI with Shadow as an MCP server:
- Shadow observes which topics/repos/files get discussed
- On the next heartbeat, it analyzes the interactions and creates memories
- If it detects foundational knowledge, it promotes it to `core` (permanent)

You don't have to teach it everything explicitly — it learns from your sessions.

---

## Direct commands (admin only)

These are the only commands run directly, not via Claude:

```bash
# Initial setup
shadow init

# Daemon
shadow daemon start
shadow daemon stop
shadow daemon status

# Jobs (trigger any daemon job manually)
shadow job list              # see available types
shadow job heartbeat         # analyze recent activity
shadow job suggest           # generate suggestions
shadow job reflect           # evolve soul

# Diagnostics
shadow doctor

# Status line (Claude Code's emoji bar — activity, bond, suggestions, heartbeat)
shadow statusline              # inspect current registration
shadow statusline enable       # register Shadow's status line
shadow statusline disable      # remove it (hooks stay)

# Interactive teaching (opens a Claude CLI session with Shadow's MCP)
shadow teach
```

Everything else is done by talking to Claude.

---

## Configuration

Environment variables (or in `.env`):

```bash
SHADOW_BACKEND=cli                    # cli (default) | api
SHADOW_PROACTIVITY_LEVEL=5            # 1-10
SHADOW_MODEL_ANALYZE=sonnet           # Model for analysis
SHADOW_MODEL_SUGGEST=opus             # Model for suggestions
SHADOW_MODEL_CONSOLIDATE=sonnet       # Model for consolidation
SHADOW_MODEL_RUNNER=opus              # Model for execution
SHADOW_HEARTBEAT_INTERVAL_MS=1800000  # 30 min
```

---

## Personality

Shadow's personality lives as a `soul_reflection` memory inside the
database. There are no fixed levels: the daily `reflect` job rewrites the
soul based on how you've been working with Shadow, and that text gets injected
into every Shadow prompt.

To view or edit it: dashboard → `/profile` → **Soul** section. You can also
influence it via corrections (`shadow_correct`) and teachings
(`shadow_memory_teach`) — Shadow absorbs them on the next reflect.

When you open Claude CLI, Shadow introduces itself in character because:
1. `~/.claude/CLAUDE.md` tells Claude that it IS Shadow
2. Claude calls `shadow_check_in` to fetch personality, mood, and context
3. Shadow answers in its own voice, not Claude's

---

## MCP tools

Shadow exposes **69 MCP tools** grouped by area. Claude picks them up
automatically — you don't have to invoke them by name.

| Group | Examples | Source |
|---|---|---|
| **Status** | `shadow_check_in`, `shadow_status`, `shadow_alerts`, `shadow_events`, `shadow_daily_summary`, `shadow_usage` | `src/mcp/tools/status.ts` |
| **Memory** | `shadow_memory_search`, `shadow_memory_teach`, `shadow_memory_update`, `shadow_memory_forget`, `shadow_correct`, `shadow_search` | `src/mcp/tools/memory.ts` |
| **Observations** | `shadow_observations`, `shadow_observe`, `shadow_observation_ack/resolve/reopen` | `src/mcp/tools/observations.ts` |
| **Suggestions** | `shadow_suggestions`, `shadow_suggest_accept/dismiss/snooze` | `src/mcp/tools/suggestions.ts` |
| **Entities** | `shadow_repos`, `shadow_projects`, `shadow_contacts`, `shadow_systems`, `shadow_relation_*`, add/update/remove variants | `src/mcp/tools/entities.ts` |
| **Profile** | `shadow_profile`, `shadow_profile_set`, `shadow_focus`, `shadow_available`, `shadow_soul`, `shadow_soul_update` | `src/mcp/tools/profile.ts` |
| **Data** | `shadow_run_list/view/create/archive`, `shadow_digest*`, `shadow_enrichment_*`, `shadow_feedback` | `src/mcp/tools/data.ts` |
| **Tasks** | `shadow_tasks`, `shadow_task_create/update/close/archive/remove/execute` | `src/mcp/tools/tasks.ts` |

Use `shadow_check_in` first — Claude does this automatically at session
start. It returns your current soul, mood, pending events, and contextual
memories scoped to the active repo.

For full schemas, see each file under `src/mcp/tools/`. The dashboard `/guide`
page also lists every tool with its description.
