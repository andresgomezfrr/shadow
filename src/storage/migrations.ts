import type { DatabaseSync } from 'node:sqlite';

export type Migration = {
  version: number;
  name: string;
  sql: string;
};

export const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS repos (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        remote_url TEXT,
        default_branch TEXT NOT NULL DEFAULT 'main',
        language_hint TEXT,
        test_command TEXT,
        lint_command TEXT,
        build_command TEXT,
        last_observed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user_profile (
        id TEXT PRIMARY KEY DEFAULT 'default',
        display_name TEXT,
        timezone TEXT,
        locale TEXT NOT NULL DEFAULT 'es',
        work_hours_json TEXT NOT NULL DEFAULT '{}',
        commit_patterns_json TEXT NOT NULL DEFAULT '{}',
        verbosity TEXT NOT NULL DEFAULT 'normal',
        proactive_level TEXT NOT NULL DEFAULT 'moderate',
        trust_level INTEGER NOT NULL DEFAULT 1,
        trust_score REAL NOT NULL DEFAULT 0.0,
        bond_level REAL NOT NULL DEFAULT 0.0,
        total_interactions INTEGER NOT NULL DEFAULT 0,
        preferences_json TEXT NOT NULL DEFAULT '{}',
        dislikes_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        repo_id TEXT,
        layer TEXT NOT NULL,
        scope TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        body_md TEXT NOT NULL,
        tags_json TEXT NOT NULL DEFAULT '[]',
        source_type TEXT NOT NULL,
        confidence_score INTEGER NOT NULL DEFAULT 70,
        relevance_score REAL NOT NULL DEFAULT 0.5,
        access_count INTEGER NOT NULL DEFAULT 0,
        last_accessed_at TEXT,
        promoted_from TEXT,
        demoted_to TEXT,
        expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT,
        FOREIGN KEY(repo_id) REFERENCES repos(id)
      );

      CREATE INDEX IF NOT EXISTS idx_memories_layer ON memories(layer, archived_at);
      CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope, repo_id);
      CREATE INDEX IF NOT EXISTS idx_memories_kind ON memories(kind);

      CREATE TABLE IF NOT EXISTS observations (
        id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'info',
        title TEXT NOT NULL,
        detail_json TEXT NOT NULL DEFAULT '{}',
        processed INTEGER NOT NULL DEFAULT 0,
        suggestion_id TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(repo_id) REFERENCES repos(id)
      );

      CREATE INDEX IF NOT EXISTS idx_observations_repo ON observations(repo_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_observations_unprocessed ON observations(processed, created_at);

      CREATE TABLE IF NOT EXISTS suggestions (
        id TEXT PRIMARY KEY,
        repo_id TEXT,
        source_observation_id TEXT,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        summary_md TEXT NOT NULL,
        reasoning_md TEXT,
        impact_score INTEGER NOT NULL DEFAULT 3,
        confidence_score INTEGER NOT NULL DEFAULT 70,
        risk_score INTEGER NOT NULL DEFAULT 2,
        required_trust_level INTEGER NOT NULL DEFAULT 5,
        status TEXT NOT NULL DEFAULT 'pending',
        feedback_note TEXT,
        shown_at TEXT,
        resolved_at TEXT,
        created_at TEXT NOT NULL,
        expires_at TEXT,
        FOREIGN KEY(repo_id) REFERENCES repos(id),
        FOREIGN KEY(source_observation_id) REFERENCES observations(id)
      );

      CREATE INDEX IF NOT EXISTS idx_suggestions_status ON suggestions(status, created_at DESC);

      CREATE TABLE IF NOT EXISTS heartbeats (
        id TEXT PRIMARY KEY,
        phase TEXT NOT NULL,
        activity TEXT,
        repos_observed_json TEXT NOT NULL DEFAULT '[]',
        observations_created INTEGER NOT NULL DEFAULT 0,
        suggestions_created INTEGER NOT NULL DEFAULT 0,
        duration_ms INTEGER,
        started_at TEXT NOT NULL,
        finished_at TEXT
      );

      CREATE TABLE IF NOT EXISTS interactions (
        id TEXT PRIMARY KEY,
        interface TEXT NOT NULL,
        kind TEXT NOT NULL,
        input_summary TEXT,
        output_summary TEXT,
        sentiment TEXT,
        topics_json TEXT NOT NULL DEFAULT '[]',
        trust_delta REAL NOT NULL DEFAULT 0.0,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_interactions_created ON interactions(created_at DESC);

      CREATE TABLE IF NOT EXISTS event_queue (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 5,
        payload_json TEXT NOT NULL DEFAULT '{}',
        delivered INTEGER NOT NULL DEFAULT 0,
        delivered_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_events_pending ON event_queue(delivered, priority DESC, created_at);

      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL,
        suggestion_id TEXT,
        kind TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        prompt TEXT NOT NULL,
        result_summary_md TEXT,
        error_summary TEXT,
        artifact_dir TEXT,
        started_at TEXT,
        finished_at TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(repo_id) REFERENCES repos(id),
        FOREIGN KEY(suggestion_id) REFERENCES suggestions(id)
      );

      CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status, created_at);

      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        actor TEXT NOT NULL DEFAULT 'shadow',
        interface TEXT NOT NULL,
        action TEXT NOT NULL,
        target_kind TEXT,
        target_id TEXT,
        detail_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_events(action, created_at DESC);
    `,
  },
  {
    version: 2,
    name: 'expanded_scope',
    sql: `
      -- Systems/infrastructure Shadow knows about
      CREATE TABLE IF NOT EXISTS systems (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        url TEXT,
        description TEXT,
        access_method TEXT,
        config_json TEXT NOT NULL DEFAULT '{}',
        health_check TEXT,
        last_checked_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_systems_kind ON systems(kind);

      -- Team members Shadow knows about
      CREATE TABLE IF NOT EXISTS contacts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT,
        team TEXT,
        email TEXT,
        slack_id TEXT,
        github_handle TEXT,
        notes_md TEXT,
        preferred_channel TEXT,
        last_mentioned_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_contacts_team ON contacts(team);

      -- Cost tracking for LLM usage
      CREATE TABLE IF NOT EXISTS llm_usage (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        source_id TEXT,
        model TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_llm_usage_created ON llm_usage(created_at);

      -- FTS5 index for memories
      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        title, body_md, tags_text,
        content='memories', content_rowid='rowid',
        tokenize='unicode61'
      );

      -- FTS sync triggers
      CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, title, body_md, tags_text)
        VALUES (NEW.rowid, NEW.title, NEW.body_md, NEW.tags_json);
      END;

      CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, title, body_md, tags_text)
        VALUES ('delete', OLD.rowid, OLD.title, OLD.body_md, OLD.tags_json);
      END;

      CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, title, body_md, tags_text)
        VALUES ('delete', OLD.rowid, OLD.title, OLD.body_md, OLD.tags_json);
        INSERT INTO memories_fts(rowid, title, body_md, tags_text)
        VALUES (NEW.rowid, NEW.title, NEW.body_md, NEW.tags_json);
      END;

      -- Expand user_profile
      ALTER TABLE user_profile ADD COLUMN proactivity_level INTEGER NOT NULL DEFAULT 5;
      ALTER TABLE user_profile ADD COLUMN personality_level INTEGER NOT NULL DEFAULT 4;
      ALTER TABLE user_profile ADD COLUMN focus_mode TEXT;
      ALTER TABLE user_profile ADD COLUMN focus_until TEXT;
      ALTER TABLE user_profile ADD COLUMN energy_level TEXT;
      ALTER TABLE user_profile ADD COLUMN mood_hint TEXT;

      -- Source-agnostic observations
      ALTER TABLE observations ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'repo';
      ALTER TABLE observations ADD COLUMN source_id TEXT;

      CREATE INDEX IF NOT EXISTS idx_observations_source ON observations(source_kind, source_id);

      -- Memory references to contacts and systems
      ALTER TABLE memories ADD COLUMN contact_id TEXT REFERENCES contacts(id);
      ALTER TABLE memories ADD COLUMN system_id TEXT REFERENCES systems(id);

      -- Multi-repo support
      ALTER TABLE suggestions ADD COLUMN repo_ids_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE runs ADD COLUMN repo_ids_json TEXT NOT NULL DEFAULT '[]';

      -- Backfill FTS index for existing memories
      INSERT INTO memories_fts(rowid, title, body_md, tags_text)
      SELECT rowid, title, body_md, tags_json FROM memories;
    `,
  },
  {
    version: 3,
    name: 'observation_lifecycle',
    sql: `
      -- Observation lifecycle: votes, status, timestamps, context
      ALTER TABLE observations ADD COLUMN votes INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE observations ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
      ALTER TABLE observations ADD COLUMN first_seen_at TEXT;
      ALTER TABLE observations ADD COLUMN last_seen_at TEXT;
      ALTER TABLE observations ADD COLUMN context_json TEXT NOT NULL DEFAULT '{}';

      -- Backfill timestamps from created_at
      UPDATE observations SET first_seen_at = created_at, last_seen_at = created_at WHERE first_seen_at IS NULL;

      -- Mark old repo-source observations as expired
      UPDATE observations SET status = 'expired' WHERE source_kind = 'repo';

      -- Index for status-filtered queries
      CREATE INDEX IF NOT EXISTS idx_observations_status ON observations(status, last_seen_at DESC);

      -- Index for dedup lookups
      CREATE INDEX IF NOT EXISTS idx_observations_dedup ON observations(repo_id, kind, title);
    `,
  },
  {
    version: 4,
    name: 'heartbeat_phases',
    sql: `
      ALTER TABLE heartbeats ADD COLUMN phases_json TEXT NOT NULL DEFAULT '[]';
    `,
  },
  {
    version: 5,
    name: 'heartbeat_stats',
    sql: `
      ALTER TABLE heartbeats ADD COLUMN llm_calls INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE heartbeats ADD COLUMN tokens_used INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE heartbeats ADD COLUMN events_queued INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE heartbeats ADD COLUMN memories_promoted INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE heartbeats ADD COLUMN memories_demoted INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    version: 6,
    name: 'run_session',
    sql: `
      ALTER TABLE runs ADD COLUMN session_id TEXT;
      ALTER TABLE runs ADD COLUMN parent_run_id TEXT;
    `,
  },
  {
    version: 7,
    name: 'run_worktree_archive',
    sql: `
      ALTER TABLE runs ADD COLUMN worktree_path TEXT;
      ALTER TABLE runs ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    version: 8,
    name: 'memory_source_id',
    sql: `
      ALTER TABLE memories ADD COLUMN source_id TEXT;
      CREATE INDEX IF NOT EXISTS idx_memories_source ON memories(source_type, source_id);
    `,
  },
];

export function applyMigrations(database: DatabaseSync): void {
  database.exec('PRAGMA foreign_keys = ON;');
  database.exec('PRAGMA journal_mode = WAL;');
  database.exec('PRAGMA busy_timeout = 5000;');

  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const getAppliedVersions = database.prepare('SELECT version FROM schema_migrations ORDER BY version ASC');
  const applied = new Set<number>(
    getAppliedVersions.all().map((row) => Number((row as { version: number }).version)),
  );

  const insertMigration = database.prepare(
    'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
  );

  for (const migration of migrations) {
    if (applied.has(migration.version)) {
      continue;
    }

    database.exec('BEGIN');
    try {
      database.exec(migration.sql);
      insertMigration.run(migration.version, migration.name, new Date().toISOString());
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }
}
