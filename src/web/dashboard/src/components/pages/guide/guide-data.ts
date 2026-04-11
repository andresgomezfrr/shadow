// ── Types ──────────────────────────────────────────────

export type CliCommand = { command: string; args?: string; description: string };
export type CliGroup = { name: string; description: string; commands: CliCommand[] };

export type McpTool = { name: string; description: string; trust: number; readOnly: boolean };
export type McpCategory = { name: string; tools: McpTool[] };

export type ConfigVar = { envVar: string; description: string; defaultVal: string };

// ── CLI Commands ───────────────────────────────────────

export const CLI_GROUPS: CliGroup[] = [
  {
    name: 'General',
    description: 'Setup, status, and daily use',
    commands: [
      { command: 'shadow init', description: 'Bootstrap the global shadow home for this user (~/.shadow, hooks, launchd, soul)' },
      { command: 'shadow status', description: 'Show current shadow state summary (trust, repos, suggestions, heartbeat)' },
      { command: 'shadow doctor', description: 'Check local environment (Node, Claude CLI, daemon, DB, hooks)' },
      { command: 'shadow teach', description: 'Open interactive teaching session with Claude CLI' },
      { command: 'shadow ask', args: '<question...>', description: 'Ask Shadow a question from any terminal (one-shot, uses Claude CLI)' },
      { command: 'shadow summary', description: 'Get a daily summary of engineering activity' },
      { command: 'shadow usage', description: 'Show LLM token usage summary (today, week, month)' },
      { command: 'shadow web', description: 'Open the Shadow dashboard in your browser' },
    ],
  },
  {
    name: 'repo',
    description: 'Manage watched repositories',
    commands: [
      { command: 'shadow repo add', args: '<path>', description: 'Register a repo to watch' },
      { command: 'shadow repo list', description: 'List watched repos' },
      { command: 'shadow repo remove', args: '<repoId>', description: 'Stop watching a repo' },
      { command: 'shadow repo observe', description: 'Run observation on all repos (or a specific one)' },
    ],
  },
  {
    name: 'memory',
    description: 'Manage shadow memory',
    commands: [
      { command: 'shadow memory list', description: 'List memories (with optional layer/kind filters)' },
      { command: 'shadow memory search', args: '<query>', description: 'Search memories using full-text search' },
      { command: 'shadow memory teach', args: '<title>', description: 'Explicitly teach shadow something' },
      { command: 'shadow memory forget', args: '<memoryId>', description: 'Archive a memory' },
    ],
  },
  {
    name: 'contact',
    description: 'Manage team contacts',
    commands: [
      { command: 'shadow contact add', args: '<name>', description: 'Add a team member' },
      { command: 'shadow contact list', description: 'List team contacts' },
      { command: 'shadow contact remove', args: '<contactId>', description: 'Remove a contact' },
    ],
  },
  {
    name: 'project',
    description: 'Manage projects (groups of repos + systems)',
    commands: [
      { command: 'shadow project add', args: '<name>', description: 'Create a project' },
      { command: 'shadow project list', description: 'List projects' },
      { command: 'shadow project remove', args: '<projectId>', description: 'Remove a project' },
    ],
  },
  {
    name: 'system',
    description: 'Manage systems and infrastructure',
    commands: [
      { command: 'shadow system add', args: '<name>', description: 'Register a system or infrastructure component' },
      { command: 'shadow system list', description: 'List known systems' },
      { command: 'shadow system remove', args: '<systemId>', description: 'Remove a system' },
    ],
  },
  {
    name: 'digest',
    description: 'Generate and view digests',
    commands: [
      { command: 'shadow digest daily', description: 'Generate daily standup digest' },
      { command: 'shadow digest weekly', description: 'Generate weekly 1:1 digest' },
      { command: 'shadow digest brag', description: 'Generate/update quarterly brag doc' },
      { command: 'shadow digest list', description: 'List previous digests' },
    ],
  },
  {
    name: 'suggest',
    description: 'Manage suggestions',
    commands: [
      { command: 'shadow suggest list', description: 'List open suggestions' },
      { command: 'shadow suggest view', args: '<suggestionId>', description: 'View suggestion detail' },
      { command: 'shadow suggest accept', args: '<suggestionId>', description: 'Accept a suggestion (creates a run)' },
      { command: 'shadow suggest dismiss', args: '<suggestionId>', description: 'Dismiss a suggestion' },
      { command: 'shadow suggest snooze', args: '<suggestionId>', description: 'Snooze a suggestion for a given duration' },
    ],
  },
  {
    name: 'profile',
    description: 'Manage user profile and focus mode',
    commands: [
      { command: 'shadow profile show', description: 'Show current user profile' },
      { command: 'shadow profile trust', description: 'Show trust level and score' },
      { command: 'shadow profile set', args: '<key> <value>', description: 'Set a profile field (proactivityLevel, timezone, displayName)' },
      { command: 'shadow profile focus', args: '[duration]', description: 'Enter focus mode (proactivity -> 1). Optional: "2h", "30m"' },
      { command: 'shadow profile available', description: 'Exit focus mode, restore previous proactivity level' },
    ],
  },
  {
    name: 'daemon',
    description: 'Manage the background daemon',
    commands: [
      { command: 'shadow daemon start', description: 'Start the background daemon' },
      { command: 'shadow daemon stop', description: 'Stop the background daemon' },
      { command: 'shadow daemon restart', description: 'Restart the daemon (picks up code changes)' },
      { command: 'shadow daemon status', description: 'Show daemon status (PID, uptime, port)' },
      { command: 'shadow job <type>', description: 'Trigger any daemon job (heartbeat, suggest, reflect, consolidate, etc.)' },
      { command: 'shadow job list', description: 'List all available job types' },
    ],
  },
  {
    name: 'events',
    description: 'Manage pending events',
    commands: [
      { command: 'shadow events list', description: 'Show pending events' },
      { command: 'shadow events ack', description: 'Acknowledge all pending events' },
    ],
  },
  {
    name: 'task',
    description: 'Manage work tasks (containers for ongoing work)',
    commands: [
      { command: 'shadow task list', description: 'List tasks (filter by --status open|active|blocked|done)' },
      { command: 'shadow task create', args: '<title>', description: 'Create a new task (--ref <url>, --repo <path>, --session <id>)' },
      { command: 'shadow task update', args: '<id>', description: 'Update a task (--status, --title, --add-ref, --add-pr, --session)' },
      { command: 'shadow task close', args: '<id>', description: 'Close a task' },
      { command: 'shadow task remove', args: '<id>', description: 'Permanently delete a task' },
    ],
  },
  {
    name: 'run',
    description: 'Manage task runs',
    commands: [
      { command: 'shadow run list', description: 'List recent runs' },
      { command: 'shadow run view', args: '<runId>', description: 'View run detail' },
    ],
  },
];

