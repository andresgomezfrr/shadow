import type { DatabaseSync } from 'node:sqlite';
import { copyFileSync, readdirSync, unlinkSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';

export type Migration = {
  version: number;
  name: string;
  sql: string;
  /**
   * Optional sanity check run AFTER the migration SQL but BEFORE COMMIT.
   * Used for big-bang schema drops (e.g. backfill → DROP COLUMN) where an
   * incomplete backfill would silently lose data on DROP. The check receives
   * the in-transaction database handle and should throw if the invariant
   * is violated — throwing triggers ROLLBACK so the migration doesn't apply.
   * See audit S-01.
   */
  assertInvariant?: (db: DatabaseSync) => void;
};

/**
 * Helper: throws if backfill row counts don't match, used in assertInvariant
 * for migrations that DROP a JSON column after copying to a junction table.
 * `sourceSql` = count of rows that should have links. `linkSql` = count of
 * distinct source rows present in the junction. If `linkSql < sourceSql`,
 * backfill is incomplete and committing would drop data.
 */
export function assertBackfillComplete(
  db: DatabaseSync,
  opts: { label: string; sourceSql: string; linkSql: string },
): void {
  const source = (db.prepare(opts.sourceSql).get() as { n: number } | undefined)?.n ?? 0;
  const link = (db.prepare(opts.linkSql).get() as { n: number } | undefined)?.n ?? 0;
  if (link < source) {
    throw new Error(
      `[migration ${opts.label}] backfill incomplete: expected ${source} linked rows, found ${link}. ` +
      `Aborting to protect data (ROLLBACK). Investigate the source table for malformed rows before retrying.`,
    );
  }
}

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
  {
    version: 31,
    name: 'feedback_category_and_repo_context',
    sql: `
      ALTER TABLE feedback ADD COLUMN category TEXT;
      CREATE INDEX IF NOT EXISTS idx_feedback_category ON feedback(target_kind, category, created_at DESC);
      ALTER TABLE repos ADD COLUMN context_md TEXT;
      ALTER TABLE repos ADD COLUMN context_updated_at TEXT;
    `,
  },
  {
    version: 32,
    name: 'project_context',
    sql: `
      ALTER TABLE projects ADD COLUMN context_md TEXT;
      ALTER TABLE projects ADD COLUMN context_updated_at TEXT;
    `,
  },
  {
    version: 33,
    name: 'mood_phrase',
    sql: `
      ALTER TABLE user_profile ADD COLUMN mood_phrase TEXT;
    `,
  },
  {
    version: 34,
    name: 'repo_last_remote_head',
    sql: `
      ALTER TABLE repos ADD COLUMN last_remote_head TEXT;
    `,
  },
  {
    version: 35,
    name: 'enrichment_vectors',
    sql: `
      CREATE VIRTUAL TABLE IF NOT EXISTS enrichment_vectors USING vec0(
        id TEXT PRIMARY KEY,
        embedding FLOAT[384]
      );
    `,
  },
  {
    version: 36,
    name: 'enrichment_intelligence',
    sql: `
      ALTER TABLE enrichment_cache ADD COLUMN ttl_category TEXT;
      ALTER TABLE enrichment_cache ADD COLUMN refresh_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE enrichment_cache ADD COLUMN change_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE enrichment_cache ADD COLUMN access_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE enrichment_cache ADD COLUMN last_consumed_at TEXT;
      CREATE INDEX IF NOT EXISTS idx_enrichment_entity ON enrichment_cache(entity_id, entity_type, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_enrichment_expiry ON enrichment_cache(expires_at, stale);
    `,
  },
  {
    version: 37,
    name: 'run_closed_status',
    sql: `
      ALTER TABLE runs ADD COLUMN closed_note TEXT;
    `,
  },
  {
    version: 38,
    name: 'suggestion_revalidation',
    sql: `
      ALTER TABLE suggestions ADD COLUMN revalidation_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE suggestions ADD COLUMN last_revalidated_at TEXT;
      ALTER TABLE suggestions ADD COLUMN revalidation_verdict TEXT;
      ALTER TABLE suggestions ADD COLUMN revalidation_note TEXT;
    `,
  },
  {
    version: 39,
    name: 'event_read_at',
    sql: `
      ALTER TABLE event_queue ADD COLUMN read_at TEXT;
    `,
  },
  {
    version: 40,
    name: 'tasks',
    sql: `
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'todo',
        context_md TEXT,
        external_refs_json TEXT NOT NULL DEFAULT '[]',
        repo_ids_json TEXT NOT NULL DEFAULT '[]',
        project_id TEXT,
        entities_json TEXT NOT NULL DEFAULT '[]',
        session_id TEXT,
        session_repo_path TEXT,
        pr_urls_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        closed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    `,
  },
  {
    version: 41,
    name: 'run_activity',
    sql: `
      ALTER TABLE runs ADD COLUMN activity TEXT;
    `,
  },
  {
    version: 42,
    name: 'unified_lifecycle',
    sql: `
      -- New fields
      ALTER TABLE tasks ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE tasks ADD COLUMN suggestion_id TEXT;
      ALTER TABLE runs ADD COLUMN task_id TEXT;
      ALTER TABLE runs ADD COLUMN outcome TEXT;

      -- Observation renames
      UPDATE observations SET status = 'open' WHERE status = 'active';
      UPDATE observations SET status = 'done' WHERE status = 'resolved';

      -- Suggestion renames
      UPDATE suggestions SET status = 'open' WHERE status = 'pending';
      UPDATE suggestions SET status = 'accepted' WHERE status = 'backlog';

      -- Task renames
      UPDATE tasks SET status = 'open' WHERE status = 'todo';
      UPDATE tasks SET status = 'active' WHERE status = 'in_progress';
      UPDATE tasks SET status = 'done' WHERE status = 'closed';

      -- Run renames + outcome
      UPDATE runs SET outcome = 'executed' WHERE status = 'executed';
      UPDATE runs SET outcome = 'executed_manual' WHERE status = 'executed_manual';
      UPDATE runs SET outcome = 'closed' WHERE status = 'closed';
      UPDATE runs SET status = 'done' WHERE status IN ('executed', 'executed_manual', 'closed');
      UPDATE runs SET status = 'dismissed' WHERE status = 'discarded';
    `,
  },
  {
    version: 43,
    name: 'run_planned_status',
    sql: `
      UPDATE runs SET status = 'planned' WHERE status = 'completed';
    `,
  },
  {
    version: 44,
    name: 'entity_links_junction',
    sql: `
      CREATE TABLE IF NOT EXISTS entity_links (
        source_table TEXT NOT NULL,
        source_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        PRIMARY KEY (source_table, source_id, entity_type, entity_id)
      );
      CREATE INDEX IF NOT EXISTS idx_entity_links_target ON entity_links(entity_type, entity_id, source_table);

      -- Backfill from memories
      INSERT OR IGNORE INTO entity_links (source_table, source_id, entity_type, entity_id)
      SELECT 'memories', m.id, json_extract(j.value, '$.type'), json_extract(j.value, '$.id')
      FROM memories m, json_each(m.entities_json) j
      WHERE m.entities_json IS NOT NULL AND m.entities_json != '[]' AND m.entities_json != '';

      -- Backfill from observations
      INSERT OR IGNORE INTO entity_links (source_table, source_id, entity_type, entity_id)
      SELECT 'observations', o.id, json_extract(j.value, '$.type'), json_extract(j.value, '$.id')
      FROM observations o, json_each(o.entities_json) j
      WHERE o.entities_json IS NOT NULL AND o.entities_json != '[]' AND o.entities_json != '';

      -- Backfill from suggestions
      INSERT OR IGNORE INTO entity_links (source_table, source_id, entity_type, entity_id)
      SELECT 'suggestions', s.id, json_extract(j.value, '$.type'), json_extract(j.value, '$.id')
      FROM suggestions s, json_each(s.entities_json) j
      WHERE s.entities_json IS NOT NULL AND s.entities_json != '[]' AND s.entities_json != '';

      -- Backfill from tasks
      INSERT OR IGNORE INTO entity_links (source_table, source_id, entity_type, entity_id)
      SELECT 'tasks', t.id, json_extract(j.value, '$.type'), json_extract(j.value, '$.id')
      FROM tasks t, json_each(t.entities_json) j
      WHERE t.entities_json IS NOT NULL AND t.entities_json != '[]' AND t.entities_json != '';
    `,
  },
  {
    version: 45,
    name: 'feedback_target_id_index',
    sql: `
      CREATE INDEX IF NOT EXISTS idx_feedback_target_id ON feedback(target_kind, target_id, action);
    `,
  },
  {
    version: 46,
    name: 'normalize_resolved_observations',
    sql: `
      UPDATE observations SET status = 'done' WHERE status = 'resolved';
    `,
  },
  {
    version: 47,
    name: 'autonomy_fields',
    sql: `
      ALTER TABLE runs ADD COLUMN auto_eval_at TEXT;
      ALTER TABLE suggestions ADD COLUMN effort TEXT DEFAULT 'medium';
    `,
  },
  {
    version: 48,
    name: 'memory_enforced_at',
    sql: `
      ALTER TABLE memories ADD COLUMN enforced_at INTEGER;
    `,
  },
  {
    version: 49,
    name: 'bond_multi_axis_chronicle',
    sql: `
      -- user_profile: bond axes + tier + reset timestamp
      ALTER TABLE user_profile ADD COLUMN bond_axes_json TEXT NOT NULL
        DEFAULT '{"time":0,"depth":0,"momentum":0,"alignment":0,"autonomy":0}';
      ALTER TABLE user_profile ADD COLUMN bond_tier INTEGER NOT NULL DEFAULT 1;
      -- SQLite doesn't allow non-constant defaults in ALTER TABLE ADD COLUMN,
      -- so we use a placeholder constant. The v49 first-boot reset hook in
      -- daemon/runtime.ts overwrites this to now() on the first restart,
      -- and ensureProfile() for fresh DBs also updates it via resetBondState.
      ALTER TABLE user_profile ADD COLUMN bond_reset_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z';
      UPDATE user_profile SET bond_reset_at = datetime('now') WHERE bond_reset_at = '2026-01-01T00:00:00Z';
      ALTER TABLE user_profile ADD COLUMN bond_tier_last_rise_at TEXT;

      -- chronicle_entries: immutable narrative records (tier crossings + milestones)
      CREATE TABLE IF NOT EXISTS chronicle_entries (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        tier INTEGER,
        milestone_key TEXT,
        title TEXT NOT NULL,
        body_md TEXT NOT NULL,
        model TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_chronicle_kind ON chronicle_entries(kind, created_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_chronicle_tier_unique
        ON chronicle_entries(tier) WHERE kind = 'tier_lore';
      CREATE UNIQUE INDEX IF NOT EXISTS idx_chronicle_milestone_unique
        ON chronicle_entries(milestone_key) WHERE kind = 'milestone';

      -- unlockables: tier-gated content slots
      CREATE TABLE IF NOT EXISTS unlockables (
        id TEXT PRIMARY KEY,
        tier_required INTEGER NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        payload_json TEXT NOT NULL DEFAULT '{}',
        unlocked INTEGER NOT NULL DEFAULT 0,
        unlocked_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_unlockables_tier ON unlockables(tier_required, unlocked);

      -- bond_daily_cache: 24h TTL cache for Haiku-generated daily phrases
      CREATE TABLE IF NOT EXISTS bond_daily_cache (
        cache_key TEXT PRIMARY KEY,
        body_md TEXT NOT NULL,
        model TEXT NOT NULL,
        generated_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );

      -- Seed 8 placeholder unlockables — titles/payloads editable later
      INSERT INTO unlockables (id, tier_required, kind, title, description, created_at) VALUES
        ('u-01', 1, 'placeholder', '???', 'A gift for the first steps', datetime('now')),
        ('u-02', 2, 'placeholder', '???', 'An echo to keep', datetime('now')),
        ('u-03', 3, 'placeholder', '???', 'Something whispered', datetime('now')),
        ('u-04', 4, 'placeholder', '???', 'A shade you can share', datetime('now')),
        ('u-05', 5, 'placeholder', '???', 'The shadow unfolds', datetime('now')),
        ('u-06', 6, 'placeholder', '???', 'A presence of its own', datetime('now')),
        ('u-07', 7, 'placeholder', '???', 'A herald''s voice', datetime('now')),
        ('u-08', 8, 'placeholder', '???', 'Kindred, complete', datetime('now'));
    `,
  },
  {
    version: 50,
    name: 'digests_unique_period',
    sql: `
      DELETE FROM digests WHERE id NOT IN (SELECT MIN(id) FROM digests GROUP BY kind, period_start);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_digests_kind_period_unique ON digests(kind, period_start);
    `,
  },
  {
    version: 51,
    name: 'rename_closed_outcomes',
    sql: `
      UPDATE runs SET outcome = 'no_changes'
        WHERE outcome = 'closed' AND closed_note = 'No changes needed';
      UPDATE runs SET outcome = 'closed_manual'
        WHERE outcome = 'closed';
    `,
  },
  {
    version: 52,
    name: 'observations_last_notified_at',
    sql: `
      ALTER TABLE observations ADD COLUMN last_notified_at TEXT DEFAULT NULL;
      CREATE INDEX IF NOT EXISTS idx_observations_last_notified_at ON observations(last_notified_at);
    `,
  },
  {
    version: 53,
    name: 'llm_usage_daily_rollup',
    sql: `
      CREATE TABLE IF NOT EXISTS llm_usage_daily (
        date TEXT NOT NULL,
        source TEXT NOT NULL,
        model TEXT NOT NULL,
        input_tokens_sum INTEGER NOT NULL DEFAULT 0,
        output_tokens_sum INTEGER NOT NULL DEFAULT 0,
        calls INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (date, source, model)
      );
      CREATE INDEX IF NOT EXISTS idx_llm_usage_daily_date ON llm_usage_daily(date);
    `,
  },
  {
    version: 54,
    name: 'event_queue_dedup_index',
    sql: `
      CREATE INDEX IF NOT EXISTS idx_event_queue_dedup
        ON event_queue (kind, json_extract(payload_json, '$.targetId'), created_at);
    `,
  },
  {
    version: 55,
    name: 'task_repo_links_junction',
    // Big-bang migration: backfill + DROP in a single step. Safe because
    // (a) `json_each` raises SQLITE_ERROR on malformed JSON → transaction
    // rolls back and migration doesn't record as applied; (b) entire migration
    // wraps in BEGIN/COMMIT in applyMigrations loop. Future big-bang drops
    // should prefer a split `assertInvariant` pattern (see audit S-01 + the
    // `assertBackfillComplete` helper above) so the backfill count can be
    // verified explicitly before the destructive DROP.
    sql: `
      CREATE TABLE IF NOT EXISTS task_repo_links (
        task_id TEXT NOT NULL,
        repo_id TEXT NOT NULL,
        PRIMARY KEY (task_id, repo_id),
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_task_repo_links_repo ON task_repo_links(repo_id);

      INSERT OR IGNORE INTO task_repo_links (task_id, repo_id)
      SELECT t.id, je.value
      FROM tasks t, json_each(t.repo_ids_json) je
      WHERE t.repo_ids_json IS NOT NULL AND t.repo_ids_json != '' AND t.repo_ids_json != '[]';

      ALTER TABLE tasks DROP COLUMN repo_ids_json;
    `,
  },
  {
    version: 56,
    name: 'tasks_closed_note',
    sql: `
      ALTER TABLE tasks ADD COLUMN closed_note TEXT;
    `,
  },
  {
    version: 57,
    name: 'memories_fts_tags_tokenized',
    sql: `
      -- audit D-11: old triggers fed tags_json as-is into memories_fts
      -- ("[\\"docs\\",\\"sql\\"]"), so "docs" matched by substring accident
      -- and tags with punctuation broke. Replace with json_each tokens
      -- (space-separated) so tag search matches exact tokens.
      --
      -- External-content FTS5 doesn't support DELETE directly, so we skip
      -- a forced re-index here — existing rows will correct themselves on
      -- their next UPDATE. If search quality regresses, a manual re-index
      -- script can be added (rebuild requires contentless FTS, out of scope).
      DROP TRIGGER IF EXISTS memories_ai;
      DROP TRIGGER IF EXISTS memories_ad;
      DROP TRIGGER IF EXISTS memories_au;

      CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, title, body_md, tags_text)
        VALUES (NEW.rowid, NEW.title, NEW.body_md,
          COALESCE((SELECT group_concat(value, ' ') FROM json_each(NEW.tags_json)), ''));
      END;

      CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, title, body_md, tags_text)
        VALUES ('delete', OLD.rowid, OLD.title, OLD.body_md,
          COALESCE((SELECT group_concat(value, ' ') FROM json_each(OLD.tags_json)), ''));
      END;

      CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, title, body_md, tags_text)
        VALUES ('delete', OLD.rowid, OLD.title, OLD.body_md,
          COALESCE((SELECT group_concat(value, ' ') FROM json_each(OLD.tags_json)), ''));
        INSERT INTO memories_fts(rowid, title, body_md, tags_text)
        VALUES (NEW.rowid, NEW.title, NEW.body_md,
          COALESCE((SELECT group_concat(value, ' ') FROM json_each(NEW.tags_json)), ''));
      END;
    `,
  },
  {
    version: 58,
    name: 'observability_metrics',
    // Daily snapshots of interesting counters. Populated by the
    // `metrics-snapshot` daemon job. Queryable for time-series later
    // (bond axes evolution, memory layer distribution, dedup hit rate).
    // See audit O-04.
    sql: `
      CREATE TABLE IF NOT EXISTS observability_metrics (
        id TEXT PRIMARY KEY,
        snapshot_date TEXT NOT NULL,  -- YYYY-MM-DD
        metric_key TEXT NOT NULL,     -- e.g. 'bond.depth', 'memories.layer.core', 'dedup.suggest.hit_rate'
        metric_value REAL NOT NULL,
        context_json TEXT DEFAULT '{}',
        created_at TEXT NOT NULL,
        UNIQUE (snapshot_date, metric_key)
      );
      CREATE INDEX IF NOT EXISTS idx_obs_metrics_date ON observability_metrics(snapshot_date);
      CREATE INDEX IF NOT EXISTS idx_obs_metrics_key ON observability_metrics(metric_key);
    `,
  },
];

