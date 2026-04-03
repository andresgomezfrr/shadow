import { DatabaseSync } from 'node:sqlite';
import * as sqliteVec from 'sqlite-vec';

type SQLValue = string | number | bigint | null | Uint8Array;
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import type { ShadowConfig } from '../config/load-config.js';
import type {
  AuditEventRecord,
  ContactRecord,
  DigestRecord,
  EntityLink,
  EventRecord,
  HeartbeatRecord,
  InteractionRecord,
  LlmUsageRecord,
  MemoryRecord,
  MemorySearchResult,
  ObservationRecord,
  ProjectRecord,
  RepoRecord,
  RunRecord,
  SuggestionRecord,
  SystemRecord,
  UserProfileRecord,
  JobRecord,
  FeedbackRecord,
} from './models.js';
import { applyMigrations } from './migrations.js';

// --- Input types ---

export type CreateRepoInput = {
  name: string;
  path: string;
  remoteUrl?: string | null;
  defaultBranch?: string;
  languageHint?: string | null;
  testCommand?: string | null;
  lintCommand?: string | null;
  buildCommand?: string | null;
};

export type CreateProjectInput = {
  name: string;
  kind?: string;
  description?: string | null;
  status?: string;
  repoIds?: string[];
  systemIds?: string[];
  contactIds?: string[];
  startDate?: string | null;
  endDate?: string | null;
  notesMd?: string | null;
};

export type CreateSystemInput = {
  name: string;
  kind: string;
  url?: string | null;
  description?: string | null;
  accessMethod?: string | null;
  config?: Record<string, unknown>;
  healthCheck?: string | null;
  logsLocation?: string | null;
  deployMethod?: string | null;
  debugGuide?: string | null;
};

export type CreateContactInput = {
  name: string;
  role?: string | null;
  team?: string | null;
  email?: string | null;
  slackId?: string | null;
  githubHandle?: string | null;
  notesMd?: string | null;
  preferredChannel?: string | null;
};

export type CreateMemoryInput = {
  repoId?: string | null;
  contactId?: string | null;
  systemId?: string | null;
  layer: string;
  scope: string;
  kind: string;
  title: string;
  bodyMd: string;
  tags?: string[];
  sourceType: string;
  sourceId?: string | null;
  confidenceScore?: number;
  relevanceScore?: number;
};

export type CreateObservationInput = {
  repoId: string;
  sourceKind?: string;
  sourceId?: string | null;
  kind: string;
  severity?: string;
  title: string;
  detail?: Record<string, unknown>;
  context?: Record<string, unknown>;
};

export type CreateSuggestionInput = {
  repoId?: string | null;
  repoIds?: string[];
  sourceObservationId?: string | null;
  kind: string;
  title: string;
  summaryMd: string;
  reasoningMd?: string | null;
  impactScore?: number;
  confidenceScore?: number;
  riskScore?: number;
  requiredTrustLevel?: number;
};

export type CreateRunInput = {
  repoId: string;
  repoIds?: string[];
  suggestionId?: string | null;
  parentRunId?: string | null;
  kind: string;
  prompt: string;
};

export type CreateAuditEventInput = {
  actor?: string;
  interface: string;
  action: string;
  targetKind?: string | null;
  targetId?: string | null;
  detail?: Record<string, unknown>;
};

export type CreateLlmUsageInput = {
  source: string;
  sourceId?: string | null;
  model: string;
  inputTokens: number;
  outputTokens: number;
};

// --- Database class ---

export class ShadowDatabase {
  readonly config: ShadowConfig;
  private readonly database: DatabaseSync;

  constructor(config: ShadowConfig) {
    this.config = config;
    mkdirSync(dirname(config.resolvedDatabasePath), { recursive: true });
    this.database = new DatabaseSync(config.resolvedDatabasePath, { allowExtension: true });
    sqliteVec.load(this.database);
    applyMigrations(this.database);
  }

  /** Raw DatabaseSync handle — used by search.ts for vector queries */
  get rawDb(): DatabaseSync {
    return this.database;
  }

  // --- Digests ---

  createDigest(input: { kind: string; periodStart: string; periodEnd: string; contentMd: string; model: string; tokensUsed?: number }): DigestRecord {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO digests (id, kind, period_start, period_end, content_md, model, tokens_used, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.kind, input.periodStart, input.periodEnd, input.contentMd, input.model, input.tokensUsed ?? 0, now, now);
    return this.getDigest(id)!;
  }

  getDigest(id: string): DigestRecord | null {
    const row = this.database.prepare('SELECT * FROM digests WHERE id = ?').get(id);
    return row ? mapDigest(row) : null;
  }

  listDigests(filters?: { kind?: string; limit?: number }): DigestRecord[] {
    const clauses: string[] = [];
    const values: SQLValue[] = [];
    if (filters?.kind) { clauses.push('kind = ?'); values.push(filters.kind); }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = filters?.limit ?? 20;
    return this.database
      .prepare(`SELECT * FROM digests ${where} ORDER BY period_start DESC LIMIT ?`)
      .all(...values, limit)
      .map(mapDigest);
  }

  getLatestDigest(kind: string): DigestRecord | null {
    const row = this.database.prepare('SELECT * FROM digests WHERE kind = ? ORDER BY period_start DESC LIMIT 1').get(kind);
    return row ? mapDigest(row) : null;
  }