// ── MCP Tools ──────────────────────────────────────────

export const MCP_CATEGORIES: McpCategory[] = [
  {
    name: 'Status & Context',
    tools: [
      { name: 'shadow_check_in', description: 'Get personality, mood, context, and pending updates. Call at conversation start.', trust: 0, readOnly: true },
      { name: 'shadow_status', description: 'Summary of trust level, repos, suggestions, events, and LLM usage.', trust: 0, readOnly: true },
      { name: 'shadow_profile', description: 'Returns the current user profile.', trust: 0, readOnly: true },
      { name: 'shadow_soul', description: "Read Shadow's current soul reflection.", trust: 0, readOnly: true },
      { name: 'shadow_daily_summary', description: "Comprehensive summary of today's engineering activity.", trust: 0, readOnly: true },
    ],
  },
  {
    name: 'Memory',
    tools: [
      { name: 'shadow_memory_search', description: 'Search memory using full-text search.', trust: 0, readOnly: true },
      { name: 'shadow_memory_list', description: 'List memories with pagination and filters.', trust: 0, readOnly: true },
      { name: 'shadow_search', description: 'Unified hybrid search (FTS5 + embeddings) across memories, observations, suggestions.', trust: 0, readOnly: true },
      { name: 'shadow_memory_teach', description: 'Teach Shadow something new by creating a memory.', trust: 1, readOnly: false },
      { name: 'shadow_memory_update', description: 'Update a memory: change layer, body, tags, kind, or scope.', trust: 1, readOnly: false },
      { name: 'shadow_memory_forget', description: 'Archive (forget) a memory by ID with a reason.', trust: 1, readOnly: false },
    ],
  },
  {
    name: 'Observations',
    tools: [
      { name: 'shadow_observations', description: 'List observations with pagination. Filter by repoId, projectId, kind, status. Kinds: improvement, risk, opportunity, pattern, infrastructure, cross_project.', trust: 0, readOnly: true },
      { name: 'shadow_observe', description: 'Trigger an observation cycle on repos.', trust: 2, readOnly: false },
      { name: 'shadow_observation_ack', description: 'Acknowledge an observation (mark as seen).', trust: 1, readOnly: false },
      { name: 'shadow_observation_resolve', description: 'Resolve an observation with optional reason.', trust: 1, readOnly: false },
      { name: 'shadow_observation_reopen', description: 'Reopen a done/acknowledged observation.', trust: 1, readOnly: false },
    ],
  },
  {
    name: 'Suggestions',
    tools: [
      { name: 'shadow_suggestions', description: 'List suggestions with pagination. Filter by status, projectId, repoId. Default: open, limit 20.', trust: 0, readOnly: true },
      { name: 'shadow_suggest_accept', description: 'Accept a suggestion (creates a run).', trust: 1, readOnly: false },
      { name: 'shadow_suggest_dismiss', description: 'Dismiss a suggestion with optional note.', trust: 1, readOnly: false },
      { name: 'shadow_suggest_snooze', description: 'Snooze a suggestion for a given number of hours.', trust: 1, readOnly: false },
    ],
  },
  {
    name: 'Tasks',
    tools: [
      { name: 'shadow_tasks', description: 'List tasks with filters (status, repoId, projectId).', trust: 0, readOnly: true },
      { name: 'shadow_task_create', description: 'Create a work task — link to external tickets, repos, projects, and a Claude session.', trust: 1, readOnly: false },
      { name: 'shadow_task_update', description: 'Update a task — change status, context, session, PRs, external refs. All states transition freely.', trust: 1, readOnly: false },
      { name: 'shadow_task_close', description: 'Close a task (mark as done).', trust: 1, readOnly: false },
      { name: 'shadow_task_archive', description: 'Archive a task to hide it from the workspace view.', trust: 1, readOnly: false },
      { name: 'shadow_task_execute', description: 'Create a run from a task — triggers automated execution.', trust: 2, readOnly: false },
      { name: 'shadow_task_remove', description: 'Permanently delete a task.', trust: 1, readOnly: false },
    ],
  },
  {
    name: 'Repos & Projects',
    tools: [
      { name: 'shadow_repos', description: 'List tracked repositories.', trust: 0, readOnly: true },
      { name: 'shadow_projects', description: 'List tracked projects. Filter by status.', trust: 0, readOnly: true },
      { name: 'shadow_active_projects', description: 'Returns projects detected as actively being worked on, with activity scores and momentum.', trust: 0, readOnly: true },
      { name: 'shadow_project_detail', description: 'Detailed project view: linked repos, systems, contacts, counts, top observations/suggestions/memories, enrichment, momentum.', trust: 0, readOnly: true },
      { name: 'shadow_repo_add', description: 'Register a new repository to watch.', trust: 1, readOnly: false },
      { name: 'shadow_repo_remove', description: 'Stop watching a repository.', trust: 1, readOnly: false },
      { name: 'shadow_project_add', description: 'Create a project (groups repos + systems + contacts).', trust: 1, readOnly: false },
      { name: 'shadow_project_remove', description: 'Remove a project.', trust: 1, readOnly: false },
      { name: 'shadow_project_update', description: 'Update a project (repos, systems, contacts, status).', trust: 1, readOnly: false },
    ],
  },
  {
    name: 'Team & Systems',
    tools: [
      { name: 'shadow_contacts', description: 'List contacts. Optionally filter by team.', trust: 0, readOnly: true },
      { name: 'shadow_systems', description: 'List tracked systems. Optionally filter by kind.', trust: 0, readOnly: true },
      { name: 'shadow_contact_add', description: 'Add a team member to contacts.', trust: 1, readOnly: false },
      { name: 'shadow_contact_remove', description: 'Remove a contact.', trust: 1, readOnly: false },
      { name: 'shadow_system_add', description: 'Register an infrastructure system or service.', trust: 1, readOnly: false },
      { name: 'shadow_system_remove', description: 'Remove a registered system.', trust: 1, readOnly: false },
    ],
  },
  {
    name: 'Relations',
    tools: [
      { name: 'shadow_relation_list', description: 'List entity relationships. Filter by source/target.', trust: 0, readOnly: true },
      { name: 'shadow_relation_add', description: 'Add a relationship between entities (e.g. repo depends_on system).', trust: 1, readOnly: false },
      { name: 'shadow_relation_remove', description: 'Remove an entity relationship.', trust: 1, readOnly: false },
    ],
  },
  {
    name: 'Enrichment',
    tools: [
      { name: 'shadow_enrichment_config', description: 'View enrichment config: available MCP servers, enabled status, interval, cache stats.', trust: 0, readOnly: true },
      { name: 'shadow_enrichment_query', description: 'Query enrichment cache. Filter by source, entityName, unreported status.', trust: 0, readOnly: true },
    ],
  },
  {
    name: 'Runs & Events',
    tools: [
      { name: 'shadow_run_list', description: 'List task runs. Filter by status, repo, archived. Supports pagination.', trust: 0, readOnly: true },
      { name: 'shadow_run_view', description: 'View details of a specific run.', trust: 0, readOnly: true },
      { name: 'shadow_run_create', description: 'Create a run directly from a Claude session (without a suggestion).', trust: 2, readOnly: false },
      { name: 'shadow_events', description: 'Returns pending (undelivered) events.', trust: 0, readOnly: true },
      { name: 'shadow_events_ack', description: 'Acknowledge all pending events.', trust: 1, readOnly: false },
    ],
  },
  {
    name: 'Digests & Usage',
    tools: [
      { name: 'shadow_digests', description: 'List previous digests. Filter by kind.', trust: 0, readOnly: true },
      { name: 'shadow_digest', description: 'Generate a digest on demand: daily, weekly, or brag.', trust: 1, readOnly: false },
      { name: 'shadow_usage', description: 'LLM token usage summary for a given period.', trust: 0, readOnly: true },
      { name: 'shadow_feedback', description: 'List recent user feedback (thumbs, dismiss reasons).', trust: 0, readOnly: true },
    ],
  },
  {
    name: 'Profile & Mode',
    tools: [
      { name: 'shadow_profile_set', description: 'Update a profile field (proactivityLevel, timezone, displayName).', trust: 1, readOnly: false },
      { name: 'shadow_focus', description: 'Enter focus mode (proactivity -> 1). Optional duration: "2h", "30m".', trust: 1, readOnly: false },
      { name: 'shadow_available', description: 'Exit focus mode, restore previous proactivity level.', trust: 1, readOnly: false },
      { name: 'shadow_soul_update', description: "Update Shadow's soul reflection.", trust: 1, readOnly: false },
    ],
  },
];