export function applyMigrations(database: DatabaseSync, dbPath?: string): void {
  database.exec('PRAGMA foreign_keys = ON;');
  database.exec('PRAGMA journal_mode = WAL;');
  database.exec('PRAGMA busy_timeout = 5000;');
  database.exec('PRAGMA synchronous = NORMAL;');
  database.exec('PRAGMA temp_store = MEMORY;');

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

  const pendingMigrations = migrations.filter(m => !applied.has(m.version)).sort((a, b) => a.version - b.version);

  // Snapshot DB before applying new migrations
  if (pendingMigrations.length > 0 && dbPath) {
    try {
      const maxVersion = Math.max(...pendingMigrations.map(m => m.version));
      copyFileSync(dbPath, `${dbPath}.pre-v${maxVersion}`);

      // Prune: keep only last 3 snapshots
      const dir = dirname(dbPath);
      const base = basename(dbPath);
      const snapshots = readdirSync(dir)
        .filter(f => f.startsWith(`${base}.pre-v`))
        .sort()
        .map(f => join(dir, f));
      while (snapshots.length > 3) unlinkSync(snapshots.shift()!);
    } catch { /* non-fatal */ }
  }

  for (const migration of pendingMigrations) {
    database.exec('BEGIN');
    try {
      database.exec(migration.sql);
      if (migration.assertInvariant) {
        migration.assertInvariant(database);
      }
      insertMigration.run(migration.version, migration.name, new Date().toISOString());
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }
}
