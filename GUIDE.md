# Shadow — User Guide

Shadow is your engineering companion. You interact with it through **Claude CLI** — you talk naturally and Claude uses Shadow's tools automatically.

---

## Setup (one-time)

```bash
cd shadow
npm install
npm run dev -- init
npm run dev -- daemon start
```

`shadow init` does three things:
1. Creates the database at `~/.shadow/shadow.db`
2. Writes Shadow's identity to `~/.claude/CLAUDE.md`
3. Installs hooks, the MCP server, and the launchd service

Shadow's personality (soul) lives as a `soul_reflection` memory inside the
database, written and evolved automatically by the daily `reflect` job.
You can view and edit it from the dashboard at `/profile`.

Configure Shadow as an MCP server in Claude Code. Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "shadow": {
      "command": "npx",
      "args": ["tsx", "/full/path/to/shadow/src/cli.ts", "mcp", "serve"]
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
npm run dev -- init

# Daemon
npm run dev -- daemon start
npm run dev -- daemon stop
npm run dev -- daemon status

# Jobs (trigger any daemon job manually)
npm run dev -- job list              # see available types
npm run dev -- job heartbeat         # analyze recent activity
npm run dev -- job suggest           # generate suggestions
npm run dev -- job reflect           # evolve soul

# Diagnostics
npm run dev -- doctor

# Interactive teaching (opens a Claude CLI session with Shadow's MCP)
npm run dev -- teach
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

## MCP Tools available

### Personality
`shadow_check_in` — personality, mood, context, pending events. Claude calls it automatically.

### Read (27)
`shadow_status`, `shadow_alerts`, `shadow_repos`, `shadow_projects`, `shadow_active_projects`, `shadow_project_detail`, `shadow_observations`, `shadow_suggestions`, `shadow_memory_search`, `shadow_memory_list`, `shadow_search`, `shadow_profile`, `shadow_events`, `shadow_contacts`, `shadow_systems`, `shadow_run_list`, `shadow_run_view`, `shadow_usage`, `shadow_daily_summary`, `shadow_feedback`, `shadow_soul`, `shadow_digests`, `shadow_enrichment_config`, `shadow_enrichment_query`, `shadow_relation_list`, `shadow_tasks`

### Write (38 level 1 + 3 level 2)
`shadow_repo_add`, `shadow_repo_update`, `shadow_repo_remove`, `shadow_project_add`, `shadow_project_remove`, `shadow_project_update`, `shadow_contact_add`, `shadow_contact_update`, `shadow_contact_remove`, `shadow_system_add`, `shadow_system_remove`, `shadow_memory_teach`, `shadow_memory_forget`, `shadow_memory_update`, `shadow_correct`, `shadow_suggest_accept`, `shadow_suggest_dismiss`, `shadow_suggest_snooze`, `shadow_observation_ack`, `shadow_observation_resolve`, `shadow_observation_reopen`, `shadow_profile_set`, `shadow_focus`, `shadow_available`, `shadow_events_ack`, `shadow_soul_update`, `shadow_relation_add`, `shadow_relation_remove`, `shadow_alert_ack`, `shadow_alert_resolve`, `shadow_run_archive`, `shadow_digest`, `shadow_enrichment_write`, `shadow_task_create`, `shadow_task_update`, `shadow_task_close`, `shadow_task_archive`, `shadow_task_remove`

### Write level 2
`shadow_observe`, `shadow_run_create`, `shadow_task_execute`