// ── Config Vars ────────────────────────────────────────

export const CONFIG_GENERAL: ConfigVar[] = [
  { envVar: 'SHADOW_DATA_DIR', description: 'Data directory for DB, logs, artifacts', defaultVal: '~/.shadow' },
  { envVar: 'SHADOW_BACKEND', description: 'LLM backend adapter', defaultVal: 'cli' },
  { envVar: 'SHADOW_CLAUDE_BIN', description: 'Path to Claude CLI binary', defaultVal: 'claude' },
  { envVar: 'SHADOW_ENV', description: 'Environment (development, test, production)', defaultVal: 'development' },
  { envVar: 'SHADOW_LOG_LEVEL', description: 'Log verbosity', defaultVal: 'info' },
  { envVar: 'SHADOW_LOCALE', description: 'Language/locale for Shadow responses', defaultVal: 'es' },
];

export const CONFIG_PERSONALITY: ConfigVar[] = [
  { envVar: 'SHADOW_PROACTIVITY_LEVEL', description: 'How proactive Shadow is (1 = silent, 10 = very active)', defaultVal: '5' },
];

export const CONFIG_TIMING: ConfigVar[] = [
  { envVar: 'SHADOW_HEARTBEAT_INTERVAL_MS', description: 'Heartbeat interval', defaultVal: '900000 (15min)' },
  { envVar: 'SHADOW_DAEMON_POLL_INTERVAL_MS', description: 'Daemon poll interval', defaultVal: '30000 (30s)' },
  { envVar: 'SHADOW_RUNNER_TIMEOUT_MS', description: 'Max time for a runner execution', defaultVal: '1800000 (30min)' },
];

