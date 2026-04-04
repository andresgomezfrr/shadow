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
  {
    version: 9,
    name: 'feedback_table',
    sql: `
      CREATE TABLE IF NOT EXISTS feedback (
        id TEXT PRIMARY KEY,
        target_kind TEXT NOT NULL,
        target_id TEXT NOT NULL,
        action TEXT NOT NULL,
        note TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_feedback_target ON feedback(target_kind, created_at DESC);
    `,
  },
  {
    version: 10,
    name: 'jobs_table',
    sql: `
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        phase TEXT NOT NULL DEFAULT 'running',
        phases_json TEXT NOT NULL DEFAULT '[]',
        activity TEXT,
        status TEXT NOT NULL DEFAULT 'running',
        llm_calls INTEGER NOT NULL DEFAULT 0,
        tokens_used INTEGER NOT NULL DEFAULT 0,
        result_json TEXT NOT NULL DEFAULT '{}',
        duration_ms INTEGER,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_jobs_type ON jobs(type, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, created_at DESC);
    `,
  },
  {
    version: 11,
    name: 'drop_heartbeats',
    sql: `
      DROP TABLE IF EXISTS heartbeats;
    `,
  },
  {
    version: 12,
    name: 'feedback_thumbs_index',
    sql: `
      CREATE INDEX IF NOT EXISTS idx_feedback_thumbs
        ON feedback(target_kind, action, created_at DESC);
    `,
  },
  {
    version: 13,
    name: 'filter_pagination_indexes',
    sql: `
      CREATE INDEX IF NOT EXISTS idx_suggestions_kind ON suggestions(kind);
      CREATE INDEX IF NOT EXISTS idx_observations_status ON observations(status, last_seen_at DESC);
      CREATE INDEX IF NOT EXISTS idx_jobs_type ON jobs(type, started_at DESC);
    `,
  },
  {
    version: 14,
    name: 'projects_and_entity_linking',
    sql: `
      -- Projects entity
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        kind TEXT NOT NULL DEFAULT 'long-term',
        status TEXT NOT NULL DEFAULT 'active',
        repo_ids_json TEXT NOT NULL DEFAULT '[]',
        system_ids_json TEXT NOT NULL DEFAULT '[]',
        contact_ids_json TEXT NOT NULL DEFAULT '[]',
        start_date TEXT,
        end_date TEXT,
        notes_md TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);

      -- Unified entity linking: memories
      ALTER TABLE memories ADD COLUMN entities_json TEXT NOT NULL DEFAULT '[]';

      -- Unified entity linking: observations (+ multi-repo)
      ALTER TABLE observations ADD COLUMN repo_ids_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE observations ADD COLUMN entities_json TEXT NOT NULL DEFAULT '[]';

      -- Unified entity linking: suggestions
      ALTER TABLE suggestions ADD COLUMN entities_json TEXT NOT NULL DEFAULT '[]';

      -- Backfill: memories entities from repo_id/contact_id/system_id
      UPDATE memories SET entities_json = json_array(json_object('type', 'repo', 'id', repo_id))
        WHERE repo_id IS NOT NULL AND entities_json = '[]';
      UPDATE memories SET entities_json = json_insert(entities_json, '$[#]', json_object('type', 'contact', 'id', contact_id))
        WHERE contact_id IS NOT NULL;
      UPDATE memories SET entities_json = json_insert(entities_json, '$[#]', json_object('type', 'system', 'id', system_id))
        WHERE system_id IS NOT NULL;

      -- Backfill: observations repo_ids_json + entities from repo_id
      UPDATE observations SET
        repo_ids_json = json_array(repo_id),
        entities_json = json_array(json_object('type', 'repo', 'id', repo_id))
        WHERE repo_id IS NOT NULL AND repo_ids_json = '[]';

      -- Backfill: suggestions entities from repo_ids_json
      UPDATE suggestions SET entities_json = (
        SELECT COALESCE(json_group_array(json_object('type', 'repo', 'id', value)), '[]')
        FROM json_each(suggestions.repo_ids_json)
      ) WHERE repo_ids_json != '[]' AND entities_json = '[]';
    `,
  },
  {
    version: 17,
    name: 'fts5_observations_suggestions',
    sql: `
      -- FTS5 for observations
      CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts USING fts5(
        title, detail_text,
        content='observations', content_rowid='rowid',
        tokenize='unicode61'
      );
      CREATE TRIGGER IF NOT EXISTS observations_fts_ai AFTER INSERT ON observations BEGIN
        INSERT INTO observations_fts(rowid, title, detail_text)
        VALUES (NEW.rowid, NEW.title, NEW.detail_json);
      END;
      CREATE TRIGGER IF NOT EXISTS observations_fts_ad AFTER DELETE ON observations BEGIN
        INSERT INTO observations_fts(observations_fts, rowid, title, detail_text)
        VALUES ('delete', OLD.rowid, OLD.title, OLD.detail_json);
      END;
      CREATE TRIGGER IF NOT EXISTS observations_fts_au AFTER UPDATE ON observations BEGIN
        INSERT INTO observations_fts(observations_fts, rowid, title, detail_text)
        VALUES ('delete', OLD.rowid, OLD.title, OLD.detail_json);
        INSERT INTO observations_fts(rowid, title, detail_text)
        VALUES (NEW.rowid, NEW.title, NEW.detail_json);
      END;

      -- FTS5 for suggestions
      CREATE VIRTUAL TABLE IF NOT EXISTS suggestions_fts USING fts5(
        title, summary_md,
        content='suggestions', content_rowid='rowid',
        tokenize='unicode61'
      );
      CREATE TRIGGER IF NOT EXISTS suggestions_fts_ai AFTER INSERT ON suggestions BEGIN
        INSERT INTO suggestions_fts(rowid, title, summary_md)
        VALUES (NEW.rowid, NEW.title, NEW.summary_md);
      END;
      CREATE TRIGGER IF NOT EXISTS suggestions_fts_ad AFTER DELETE ON suggestions BEGIN
        INSERT INTO suggestions_fts(suggestions_fts, rowid, title, summary_md)
        VALUES ('delete', OLD.rowid, OLD.title, OLD.summary_md);
      END;
      CREATE TRIGGER IF NOT EXISTS suggestions_fts_au AFTER UPDATE ON suggestions BEGIN
        INSERT INTO suggestions_fts(suggestions_fts, rowid, title, summary_md)
        VALUES ('delete', OLD.rowid, OLD.title, OLD.summary_md);
        INSERT INTO suggestions_fts(rowid, title, summary_md)
        VALUES (NEW.rowid, NEW.title, NEW.summary_md);
      END;

      -- Backfill existing data into FTS indexes
      INSERT INTO observations_fts(rowid, title, detail_text)
        SELECT rowid, title, detail_json FROM observations;
      INSERT INTO suggestions_fts(rowid, title, summary_md)
        SELECT rowid, title, summary_md FROM suggestions;
    `,
  },
  {
    version: 15,
    name: 'vector_tables',
    sql: `
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_vectors USING vec0(
        id TEXT PRIMARY KEY,
        embedding FLOAT[384]
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS observation_vectors USING vec0(
        id TEXT PRIMARY KEY,
        embedding FLOAT[384]
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS suggestion_vectors USING vec0(
        id TEXT PRIMARY KEY,
        embedding FLOAT[384]
      );
    `,
  },
  {
    version: 20,
    name: 'digests_table',
    sql: `
      CREATE TABLE IF NOT EXISTS digests (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        content_md TEXT NOT NULL,
        model TEXT NOT NULL DEFAULT 'sonnet',
        tokens_used INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_digests_kind ON digests(kind, period_start DESC);
    `,
  },
  {
    version: 18,
    name: 'system_operational_fields',
    sql: `
      ALTER TABLE systems ADD COLUMN logs_location TEXT;
      ALTER TABLE systems ADD COLUMN deploy_method TEXT;
      ALTER TABLE systems ADD COLUMN debug_guide TEXT;
      ALTER TABLE systems ADD COLUMN related_repos_json TEXT NOT NULL DEFAULT '[]';
    `,
  },
  {
    version: 21,
    name: 'run_confidence_doubts',
    sql: `
      ALTER TABLE runs ADD COLUMN confidence TEXT;
      ALTER TABLE runs ADD COLUMN doubts_json TEXT NOT NULL DEFAULT '[]';
    `,
  },
  {
    version: 22,
    name: 'run_pr_url',
    sql: `
      ALTER TABLE runs ADD COLUMN pr_url TEXT;
    `,
  },
  {
    version: 23,
    name: 'job_queue',
    sql: `
      ALTER TABLE jobs ADD COLUMN priority INTEGER NOT NULL DEFAULT 5;
      ALTER TABLE jobs ADD COLUMN trigger_source TEXT NOT NULL DEFAULT 'schedule';
      CREATE INDEX IF NOT EXISTS idx_jobs_queue ON jobs(status, priority DESC, created_at ASC);
    `,
  },
  {
    version: 24,
    name: 'run_checkpoint',
    sql: `
      ALTER TABLE runs ADD COLUMN snapshot_ref TEXT;
      ALTER TABLE runs ADD COLUMN result_ref TEXT;
      ALTER TABLE runs ADD COLUMN diff_stat TEXT;
    `,
  },
  {
    version: 25,
    name: 'run_verification',
    sql: `
      ALTER TABLE runs ADD COLUMN verification_json TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE runs ADD COLUMN verified TEXT;
    `,
  },
  {
    version: 26,
    name: 'entity_relations',
    sql: `
      CREATE TABLE IF NOT EXISTS entity_relations (
        id TEXT PRIMARY KEY,
        source_type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        relation TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0.8,
        source_origin TEXT NOT NULL DEFAULT 'auto',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_entity_rel_source ON entity_relations(source_type, source_id);
      CREATE INDEX IF NOT EXISTS idx_entity_rel_target ON entity_relations(target_type, target_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_entity_rel_pair ON entity_relations(source_type, source_id, relation, target_type, target_id);
    `,
  },
  {
    version: 27,
    name: 'memory_episodic_semantic',
    sql: `
      ALTER TABLE memories ADD COLUMN memory_type TEXT NOT NULL DEFAULT 'unclassified';
      ALTER TABLE memories ADD COLUMN valid_from TEXT;
      ALTER TABLE memories ADD COLUMN valid_until TEXT;
      ALTER TABLE memories ADD COLUMN source_memory_ids_json TEXT NOT NULL DEFAULT '[]';
      CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(memory_type, layer, archived_at);
    `,
  },
  {
    version: 28,
    name: 'scalability_indexes',
    sql: `
      CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_observations_created_status ON observations(status, created_at DESC);
    `,
  },
  {
    version: 29,
    name: 'repo_last_fetched',
    sql: `
      ALTER TABLE repos ADD COLUMN last_fetched_at TEXT;
    `,
  },
  {
    version: 30,
    name: 'enrichment_cache',
    sql: `
      CREATE TABLE IF NOT EXISTS enrichment_cache (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        entity_type TEXT,
        entity_id TEXT,
        entity_name TEXT,
        summary TEXT NOT NULL,
        detail_json TEXT NOT NULL DEFAULT '{}',
        content_hash TEXT NOT NULL,
        reported INTEGER NOT NULL DEFAULT 0,
        stale INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        expires_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_enrichment_source ON enrichment_cache(source);
      CREATE INDEX IF NOT EXISTS idx_enrichment_reported ON enrichment_cache(reported);
      CREATE INDEX IF NOT EXISTS idx_enrichment_hash ON enrichment_cache(content_hash);
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