  updateDigest(id: string, updates: { contentMd?: string; tokensUsed?: number }): void {
    const sets: string[] = ['updated_at = ?'];
    const values: SQLValue[] = [new Date().toISOString()];
    if (updates.contentMd !== undefined) { sets.push('content_md = ?'); values.push(updates.contentMd); }
    if (updates.tokensUsed !== undefined) { sets.push('tokens_used = ?'); values.push(updates.tokensUsed); }
    values.push(id);
    this.database.prepare(`UPDATE digests SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  // --- Vector embeddings ---

  storeEmbedding(table: 'memory_vectors' | 'observation_vectors' | 'suggestion_vectors', id: string, embedding: Float32Array): void {
    try {
      this.database.prepare(`INSERT OR REPLACE INTO ${table}(id, embedding) VALUES (?, ?)`).run(id, embedding);
    } catch (e) {
      console.error(`[shadow:db] Failed to store embedding in ${table}:`, e instanceof Error ? e.message : e);
    }
  }

  deleteEmbedding(table: 'memory_vectors' | 'observation_vectors' | 'suggestion_vectors', id: string): void {
    try {
      this.database.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
    } catch (e) {
      console.error(`[shadow:db] Failed to delete embedding from ${table}:`, e instanceof Error ? e.message : e);
    }
  }

  close(): void {
    this.database.close();
  }

  // --- Storage info ---

  listTables(): string[] {
    const rows = this.database
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    return rows.map((r) => r.name);
  }

  // --- Repos ---

  createRepo(input: CreateRepoInput): RepoRecord {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO repos (id, name, path, remote_url, default_branch, language_hint,
         test_command, lint_command, build_command, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.path,
        input.remoteUrl ?? null,
        input.defaultBranch ?? 'main',
        input.languageHint ?? null,
        input.testCommand ?? null,
        input.lintCommand ?? null,
        input.buildCommand ?? null,
        now,
        now,
      );
    return this.getRepo(id)!;
  }

  getRepo(id: string): RepoRecord | null {
    const row = this.database.prepare('SELECT * FROM repos WHERE id = ?').get(id);
    return row ? mapRepo(row) : null;
  }

  findRepoByName(name: string): RepoRecord | null {
    const row = this.database.prepare('SELECT * FROM repos WHERE name = ?').get(name);
    return row ? mapRepo(row) : null;
  }

  findRepoByPath(path: string): RepoRecord | null {
    const row = this.database.prepare('SELECT * FROM repos WHERE path = ?').get(path);
    return row ? mapRepo(row) : null;
  }

  listRepos(): RepoRecord[] {
    return this.database
      .prepare('SELECT * FROM repos ORDER BY created_at DESC')
      .all()
      .map(mapRepo);
  }

  updateRepo(id: string, updates: Partial<Pick<RepoRecord, 'name' | 'remoteUrl' | 'defaultBranch' | 'languageHint' | 'testCommand' | 'lintCommand' | 'buildCommand' | 'lastObservedAt'>>): void {
    const sets: string[] = [];
    const values: SQLValue[] = [];
    for (const [key, value] of Object.entries(updates)) {
      sets.push(`${toSnake(key)} = ?`);
      values.push((value ?? null) as SQLValue);
    }
    if (sets.length === 0) return;
    sets.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);
    this.database.prepare(`UPDATE repos SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  deleteRepo(id: string): void {
    this.database.prepare('DELETE FROM repos WHERE id = ?').run(id);
  }

  // --- Systems ---

  createSystem(input: CreateSystemInput): SystemRecord {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO systems (id, name, kind, url, description, access_method, config_json, health_check, logs_location, deploy_method, debug_guide, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.kind,
        input.url ?? null,
        input.description ?? null,
        input.accessMethod ?? null,
        JSON.stringify(input.config ?? {}),
        input.healthCheck ?? null,
        input.logsLocation ?? null,
        input.deployMethod ?? null,
        input.debugGuide ?? null,
        now,
        now,
      );
    return this.getSystem(id)!;
  }

  getSystem(id: string): SystemRecord | null {
    const row = this.database.prepare('SELECT * FROM systems WHERE id = ?').get(id);
    return row ? mapSystem(row) : null;
  }

  findSystemByName(name: string): SystemRecord | null {
    const row = this.database.prepare('SELECT * FROM systems WHERE name = ?').get(name);
    return row ? mapSystem(row) : null;
  }

  listSystems(filters?: { kind?: string }): SystemRecord[] {
    if (filters?.kind) {
      return this.database
        .prepare('SELECT * FROM systems WHERE kind = ? ORDER BY created_at DESC')
        .all(filters.kind)
        .map(mapSystem);
    }
    return this.database
      .prepare('SELECT * FROM systems ORDER BY created_at DESC')
      .all()
      .map(mapSystem);
  }

  updateSystem(id: string, updates: Partial<Pick<SystemRecord, 'name' | 'kind' | 'url' | 'description' | 'accessMethod' | 'healthCheck' | 'logsLocation' | 'deployMethod' | 'debugGuide' | 'lastCheckedAt'>>): void {
    const sets: string[] = [];
    const values: SQLValue[] = [];
    for (const [key, value] of Object.entries(updates)) {
      sets.push(`${toSnake(key)} = ?`);
      values.push((value ?? null) as SQLValue);
    }
    if (sets.length === 0) return;
    sets.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);
    this.database.prepare(`UPDATE systems SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  deleteSystem(id: string): void {
    this.database.prepare('DELETE FROM systems WHERE id = ?').run(id);
  }

  // --- Projects ---

  createProject(input: CreateProjectInput): ProjectRecord {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO projects (id, name, kind, description, status, repo_ids_json, system_ids_json, contact_ids_json, start_date, end_date, notes_md, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.kind ?? 'long-term',
        input.description ?? null,
        input.status ?? 'active',
        JSON.stringify(input.repoIds ?? []),
        JSON.stringify(input.systemIds ?? []),
        JSON.stringify(input.contactIds ?? []),
        input.startDate ?? null,
        input.endDate ?? null,
        input.notesMd ?? null,
        now,
        now,
      );
    return this.getProject(id)!;
  }

  getProject(id: string): ProjectRecord | null {
    const row = this.database.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    return row ? mapProject(row) : null;
  }

  findProjectByName(name: string): ProjectRecord | null {
    const row = this.database.prepare('SELECT * FROM projects WHERE name = ?').get(name);
    return row ? mapProject(row) : null;
  }

  listProjects(filters?: { status?: string }): ProjectRecord[] {
    if (filters?.status) {
      return this.database
        .prepare('SELECT * FROM projects WHERE status = ? ORDER BY created_at DESC')
        .all(filters.status)
        .map(mapProject);
    }
    return this.database
      .prepare('SELECT * FROM projects ORDER BY created_at DESC')
      .all()
      .map(mapProject);
  }

  updateProject(id: string, updates: Partial<Pick<ProjectRecord, 'name' | 'kind' | 'description' | 'status' | 'repoIds' | 'systemIds' | 'contactIds' | 'startDate' | 'endDate' | 'notesMd'>>): ProjectRecord {
    const sets: string[] = [];
    const values: SQLValue[] = [];
    for (const [key, value] of Object.entries(updates)) {
      const col = toSnake(key);
      if (['repo_ids', 'system_ids', 'contact_ids'].includes(col)) {
        sets.push(`${col}_json = ?`);
        values.push(JSON.stringify(value ?? []));
      } else {
        sets.push(`${col} = ?`);
        values.push((value ?? null) as SQLValue);
      }
    }
    if (sets.length === 0) return this.getProject(id)!;
    sets.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);
    this.database.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    return this.getProject(id)!;
  }

  deleteProject(id: string): void {
    this.database.prepare('DELETE FROM projects WHERE id = ?').run(id);
  }

  findProjectsForRepo(repoId: string): ProjectRecord[] {
    return this.database
      .prepare(`SELECT p.* FROM projects p, json_each(p.repo_ids_json) j WHERE j.value = ? AND p.status != 'archived'`)
      .all(repoId)
      .map(mapProject);
  }

  // --- Contacts ---

  createContact(input: CreateContactInput): ContactRecord {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO contacts (id, name, role, team, email, slack_id, github_handle, notes_md, preferred_channel, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.role ?? null,
        input.team ?? null,
        input.email ?? null,
        input.slackId ?? null,
        input.githubHandle ?? null,
        input.notesMd ?? null,
        input.preferredChannel ?? null,
        now,
        now,
      );
    return this.getContact(id)!;
  }

  getContact(id: string): ContactRecord | null {
    const row = this.database.prepare('SELECT * FROM contacts WHERE id = ?').get(id);
    return row ? mapContact(row) : null;
  }

  findContactByName(name: string): ContactRecord | null {
    const row = this.database.prepare('SELECT * FROM contacts WHERE name = ?').get(name);
    return row ? mapContact(row) : null;
  }

  listContacts(filters?: { team?: string }): ContactRecord[] {
    if (filters?.team) {
      return this.database
        .prepare('SELECT * FROM contacts WHERE team = ? ORDER BY name')
        .all(filters.team)
        .map(mapContact);
    }
    return this.database
      .prepare('SELECT * FROM contacts ORDER BY name')
      .all()
      .map(mapContact);
  }

  updateContact(id: string, updates: Partial<Pick<ContactRecord, 'name' | 'role' | 'team' | 'email' | 'slackId' | 'githubHandle' | 'notesMd' | 'preferredChannel' | 'lastMentionedAt'>>): void {
    const sets: string[] = [];
    const values: SQLValue[] = [];
    for (const [key, value] of Object.entries(updates)) {
      sets.push(`${toSnake(key)} = ?`);
      values.push((value ?? null) as SQLValue);
    }
    if (sets.length === 0) return;
    sets.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);
    this.database.prepare(`UPDATE contacts SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  deleteContact(id: string): void {
    this.database.prepare('DELETE FROM contacts WHERE id = ?').run(id);
  }

  // --- User Profile ---

  getProfile(id = 'default'): UserProfileRecord | null {
    const row = this.database.prepare('SELECT * FROM user_profile WHERE id = ?').get(id);
    return row ? mapProfile(row) : null;
  }

  ensureProfile(id = 'default'): UserProfileRecord {
    const existing = this.getProfile(id);
    if (existing) return existing;
    const now = new Date().toISOString();
    this.database
      .prepare('INSERT INTO user_profile (id, created_at, updated_at) VALUES (?, ?, ?)')
      .run(id, now, now);
    return this.getProfile(id)!;
  }

  updateProfile(id: string, updates: Record<string, unknown>): void {
    const sets: string[] = [];
    const values: SQLValue[] = [];
    for (const [key, value] of Object.entries(updates)) {
      const col = toSnake(key);
      if (col.endsWith('_json')) {
        sets.push(`${col} = ?`);
        values.push(JSON.stringify(value));
      } else {
        sets.push(`${col} = ?`);
        values.push((value ?? null) as SQLValue);
      }
    }
    if (sets.length === 0) return;
    sets.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);
    this.database.prepare(`UPDATE user_profile SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  // --- Memories ---

  createMemory(input: CreateMemoryInput): MemoryRecord {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO memories (id, repo_id, contact_id, system_id, layer, scope, kind, title, body_md, tags_json,
         source_type, source_id, confidence_score, relevance_score, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.repoId ?? null,
        input.contactId ?? null,
        input.systemId ?? null,
        input.layer,
        input.scope,
        input.kind,
        input.title,
        input.bodyMd,
        JSON.stringify(input.tags ?? []),
        input.sourceType,
        input.sourceId ?? null,
        input.confidenceScore ?? 70,
        input.relevanceScore ?? 0.5,
        now,
        now,
      );
    return this.getMemory(id)!;
  }

  getMemory(id: string): MemoryRecord | null {
    const row = this.database.prepare('SELECT * FROM memories WHERE id = ?').get(id);
    return row ? mapMemory(row) : null;
  }

  listMemories(filters?: { layer?: string; scope?: string; repoId?: string; archived?: boolean; limit?: number; offset?: number }): MemoryRecord[] {
    const clauses: string[] = [];
    const values: SQLValue[] = [];

    if (filters?.layer) {
      clauses.push('layer = ?');
      values.push(filters.layer);
    }
    if (filters?.scope) {
      clauses.push('scope = ?');
      values.push(filters.scope);
    }
    if (filters?.repoId) {
      clauses.push('repo_id = ?');
      values.push(filters.repoId);
    }
    if (filters?.archived === false) {
      clauses.push('archived_at IS NULL');
    } else if (filters?.archived === true) {
      clauses.push('archived_at IS NOT NULL');
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const pagination = `${filters?.limit != null ? ` LIMIT ${Number(filters.limit)}` : ''}${filters?.offset != null ? ` OFFSET ${Number(filters.offset)}` : ''}`;
    return this.database
      .prepare(`SELECT * FROM memories ${where} ORDER BY created_at DESC${pagination}`)
      .all(...values)
      .map(mapMemory);
  }

  countMemories(filters?: { layer?: string; archived?: boolean }): number {
    const clauses: string[] = [];
    const values: SQLValue[] = [];
    if (filters?.layer) { clauses.push('layer = ?'); values.push(filters.layer); }
    if (filters?.archived === false) { clauses.push('archived_at IS NULL'); }
    else if (filters?.archived === true) { clauses.push('archived_at IS NOT NULL'); }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    return (this.database.prepare(`SELECT COUNT(*) as total FROM memories ${where}`).get(...values) as { total: number }).total;
  }

  searchMemories(query: string, options?: { layer?: string; scope?: string; repoId?: string; limit?: number }): MemorySearchResult[] {
    const limit = options?.limit ?? 10;

    // Sanitize query for FTS5 — wrap each word in double quotes to avoid syntax errors
    const sanitized = query
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 1)
      .map(w => `"${w}"`)
      .join(' OR ');

    if (!sanitized) return [];

    // Step 1: Get rowids from FTS5 with ranking
    let ftsRows: { rowid: number; rank: number }[];
    try {
      ftsRows = this.database
        .prepare('SELECT rowid, bm25(memories_fts) as rank FROM memories_fts WHERE memories_fts MATCH ? ORDER BY rank LIMIT ?')
        .all(sanitized, limit * 2) as { rowid: number; rank: number }[];
    } catch {
      return [];
    }

    if (ftsRows.length === 0) return [];

    // Step 2: Get full memory records and apply filters
    const results: MemorySearchResult[] = [];
    for (const ftsRow of ftsRows) {
      if (results.length >= limit) break;

      const row = this.database
        .prepare('SELECT * FROM memories WHERE rowid = ?')
        .get(ftsRow.rowid);
      if (!row) continue;

      const memory = mapMemory(row);

      // Apply filters
      if (memory.archivedAt !== null) continue;
      if (options?.layer && memory.layer !== options.layer) continue;
      if (options?.scope && memory.scope !== options.scope) continue;
      if (options?.repoId && memory.repoId !== options.repoId) continue;

      results.push({
        memory,
        rank: ftsRow.rank,
        snippet: memory.bodyMd.slice(0, 120),
      });
    }

    return results;
  }

  updateMemory(id: string, updates: Partial<Pick<MemoryRecord, 'layer' | 'scope' | 'kind' | 'title' | 'bodyMd' | 'tags' | 'confidenceScore' | 'relevanceScore' | 'accessCount' | 'lastAccessedAt' | 'promotedFrom' | 'demotedTo' | 'archivedAt'>>): void {
    const sets: string[] = [];
    const values: SQLValue[] = [];
    for (const [key, value] of Object.entries(updates)) {
      if (key === 'tags') {
        sets.push('tags_json = ?');
        values.push(JSON.stringify(value));
      } else if (key === 'bodyMd') {
        sets.push('body_md = ?');
        values.push((value ?? null) as SQLValue);
      } else {
        sets.push(`${toSnake(key)} = ?`);
        values.push((value ?? null) as SQLValue);
      }
    }
    if (sets.length === 0) return;
    sets.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);
    this.database.prepare(`UPDATE memories SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  touchMemory(id: string): void {
    const now = new Date().toISOString();
    this.database
      .prepare('UPDATE memories SET access_count = access_count + 1, last_accessed_at = ?, updated_at = ? WHERE id = ?')
      .run(now, now, id);
  }

  /** Merge new content into an existing memory's body + tags. Used by semantic dedup. */
  mergeMemoryBody(id: string, newBodyMd: string, newTags?: string[]): void {
    const existing = this.getMemory(id);
    if (!existing) return;

    const mergedBody = `${existing.bodyMd}\n\n---\n\n${newBodyMd}`;
    const mergedTags = newTags
      ? [...new Set([...existing.tags, ...newTags])]
      : existing.tags;
    const now = new Date().toISOString();

    this.database
      .prepare('UPDATE memories SET body_md = ?, tags_json = ?, updated_at = ? WHERE id = ?')
      .run(mergedBody, JSON.stringify(mergedTags), now, id);
  }

  // --- Observations ---

  createObservation(input: CreateObservationInput): ObservationRecord {
    const now = new Date().toISOString();

    // Dedup: look for existing active/acknowledged observation with same key
    const existing = this.database
      .prepare(
        `SELECT id, votes, context_json FROM observations
         WHERE repo_id = ? AND kind = ? AND title = ? AND status IN ('active', 'acknowledged')
         LIMIT 1`,
      )
      .get(input.repoId, input.kind, input.title) as
      | { id: string; votes: number; context_json: string }
      | undefined;

    if (existing) {
      const oldContext = jsonParse(existing.context_json, {} as Record<string, unknown>);
      const merged = mergeContext(oldContext, input.context ?? {});
      this.database
        .prepare('UPDATE observations SET votes = votes + 1, last_seen_at = ?, context_json = ? WHERE id = ?')
        .run(now, JSON.stringify(merged), existing.id);
      return this.getObservation(existing.id)!;
    }

    const id = randomUUID();
    this.database
      .prepare(
        `INSERT INTO observations
         (id, repo_id, source_kind, source_id, kind, severity, title, detail_json, context_json,
          votes, status, first_seen_at, last_seen_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'active', ?, ?, ?)`,
      )
      .run(
        id,
        input.repoId,
        input.sourceKind ?? 'repo',
        input.sourceId ?? input.repoId,
        input.kind,
        input.severity ?? 'info',
        input.title,
        JSON.stringify(input.detail ?? {}),
        JSON.stringify(input.context ?? {}),
        now,
        now,
        now,
      );
    return this.getObservation(id)!;
  }

  getObservation(id: string): ObservationRecord | null {
    const row = this.database.prepare('SELECT * FROM observations WHERE id = ?').get(id);
    return row ? mapObservation(row) : null;
  }

  listObservations(filters?: { repoId?: string; sourceKind?: string; processed?: boolean; status?: string; limit?: number; offset?: number }): ObservationRecord[] {
    const clauses: string[] = [];
    const values: SQLValue[] = [];

    if (filters?.repoId) {
      clauses.push('repo_id = ?');
      values.push(filters.repoId);
    }
    if (filters?.sourceKind) {
      clauses.push('source_kind = ?');
      values.push(filters.sourceKind);
    }
    if (filters?.processed !== undefined) {
      clauses.push('processed = ?');
      values.push(filters.processed ? 1 : 0);
    }
    if (filters?.status && filters.status !== 'all') {
      clauses.push('status = ?');
      values.push(filters.status);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const pagination = `${filters?.limit != null ? `LIMIT ${filters.limit}` : ''}${filters?.offset != null ? ` OFFSET ${filters.offset}` : ''}`;
    return this.database
      .prepare(`SELECT * FROM observations ${where} ORDER BY votes DESC, last_seen_at DESC ${pagination}`)
      .all(...values)
      .map(mapObservation);
  }

  countObservations(filters?: { repoId?: string; status?: string }): number {
    const clauses: string[] = [];
    const values: SQLValue[] = [];
    if (filters?.repoId) { clauses.push('repo_id = ?'); values.push(filters.repoId); }
    if (filters?.status && filters.status !== 'all') { clauses.push('status = ?'); values.push(filters.status); }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    return (this.database.prepare(`SELECT COUNT(*) as total FROM observations ${where}`).get(...values) as { total: number }).total;
  }

  countObservationsSince(since: string): number {
    const row = this.database
      .prepare('SELECT COUNT(*) as count FROM observations WHERE created_at > ?')
      .get(since) as { count: number };
    return row.count;
  }

  markObservationProcessed(id: string, suggestionId?: string): void {
    this.database
      .prepare('UPDATE observations SET processed = 1, suggestion_id = ? WHERE id = ?')
      .run(suggestionId ?? null, id);
  }

  updateObservationStatus(id: string, status: string): void {
    this.database
      .prepare('UPDATE observations SET status = ? WHERE id = ?')
      .run(status, id);
  }

  resolveStaleObservations(): number {
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const result = this.database
      .prepare(`UPDATE observations SET status = 'resolved' WHERE status = 'active' AND last_seen_at < ?`)
      .run(cutoff);
    return (result as unknown as { changes: number }).changes;
  }

  /** Auto-expire observations by severity: info=7d, warning=14d. High never auto-expires. */
  expireObservationsBySeverity(): number {
    const now = Date.now();
    const infoCutoff = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const warningCutoff = new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString();
    let expired = 0;

    const r1 = this.database
      .prepare(`UPDATE observations SET status = 'expired' WHERE status = 'active' AND severity = 'info' AND last_seen_at < ?`)
      .run(infoCutoff);
    expired += (r1 as unknown as { changes: number }).changes;

    const r2 = this.database
      .prepare(`UPDATE observations SET status = 'expired' WHERE status = 'active' AND severity = 'warning' AND last_seen_at < ?`)
      .run(warningCutoff);
    expired += (r2 as unknown as { changes: number }).changes;

    return expired;
  }

  /** Enforce max active observations per repo. Auto-resolve excess (oldest, lowest votes). */
  capObservationsPerRepo(maxPerRepo = 10): number {
    const repos = this.database
      .prepare(`SELECT repo_id, COUNT(*) as cnt FROM observations WHERE status = 'active' GROUP BY repo_id HAVING cnt > ?`)
      .all(maxPerRepo) as { repo_id: string; cnt: number }[];

    let resolved = 0;
    for (const { repo_id, cnt } of repos) {
      const excess = cnt - maxPerRepo;
      const toResolve = this.database
        .prepare(`SELECT id FROM observations WHERE status = 'active' AND repo_id = ? ORDER BY votes ASC, last_seen_at ASC LIMIT ?`)
        .all(repo_id, excess) as { id: string }[];
      for (const { id } of toResolve) {
        this.database.prepare(`UPDATE observations SET status = 'resolved' WHERE id = ?`).run(id);
        resolved++;
      }
    }
    return resolved;
  }

  expireStaleObservations(): number {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const result = this.database
      .prepare(`UPDATE observations SET status = 'expired' WHERE status IN ('active', 'acknowledged') AND last_seen_at < ?`)
      .run(cutoff);
    return (result as unknown as { changes: number }).changes;
  }

  // --- Suggestions ---

  createSuggestion(input: CreateSuggestionInput): SuggestionRecord {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO suggestions (id, repo_id, repo_ids_json, source_observation_id, kind, title, summary_md,
         reasoning_md, impact_score, confidence_score, risk_score, required_trust_level, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.repoId ?? null,
        JSON.stringify(input.repoIds ?? []),
        input.sourceObservationId ?? null,
        input.kind,
        input.title,
        input.summaryMd,
        input.reasoningMd ?? null,
        input.impactScore ?? 3,
        input.confidenceScore ?? 70,
        input.riskScore ?? 2,
        input.requiredTrustLevel ?? 5,
        now,
      );
    return this.getSuggestion(id)!;
  }

  getSuggestion(id: string): SuggestionRecord | null {
    const row = this.database.prepare('SELECT * FROM suggestions WHERE id = ?').get(id);
    return row ? mapSuggestion(row) : null;
  }

  listSuggestions(filters?: { status?: string; kind?: string; repoId?: string; limit?: number; offset?: number }): SuggestionRecord[] {
    const clauses: string[] = [];
    const values: SQLValue[] = [];

    if (filters?.status) {
      clauses.push('status = ?');
      values.push(filters.status);
    }
    if (filters?.kind) {
      clauses.push('kind = ?');
      values.push(filters.kind);
    }
    if (filters?.repoId) {
      clauses.push('repo_id = ?');
      values.push(filters.repoId);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const pagination = `${filters?.limit != null ? ` LIMIT ${Number(filters.limit)}` : ''}${filters?.offset != null ? ` OFFSET ${Number(filters.offset)}` : ''}`;
    return this.database
      .prepare(`SELECT * FROM suggestions ${where} ORDER BY created_at DESC${pagination}`)
      .all(...values)
      .map(mapSuggestion);
  }

  countSuggestions(filters?: { status?: string; kind?: string; repoId?: string }): number {
    const clauses: string[] = [];
    const values: SQLValue[] = [];
    if (filters?.status) { clauses.push('status = ?'); values.push(filters.status); }
    if (filters?.kind) { clauses.push('kind = ?'); values.push(filters.kind); }
    if (filters?.repoId) { clauses.push('repo_id = ?'); values.push(filters.repoId); }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    return (this.database.prepare(`SELECT COUNT(*) as total FROM suggestions ${where}`).get(...values) as { total: number }).total;
  }

  updateSuggestion(id: string, updates: Partial<Pick<SuggestionRecord, 'status' | 'feedbackNote' | 'shownAt' | 'resolvedAt' | 'expiresAt'>>): void {
    const sets: string[] = [];
    const values: SQLValue[] = [];
    for (const [key, value] of Object.entries(updates)) {
      sets.push(`${toSnake(key)} = ?`);
      values.push((value ?? null) as SQLValue);
    }
    if (sets.length === 0) return;
    values.push(id);
    this.database.prepare(`UPDATE suggestions SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  countPendingSuggestions(): number {
    const row = this.database
      .prepare("SELECT COUNT(*) as count FROM suggestions WHERE status = 'pending'")
      .get() as { count: number };
    return row.count;
  }

  // --- Heartbeats ---

  createHeartbeat(input: { phase: string; activity?: string | null; startedAt: string }): HeartbeatRecord {
    const id = randomUUID();
    this.database
      .prepare(
        `INSERT INTO heartbeats (id, phase, activity, started_at) VALUES (?, ?, ?, ?)`,
      )
      .run(id, input.phase, input.activity ?? null, input.startedAt);
    return this.getHeartbeat(id)!;
  }

  getHeartbeat(id: string): HeartbeatRecord | null {
    const row = this.database.prepare('SELECT * FROM heartbeats WHERE id = ?').get(id);
    return row ? mapHeartbeat(row) : null;
  }

  updateHeartbeat(id: string, updates: Partial<Pick<HeartbeatRecord, 'phase' | 'phases' | 'activity' | 'reposObserved' | 'observationsCreated' | 'suggestionsCreated' | 'llmCalls' | 'tokensUsed' | 'eventsQueued' | 'memoriesPromoted' | 'memoriesDemoted' | 'durationMs' | 'finishedAt'>>): void {
    const sets: string[] = [];
    const values: SQLValue[] = [];
    for (const [key, value] of Object.entries(updates)) {
      if (key === 'reposObserved') {
        sets.push('repos_observed_json = ?');
        values.push(JSON.stringify(value));
      } else if (key === 'phases') {
        sets.push('phases_json = ?');
        values.push(JSON.stringify(value));
      } else {
        sets.push(`${toSnake(key)} = ?`);
        values.push((value ?? null) as SQLValue);
      }
    }
    if (sets.length === 0) return;
    values.push(id);
    this.database.prepare(`UPDATE heartbeats SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  getLastHeartbeat(): HeartbeatRecord | null {
    const row = this.database
      .prepare('SELECT * FROM heartbeats ORDER BY started_at DESC LIMIT 1')
      .get();
    return row ? mapHeartbeat(row) : null;
  }

  listHeartbeats(limit = 20): HeartbeatRecord[] {
    return this.database
      .prepare(`SELECT * FROM heartbeats ORDER BY started_at DESC LIMIT ?`)
      .all(limit)
      .map(mapHeartbeat);
  }

  // --- Interactions ---

  createInteraction(input: { interface: string; kind: string; inputSummary?: string | null; outputSummary?: string | null; sentiment?: string | null; topics?: string[]; trustDelta?: number }): InteractionRecord {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO interactions (id, interface, kind, input_summary, output_summary, sentiment, topics_json, trust_delta, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.interface,
        input.kind,
        input.inputSummary ?? null,
        input.outputSummary ?? null,
        input.sentiment ?? null,
        JSON.stringify(input.topics ?? []),
        input.trustDelta ?? 0.0,
        now,
      );
    // Increment totalInteractions on profile
    try { this.database.prepare('UPDATE user_profile SET total_interactions = total_interactions + 1').run(); } catch { /* */ }
    return this.getInteraction(id)!;
  }

  getInteraction(id: string): InteractionRecord | null {
    const row = this.database.prepare('SELECT * FROM interactions WHERE id = ?').get(id);
    return row ? mapInteraction(row) : null;
  }

  listRecentInteractions(limit = 20): InteractionRecord[] {
    return this.database
      .prepare('SELECT * FROM interactions ORDER BY created_at DESC LIMIT ?')
      .all(limit)
      .map(mapInteraction);
  }

  // --- Event Queue ---

  createEvent(input: { kind: string; priority?: number; payload?: Record<string, unknown> }): EventRecord {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database
      .prepare(
        'INSERT INTO event_queue (id, kind, priority, payload_json, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(id, input.kind, input.priority ?? 5, JSON.stringify(input.payload ?? {}), now);
    return this.getEvent(id)!;
  }

  getEvent(id: string): EventRecord | null {
    const row = this.database.prepare('SELECT * FROM event_queue WHERE id = ?').get(id);
    return row ? mapEvent(row) : null;
  }

  listPendingEvents(minPriority?: number): EventRecord[] {
    if (minPriority !== undefined) {
      return this.database
        .prepare('SELECT * FROM event_queue WHERE delivered = 0 AND priority >= ? ORDER BY priority DESC, created_at')
        .all(minPriority)
        .map(mapEvent);
    }
    return this.database
      .prepare('SELECT * FROM event_queue WHERE delivered = 0 ORDER BY priority DESC, created_at')
      .all()
      .map(mapEvent);
  }

  deliverEvent(id: string): void {
    this.database
      .prepare('UPDATE event_queue SET delivered = 1, delivered_at = ? WHERE id = ?')
      .run(new Date().toISOString(), id);
  }

  deliverAllEvents(): number {
    const now = new Date().toISOString();
    const result = this.database
      .prepare('UPDATE event_queue SET delivered = 1, delivered_at = ? WHERE delivered = 0')
      .run(now);
    return Number(result.changes);
  }

  // --- Runs ---

  createRun(input: CreateRunInput): RunRecord {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO runs (id, repo_id, repo_ids_json, suggestion_id, parent_run_id, kind, prompt, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.repoId,
        JSON.stringify(input.repoIds ?? []),
        input.suggestionId ?? null,
        input.parentRunId ?? null,
        input.kind,
        input.prompt,
        now,
      );
    return this.getRun(id)!;
  }

  getRun(id: string): RunRecord | null {
    const row = this.database.prepare('SELECT * FROM runs WHERE id = ?').get(id);
    return row ? mapRun(row) : null;
  }

  listRuns(filters?: { status?: string; repoId?: string; archived?: boolean; limit?: number; offset?: number }): RunRecord[] {
    const clauses: string[] = [];
    const values: SQLValue[] = [];

    if (filters?.status) {
      clauses.push('status = ?');
      values.push(filters.status);
    }
    if (filters?.repoId) {
      clauses.push('repo_id = ?');
      values.push(filters.repoId);
    }
    // Default: hide archived unless explicitly requested
    if (filters?.archived === true) {
      clauses.push('archived = 1');
    } else if (filters?.archived !== undefined) {
      clauses.push('archived = 0');
    } else {
      clauses.push('archived = 0');
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const pagination = `${filters?.limit != null ? ` LIMIT ${Number(filters.limit)}` : ''}${filters?.offset != null ? ` OFFSET ${Number(filters.offset)}` : ''}`;
    return this.database
      .prepare(`SELECT * FROM runs ${where} ORDER BY created_at DESC${pagination}`)
      .all(...values)
      .map(mapRun);
  }

  countRuns(filters?: { status?: string; archived?: boolean }): number {
    const clauses: string[] = [];
    const values: SQLValue[] = [];
    if (filters?.status) { clauses.push('status = ?'); values.push(filters.status); }
    if (filters?.archived === true) { clauses.push('archived = 1'); }
    else { clauses.push('archived = 0'); }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    return (this.database.prepare(`SELECT COUNT(*) as total FROM runs ${where}`).get(...values) as { total: number }).total;
  }

  updateRun(id: string, updates: Partial<Pick<RunRecord, 'status' | 'resultSummaryMd' | 'errorSummary' | 'artifactDir' | 'sessionId' | 'worktreePath' | 'archived' | 'startedAt' | 'finishedAt'>>): void {
    const sets: string[] = [];
    const values: SQLValue[] = [];
    for (const [key, value] of Object.entries(updates)) {
      sets.push(`${toSnake(key)} = ?`);
      // SQLite doesn't accept JS booleans — convert to 0/1
      const sqlValue = typeof value === 'boolean' ? (value ? 1 : 0) : value;
      values.push((sqlValue ?? null) as SQLValue);
    }
    if (sets.length === 0) return;
    values.push(id);
    this.database.prepare(`UPDATE runs SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  // --- Jobs ---

  createJob(input: { type: string; startedAt: string }): JobRecord {
    const id = randomUUID();
    this.database
      .prepare('INSERT INTO jobs (id, type, started_at, created_at) VALUES (?, ?, ?, ?)')
      .run(id, input.type, input.startedAt, input.startedAt);
    return this.getJob(id)!;
  }

  getJob(id: string): JobRecord | null {
    const row = this.database.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
    return row ? mapJob(row) : null;
  }

  updateJob(id: string, updates: Partial<Pick<JobRecord, 'phase' | 'phases' | 'activity' | 'status' | 'llmCalls' | 'tokensUsed' | 'result' | 'durationMs' | 'finishedAt'>>): void {
    const sets: string[] = [];
    const values: SQLValue[] = [];
    for (const [key, value] of Object.entries(updates)) {
      if (key === 'phases') {
        sets.push('phases_json = ?');
        values.push(JSON.stringify(value));
      } else if (key === 'result') {
        sets.push('result_json = ?');
        values.push(JSON.stringify(value));
      } else {
        sets.push(`${toSnake(key)} = ?`);
        values.push((value ?? null) as SQLValue);
      }
    }
    if (sets.length === 0) return;
    values.push(id);
    this.database.prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  listJobs(filters?: { type?: string; typePrefix?: string; status?: string; limit?: number; offset?: number }): JobRecord[] {
    const clauses: string[] = [];
    const values: SQLValue[] = [];
    if (filters?.type) { clauses.push('type = ?'); values.push(filters.type); }
    if (filters?.typePrefix) { clauses.push('type LIKE ?'); values.push(`${filters.typePrefix}%`); }
    if (filters?.status) { clauses.push('status = ?'); values.push(filters.status); }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = filters?.limit ?? 30;
    const offsetClause = filters?.offset != null ? ` OFFSET ${Number(filters.offset)}` : '';
    return this.database
      .prepare(`SELECT * FROM jobs ${where} ORDER BY started_at DESC LIMIT ?${offsetClause}`)
      .all(...values, limit)
      .map(mapJob);
  }

  countJobs(filters?: { type?: string; typePrefix?: string; status?: string }): number {
    const clauses: string[] = [];
    const values: SQLValue[] = [];
    if (filters?.type) { clauses.push('type = ?'); values.push(filters.type); }
    if (filters?.typePrefix) { clauses.push('type LIKE ?'); values.push(`${filters.typePrefix}%`); }
    if (filters?.status) { clauses.push('status = ?'); values.push(filters.status); }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    return (this.database.prepare(`SELECT COUNT(*) as total FROM jobs ${where}`).get(...values) as { total: number }).total;
  }

  getLastJob(type: string): JobRecord | null {
    const row = this.database
      .prepare('SELECT * FROM jobs WHERE type = ? ORDER BY started_at DESC LIMIT 1')
      .get(type);
    return row ? mapJob(row) : null;
  }

  // --- Feedback ---

  createFeedback(input: { targetKind: string; targetId: string; action: string; note?: string | null }): void {
    const id = randomUUID();
    this.database
      .prepare('INSERT INTO feedback (id, target_kind, target_id, action, note, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, input.targetKind, input.targetId, input.action, input.note ?? null, new Date().toISOString());
  }

  listFeedback(targetKind?: string, limit = 15): FeedbackRecord[] {
    if (targetKind) {
      return this.database
        .prepare('SELECT * FROM feedback WHERE target_kind = ? ORDER BY created_at DESC LIMIT ?')
        .all(targetKind, limit)
        .map(mapFeedback);
    }
    return this.database
      .prepare('SELECT * FROM feedback ORDER BY created_at DESC LIMIT ?')
      .all(limit)
      .map(mapFeedback);
  }

  getThumbsState(targetKind?: string): Record<string, string> {
    const rows = targetKind
      ? this.database.prepare(`SELECT target_id, action FROM feedback WHERE target_kind = ? AND action IN ('thumbs_up', 'thumbs_down') ORDER BY created_at DESC`).all(targetKind)
      : this.database.prepare(`SELECT target_id, action FROM feedback WHERE action IN ('thumbs_up', 'thumbs_down') ORDER BY created_at DESC`).all();
    const state: Record<string, string> = {};
    for (const r of rows) {
      const row = r as { target_id: string; action: string };
      if (!state[row.target_id]) state[row.target_id] = row.action;
    }
    return state;
  }

  // --- Audit Events ---

  createAuditEvent(input: CreateAuditEventInput): AuditEventRecord {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO audit_events (id, actor, interface, action, target_kind, target_id, detail_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.actor ?? 'shadow',
        input.interface,
        input.action,
        input.targetKind ?? null,
        input.targetId ?? null,
        JSON.stringify(input.detail ?? {}),
        now,
      );
    return this.getAuditEvent(id)!;
  }

  getAuditEvent(id: string): AuditEventRecord | null {
    const row = this.database.prepare('SELECT * FROM audit_events WHERE id = ?').get(id);
    return row ? mapAuditEvent(row) : null;
  }

  listAuditEvents(limit = 50): AuditEventRecord[] {
    return this.database
      .prepare('SELECT * FROM audit_events ORDER BY created_at DESC LIMIT ?')
      .all(limit)
      .map(mapAuditEvent);
  }

  // --- LLM Usage ---

  recordLlmUsage(input: CreateLlmUsageInput): LlmUsageRecord {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database
      .prepare(
        'INSERT INTO llm_usage (id, source, source_id, model, input_tokens, output_tokens, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(id, input.source, input.sourceId ?? null, input.model, input.inputTokens, input.outputTokens, now);
    return this.getLlmUsage(id)!;
  }

  getLlmUsage(id: string): LlmUsageRecord | null {
    const row = this.database.prepare('SELECT * FROM llm_usage WHERE id = ?').get(id);
    return row ? mapLlmUsage(row) : null;
  }

  getUsageSummary(period: 'day' | 'week' | 'month' = 'day'): { totalInputTokens: number; totalOutputTokens: number; totalCalls: number; byModel: Record<string, { input: number; output: number; calls: number }> } {
    const daysBack = period === 'day' ? 1 : period === 'week' ? 7 : 30;
    const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();

    const rows = this.database
      .prepare(
        'SELECT model, SUM(input_tokens) as input_sum, SUM(output_tokens) as output_sum, COUNT(*) as call_count FROM llm_usage WHERE created_at > ? GROUP BY model',
      )
      .all(since) as { model: string; input_sum: number; output_sum: number; call_count: number }[];

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCalls = 0;
    const byModel: Record<string, { input: number; output: number; calls: number }> = {};

    for (const row of rows) {
      const input = Number(row.input_sum);
      const output = Number(row.output_sum);
      const calls = Number(row.call_count);
      totalInputTokens += input;
      totalOutputTokens += output;
      totalCalls += calls;
      byModel[row.model] = { input, output, calls };
    }

    return { totalInputTokens, totalOutputTokens, totalCalls, byModel };
  }
}

// --- Factory ---

export function createDatabase(config: ShadowConfig): ShadowDatabase {
  return new ShadowDatabase(config);
}

// --- Mappers ---

function r(row: unknown): Record<string, unknown> {
  return row as Record<string, unknown>;
}

function str(v: unknown): string {
  return String(v);
}

function strOrNull(v: unknown): string | null {
  return v == null ? null : String(v);
}

function num(v: unknown): number {
  return Number(v);
}

function bool(v: unknown): boolean {
  return v === 1 || v === true;
}

function jsonParse<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback;
  try {
    return JSON.parse(String(v)) as T;
  } catch {
    return fallback;
  }
}

function mapRepo(row: unknown): RepoRecord {
  const d = r(row);
  return {
    id: str(d.id),
    name: str(d.name),
    path: str(d.path),
    remoteUrl: strOrNull(d.remote_url),
    defaultBranch: str(d.default_branch),
    languageHint: strOrNull(d.language_hint),
    testCommand: strOrNull(d.test_command),
    lintCommand: strOrNull(d.lint_command),
    buildCommand: strOrNull(d.build_command),
    lastObservedAt: strOrNull(d.last_observed_at),
    createdAt: str(d.created_at),
    updatedAt: str(d.updated_at),
  };
}

function mapSystem(row: unknown): SystemRecord {
  const d = r(row);
  return {
    id: str(d.id),
    name: str(d.name),
    kind: str(d.kind),
    url: strOrNull(d.url),
    description: strOrNull(d.description),
    accessMethod: strOrNull(d.access_method),
    config: jsonParse(d.config_json, {}),
    healthCheck: strOrNull(d.health_check),
    logsLocation: strOrNull(d.logs_location),
    deployMethod: strOrNull(d.deploy_method),
    debugGuide: strOrNull(d.debug_guide),
    relatedRepos: jsonParse(d.related_repos_json, []),
    lastCheckedAt: strOrNull(d.last_checked_at),
    createdAt: str(d.created_at),
    updatedAt: str(d.updated_at),
  };
}

function mapProject(row: unknown): ProjectRecord {
  const d = r(row);
  return {
    id: str(d.id),
    name: str(d.name),
    description: strOrNull(d.description),
    kind: str(d.kind),
    status: str(d.status),
    repoIds: jsonParse(d.repo_ids_json, []),
    systemIds: jsonParse(d.system_ids_json, []),
    contactIds: jsonParse(d.contact_ids_json, []),
    startDate: strOrNull(d.start_date),
    endDate: strOrNull(d.end_date),
    notesMd: strOrNull(d.notes_md),
    createdAt: str(d.created_at),
    updatedAt: str(d.updated_at),
  };
}

function mapContact(row: unknown): ContactRecord {
  const d = r(row);
  return {
    id: str(d.id),
    name: str(d.name),
    role: strOrNull(d.role),
    team: strOrNull(d.team),
    email: strOrNull(d.email),
    slackId: strOrNull(d.slack_id),
    githubHandle: strOrNull(d.github_handle),
    notesMd: strOrNull(d.notes_md),
    preferredChannel: strOrNull(d.preferred_channel),
    lastMentionedAt: strOrNull(d.last_mentioned_at),
    createdAt: str(d.created_at),
    updatedAt: str(d.updated_at),
  };
}

function mapProfile(row: unknown): UserProfileRecord {
  const d = r(row);
  return {
    id: str(d.id),
    displayName: strOrNull(d.display_name),
    timezone: strOrNull(d.timezone),
    locale: str(d.locale),
    workHours: jsonParse(d.work_hours_json, {}),
    commitPatterns: jsonParse(d.commit_patterns_json, {}),
    verbosity: str(d.verbosity),
    proactiveLevel: str(d.proactive_level),
    proactivityLevel: num(d.proactivity_level),
    personalityLevel: num(d.personality_level),
    focusMode: strOrNull(d.focus_mode),
    focusUntil: strOrNull(d.focus_until),
    energyLevel: strOrNull(d.energy_level),
    moodHint: strOrNull(d.mood_hint),
    trustLevel: num(d.trust_level),
    trustScore: num(d.trust_score),
    bondLevel: num(d.bond_level),
    totalInteractions: num(d.total_interactions),
    preferences: jsonParse(d.preferences_json, {}),
    dislikes: jsonParse(d.dislikes_json, []),
    createdAt: str(d.created_at),
    updatedAt: str(d.updated_at),
  };
}

function mapMemory(row: unknown): MemoryRecord {
  const d = r(row);
  return {
    id: str(d.id),
    repoId: strOrNull(d.repo_id),
    contactId: strOrNull(d.contact_id),
    systemId: strOrNull(d.system_id),
    entities: jsonParse(d.entities_json, []),
    layer: str(d.layer),
    scope: str(d.scope),
    kind: str(d.kind),
    title: str(d.title),
    bodyMd: str(d.body_md),
    tags: jsonParse(d.tags_json, []),
    sourceType: str(d.source_type),
    sourceId: strOrNull(d.source_id),
    confidenceScore: num(d.confidence_score),
    relevanceScore: num(d.relevance_score),
    accessCount: num(d.access_count),
    lastAccessedAt: strOrNull(d.last_accessed_at),
    promotedFrom: strOrNull(d.promoted_from),
    demotedTo: strOrNull(d.demoted_to),
    expiresAt: strOrNull(d.expires_at),
    createdAt: str(d.created_at),
    updatedAt: str(d.updated_at),
    archivedAt: strOrNull(d.archived_at),
  };
}

function mapObservation(row: unknown): ObservationRecord {
  const d = r(row);
  return {
    id: str(d.id),
    repoId: str(d.repo_id),
    repoIds: jsonParse(d.repo_ids_json, []),
    entities: jsonParse(d.entities_json, []),
    sourceKind: str(d.source_kind ?? 'repo'),
    sourceId: strOrNull(d.source_id),
    kind: str(d.kind),
    severity: str(d.severity),
    title: str(d.title),
    detail: jsonParse(d.detail_json, {}),
    context: jsonParse(d.context_json, {}),
    votes: num(d.votes ?? 1),
    status: str(d.status ?? 'active'),
    firstSeenAt: str(d.first_seen_at ?? d.created_at),
    lastSeenAt: str(d.last_seen_at ?? d.created_at),
    processed: bool(d.processed),
    suggestionId: strOrNull(d.suggestion_id),
    createdAt: str(d.created_at),
  };
}

function mergeContext(
  old: Record<string, unknown>,
  fresh: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...old, ...fresh };
  if (Array.isArray(old.files) && Array.isArray(fresh.files)) {
    merged.files = [...new Set([...(old.files as string[]), ...(fresh.files as string[])])];
  }
  const sessions = new Set<string>();
  if (old.sessionId) sessions.add(String(old.sessionId));
  if (Array.isArray(old.sessionIds)) (old.sessionIds as string[]).forEach((s) => sessions.add(s));
  if (fresh.sessionId) sessions.add(String(fresh.sessionId));
  if (Array.isArray(fresh.sessionIds)) (fresh.sessionIds as string[]).forEach((s) => sessions.add(s));
  if (sessions.size > 0) {
    merged.sessionIds = [...sessions];
    delete merged.sessionId;
  }
  return merged;
}

function mapSuggestion(row: unknown): SuggestionRecord {
  const d = r(row);
  return {
    id: str(d.id),
    repoId: strOrNull(d.repo_id),
    repoIds: jsonParse(d.repo_ids_json, []),
    entities: jsonParse(d.entities_json, []),
    sourceObservationId: strOrNull(d.source_observation_id),
    kind: str(d.kind),
    title: str(d.title),
    summaryMd: str(d.summary_md),
    reasoningMd: strOrNull(d.reasoning_md),
    impactScore: num(d.impact_score),
    confidenceScore: num(d.confidence_score),
    riskScore: num(d.risk_score),
    requiredTrustLevel: num(d.required_trust_level),
    status: str(d.status),
    feedbackNote: strOrNull(d.feedback_note),
    shownAt: strOrNull(d.shown_at),
    resolvedAt: strOrNull(d.resolved_at),
    createdAt: str(d.created_at),
    expiresAt: strOrNull(d.expires_at),
  };
}

function mapHeartbeat(row: unknown): HeartbeatRecord {
  const d = r(row);
  return {
    id: str(d.id),
    phase: str(d.phase),
    phases: jsonParse(d.phases_json, []),
    activity: strOrNull(d.activity),
    reposObserved: jsonParse(d.repos_observed_json, []),
    observationsCreated: num(d.observations_created),
    suggestionsCreated: num(d.suggestions_created),
    llmCalls: num(d.llm_calls ?? 0),
    tokensUsed: num(d.tokens_used ?? 0),
    eventsQueued: num(d.events_queued ?? 0),
    memoriesPromoted: num(d.memories_promoted ?? 0),
    memoriesDemoted: num(d.memories_demoted ?? 0),
    durationMs: d.duration_ms != null ? num(d.duration_ms) : null,
    startedAt: str(d.started_at),
    finishedAt: strOrNull(d.finished_at),
  };
}

function mapInteraction(row: unknown): InteractionRecord {
  const d = r(row);
  return {
    id: str(d.id),
    interface: str(d.interface),
    kind: str(d.kind),
    inputSummary: strOrNull(d.input_summary),
    outputSummary: strOrNull(d.output_summary),
    sentiment: strOrNull(d.sentiment),
    topics: jsonParse(d.topics_json, []),
    trustDelta: num(d.trust_delta),
    createdAt: str(d.created_at),
  };
}

function mapEvent(row: unknown): EventRecord {
  const d = r(row);
  return {
    id: str(d.id),
    kind: str(d.kind),
    priority: num(d.priority),
    payload: jsonParse(d.payload_json, {}),
    delivered: bool(d.delivered),
    deliveredAt: strOrNull(d.delivered_at),
    createdAt: str(d.created_at),
  };
}

function mapRun(row: unknown): RunRecord {
  const d = r(row);
  return {
    id: str(d.id),
    repoId: str(d.repo_id),
    repoIds: jsonParse(d.repo_ids_json, []),
    suggestionId: strOrNull(d.suggestion_id),
    parentRunId: strOrNull(d.parent_run_id),
    kind: str(d.kind),
    status: str(d.status),
    prompt: str(d.prompt),
    resultSummaryMd: strOrNull(d.result_summary_md),
    errorSummary: strOrNull(d.error_summary),
    artifactDir: strOrNull(d.artifact_dir),
    sessionId: strOrNull(d.session_id),
    worktreePath: strOrNull(d.worktree_path),
    archived: bool(d.archived),
    startedAt: strOrNull(d.started_at),
    finishedAt: strOrNull(d.finished_at),
    createdAt: str(d.created_at),
  };
}

function mapAuditEvent(row: unknown): AuditEventRecord {
  const d = r(row);
  return {
    id: str(d.id),
    actor: str(d.actor),
    interface: str(d.interface),
    action: str(d.action),
    targetKind: strOrNull(d.target_kind),
    targetId: strOrNull(d.target_id),
    detail: jsonParse(d.detail_json, {}),
    createdAt: str(d.created_at),
  };
}

function mapJob(row: unknown): JobRecord {
  const d = r(row);
  return {
    id: str(d.id),
    type: str(d.type),
    phase: str(d.phase),
    phases: jsonParse(d.phases_json, []),
    activity: strOrNull(d.activity),
    status: str(d.status),
    llmCalls: num(d.llm_calls ?? 0),
    tokensUsed: num(d.tokens_used ?? 0),
    result: jsonParse(d.result_json, {}),
    durationMs: d.duration_ms != null ? num(d.duration_ms) : null,
    startedAt: str(d.started_at),
    finishedAt: strOrNull(d.finished_at),
    createdAt: str(d.created_at),
  };
}

function mapDigest(row: unknown): DigestRecord {
  const d = r(row);
  return {
    id: str(d.id),
    kind: str(d.kind),
    periodStart: str(d.period_start),
    periodEnd: str(d.period_end),
    contentMd: str(d.content_md),
    model: str(d.model),
    tokensUsed: num(d.tokens_used),
    createdAt: str(d.created_at),
    updatedAt: str(d.updated_at),
  };
}

function mapFeedback(row: unknown): FeedbackRecord {
  const d = r(row);
  return {
    id: str(d.id),
    targetKind: str(d.target_kind),
    targetId: str(d.target_id),
    action: str(d.action),
    note: strOrNull(d.note),
    createdAt: str(d.created_at),
  };
}

function mapLlmUsage(row: unknown): LlmUsageRecord {
  const d = r(row);
  return {
    id: str(d.id),
    source: str(d.source),
    sourceId: strOrNull(d.source_id),
    model: str(d.model),
    inputTokens: num(d.input_tokens),
    outputTokens: num(d.output_tokens),
    createdAt: str(d.created_at),
  };
}

// --- Helpers ---

function toSnake(camelCase: string): string {
  return camelCase.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}