export const CONFIG_MODELS: ConfigVar[] = [
  { envVar: 'SHADOW_MODEL_ANALYZE', description: 'Model for heartbeat analyze phase', defaultVal: 'sonnet' },
  { envVar: 'SHADOW_MODEL_SUGGEST', description: 'Model for suggestion generation', defaultVal: 'opus' },
  { envVar: 'SHADOW_MODEL_CONSOLIDATE', description: 'Model for memory consolidation', defaultVal: 'sonnet' },
  { envVar: 'SHADOW_MODEL_RUNNER', description: 'Model for task execution', defaultVal: 'opus' },
  { envVar: 'SHADOW_MODEL_THOUGHT', description: 'Model for ambient thoughts', defaultVal: 'haiku' },
];

export const CONFIG_EFFORTS: ConfigVar[] = [
  { envVar: 'SHADOW_EFFORT_ANALYZE', description: 'Effort level for analyze phase', defaultVal: 'medium' },
  { envVar: 'SHADOW_EFFORT_SUGGEST', description: 'Effort level for suggestions', defaultVal: 'high' },
  { envVar: 'SHADOW_EFFORT_CONSOLIDATE', description: 'Effort level for consolidation', defaultVal: 'medium' },
  { envVar: 'SHADOW_EFFORT_RUNNER', description: 'Effort level for runner', defaultVal: 'high' },
];

export const CONFIG_ADVANCED: ConfigVar[] = [
  { envVar: 'SHADOW_THOUGHTS_ENABLED', description: 'Enable ambient thoughts system', defaultVal: 'true' },
  { envVar: 'SHADOW_THOUGHT_INTERVAL_MIN_MS', description: 'Min interval between thoughts', defaultVal: '900000 (15min)' },
  { envVar: 'SHADOW_THOUGHT_INTERVAL_MAX_MS', description: 'Max interval between thoughts', defaultVal: '1800000 (30min)' },
  { envVar: 'SHADOW_MAX_WATCHED_REPOS', description: 'Maximum repos Shadow can watch', defaultVal: '30' },
  { envVar: 'SHADOW_REMOTE_SYNC_ENABLED', description: 'Enable periodic git remote sync (ls-remote)', defaultVal: 'true' },
  { envVar: 'SHADOW_REMOTE_SYNC_INTERVAL_MS', description: 'Remote sync interval', defaultVal: '1800000 (30min)' },
  { envVar: 'SHADOW_ENRICHMENT_ENABLED', description: 'Enable MCP-based context enrichment', defaultVal: 'false' },
  { envVar: 'SHADOW_ENRICHMENT_INTERVAL_MS', description: 'Enrichment cycle interval', defaultVal: '7200000 (2h)' },
];

// ── Trust Levels ───────────────────────────────────────

export const TRUST_LEVELS = [
  { level: 1, score: '0-15', name: 'observer', badge: '\uD83D\uDD0D', capabilities: 'Read-only. Teach memories, view observations.' },
  { level: 2, score: '15-35', name: 'advisor', badge: '\uD83D\uDCAC', capabilities: 'Generate suggestions. Accept creates run plans.' },
  { level: 3, score: '35-60', name: 'assistant', badge: '\uD83E\uDD1D', capabilities: 'Execute tasks. Pre-loaded CLI sessions.' },
  { level: 4, score: '60-85', name: 'partner', badge: '\u26A1\uFE0F', capabilities: 'Autonomous execution with review. Worktrees.' },
  { level: 5, score: '85-100', name: 'shadow', badge: '\uD83D\uDC7E', capabilities: 'Full autonomy. Branch, test, PR.' },
];

// ── Memory Layers ──────────────────────────────────────

export const MEMORY_LAYERS = [
  { emoji: '\uD83D\uDFE3', name: 'core', decay: 'Never', description: 'Permanent knowledge. Infrastructure, team, conventions.' },
  { emoji: '\uD83D\uDD34', name: 'hot', decay: '14 days', description: 'Active work context. Current tasks and recent decisions.' },
  { emoji: '\uD83D\uDFE0', name: 'warm', decay: '30 days', description: 'Recent knowledge. Past sprint context.' },
  { emoji: '\uD83D\uDD35', name: 'cool', decay: '90 days', description: 'Archive. Referenced occasionally.' },
  { emoji: '\u26AA', name: 'cold', decay: 'Yes', description: 'Passive archive. Lowest search priority.' },
];
