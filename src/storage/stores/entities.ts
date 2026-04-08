import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type {
  ContactRecord,
  EntityLink,
  ProjectRecord,
  RepoRecord,
  SystemRecord,
} from '../models.js';
import {
  type SQLValue,
  mapRepo,
  mapSystem,
  mapProject,
  mapContact,
  toSnake,
  toSqlValue,
  jsonParse,
} from '../mappers.js';

// --- Repos ---

export function createRepo(db: DatabaseSync, input: { name: string; path: string; remoteUrl?: string | null; defaultBranch?: string; languageHint?: string | null; testCommand?: string | null; lintCommand?: string | null; buildCommand?: string | null }): RepoRecord {
  const id = randomUUID();
  const now = new Date().toISOString();
  db
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
  return getRepo(db, id)!;
}

export function getRepo(db: DatabaseSync, id: string): RepoRecord | null {
  const row = db.prepare('SELECT * FROM repos WHERE id = ?').get(id);
  return row ? mapRepo(row) : null;
}

export function findRepoByName(db: DatabaseSync, name: string): RepoRecord | null {
  const row = db.prepare('SELECT * FROM repos WHERE name = ?').get(name);
  return row ? mapRepo(row) : null;
}

export function findRepoByPath(db: DatabaseSync, path: string): RepoRecord | null {
  const row = db.prepare('SELECT * FROM repos WHERE path = ?').get(path);
  return row ? mapRepo(row) : null;
}

export function listRepos(db: DatabaseSync): RepoRecord[] {
  return db
    .prepare('SELECT * FROM repos ORDER BY created_at DESC')
    .all()
    .map(mapRepo);
}

export function countRepos(db: DatabaseSync): number {
  return (db.prepare('SELECT COUNT(*) as total FROM repos').get() as { total: number }).total;
}

export function updateRepo(db: DatabaseSync, id: string, updates: Partial<Pick<RepoRecord, 'name' | 'remoteUrl' | 'defaultBranch' | 'languageHint' | 'testCommand' | 'lintCommand' | 'buildCommand' | 'lastObservedAt' | 'lastFetchedAt' | 'lastRemoteHead' | 'contextMd' | 'contextUpdatedAt'>>): void {
  const sets: string[] = [];
  const values: SQLValue[] = [];
  for (const [key, value] of Object.entries(updates)) {
    sets.push(`${toSnake(key)} = ?`);
    values.push(toSqlValue(value));
  }
  if (sets.length === 0) return;
  sets.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);
  db.prepare(`UPDATE repos SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

export function deleteRepo(db: DatabaseSync, id: string): void {
  db.prepare('DELETE FROM repos WHERE id = ?').run(id);
}

// --- Systems ---

export function createSystem(db: DatabaseSync, input: { name: string; kind: string; url?: string | null; description?: string | null; accessMethod?: string | null; config?: Record<string, unknown>; healthCheck?: string | null; logsLocation?: string | null; deployMethod?: string | null; debugGuide?: string | null }): SystemRecord {
  const id = randomUUID();
  const now = new Date().toISOString();
  db
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
  return getSystem(db, id)!;
}

export function getSystem(db: DatabaseSync, id: string): SystemRecord | null {
  const row = db.prepare('SELECT * FROM systems WHERE id = ?').get(id);
  return row ? mapSystem(row) : null;
}

export function getSystemsByIds(db: DatabaseSync, ids: string[]): SystemRecord[] {
  if (ids.length === 0) return [];
  const ph = ids.map(() => '?').join(',');
  return db
    .prepare(`SELECT * FROM systems WHERE id IN (${ph})`)
    .all(...ids)
    .map(mapSystem);
}

export function findSystemByName(db: DatabaseSync, name: string): SystemRecord | null {
  const row = db.prepare('SELECT * FROM systems WHERE name = ?').get(name);
  return row ? mapSystem(row) : null;
}

export function listSystems(db: DatabaseSync, filters?: { kind?: string }): SystemRecord[] {
  if (filters?.kind) {
    return db
      .prepare('SELECT * FROM systems WHERE kind = ? ORDER BY created_at DESC')
      .all(filters.kind)
      .map(mapSystem);
  }
  return db
    .prepare('SELECT * FROM systems ORDER BY created_at DESC')
    .all()
    .map(mapSystem);
}

export function countSystems(db: DatabaseSync): number {
  return (db.prepare('SELECT COUNT(*) as total FROM systems').get() as { total: number }).total;
}

export function updateSystem(db: DatabaseSync, id: string, updates: Partial<Pick<SystemRecord, 'name' | 'kind' | 'url' | 'description' | 'accessMethod' | 'healthCheck' | 'logsLocation' | 'deployMethod' | 'debugGuide' | 'lastCheckedAt'>>): void {
  const sets: string[] = [];
  const values: SQLValue[] = [];
  for (const [key, value] of Object.entries(updates)) {
    sets.push(`${toSnake(key)} = ?`);
    values.push(toSqlValue(value));
  }
  if (sets.length === 0) return;
  sets.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);
  db.prepare(`UPDATE systems SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

export function deleteSystem(db: DatabaseSync, id: string): void {
  db.prepare('DELETE FROM systems WHERE id = ?').run(id);
}

// --- Projects ---

export function createProject(db: DatabaseSync, input: { name: string; kind?: string; description?: string | null; status?: string; repoIds?: string[]; systemIds?: string[]; contactIds?: string[]; startDate?: string | null; endDate?: string | null; notesMd?: string | null }): ProjectRecord {
  const id = randomUUID();
  const now = new Date().toISOString();
  db
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
  return getProject(db, id)!;
}

export function getProject(db: DatabaseSync, id: string): ProjectRecord | null {
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  return row ? mapProject(row) : null;
}

export function findProjectByName(db: DatabaseSync, name: string): ProjectRecord | null {
  const row = db.prepare('SELECT * FROM projects WHERE name = ?').get(name);
  return row ? mapProject(row) : null;
}

export function listProjects(db: DatabaseSync, filters?: { status?: string }): ProjectRecord[] {
  if (filters?.status) {
    return db
      .prepare('SELECT * FROM projects WHERE status = ? ORDER BY created_at DESC')
      .all(filters.status)
      .map(mapProject);
  }
  return db
    .prepare('SELECT * FROM projects ORDER BY created_at DESC')
    .all()
    .map(mapProject);
}

export function updateProject(db: DatabaseSync, id: string, updates: Partial<Pick<ProjectRecord, 'name' | 'kind' | 'description' | 'status' | 'repoIds' | 'systemIds' | 'contactIds' | 'startDate' | 'endDate' | 'notesMd' | 'contextMd' | 'contextUpdatedAt'>>): ProjectRecord {
  const sets: string[] = [];
  const values: SQLValue[] = [];
  for (const [key, value] of Object.entries(updates)) {
    const col = toSnake(key);
    if (['repo_ids', 'system_ids', 'contact_ids'].includes(col)) {
      sets.push(`${col}_json = ?`);
      values.push(JSON.stringify(value ?? []));
    } else {
      sets.push(`${col} = ?`);
      values.push(toSqlValue(value));
    }
  }
  if (sets.length === 0) return getProject(db, id)!;
  sets.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);
  db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  return getProject(db, id)!;
}

export function deleteProject(db: DatabaseSync, id: string): void {
  db.prepare('DELETE FROM projects WHERE id = ?').run(id);
}

export function findProjectsForRepo(db: DatabaseSync, repoId: string): ProjectRecord[] {
  return db
    .prepare(`SELECT p.* FROM projects p, json_each(p.repo_ids_json) j WHERE j.value = ? AND p.status != 'archived'`)
    .all(repoId)
    .map(mapProject);
}

// --- Contacts ---

export function createContact(db: DatabaseSync, input: { name: string; role?: string | null; team?: string | null; email?: string | null; slackId?: string | null; githubHandle?: string | null; notesMd?: string | null; preferredChannel?: string | null }): ContactRecord {
  const id = randomUUID();
  const now = new Date().toISOString();
  db
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
  return getContact(db, id)!;
}

export function getContact(db: DatabaseSync, id: string): ContactRecord | null {
  const row = db.prepare('SELECT * FROM contacts WHERE id = ?').get(id);
  return row ? mapContact(row) : null;
}

export function findContactByName(db: DatabaseSync, name: string): ContactRecord | null {
  const row = db.prepare('SELECT * FROM contacts WHERE name = ?').get(name);
  return row ? mapContact(row) : null;
}

export function listContacts(db: DatabaseSync, filters?: { team?: string }): ContactRecord[] {
  if (filters?.team) {
    return db
      .prepare('SELECT * FROM contacts WHERE team = ? ORDER BY name')
      .all(filters.team)
      .map(mapContact);
  }
  return db
    .prepare('SELECT * FROM contacts ORDER BY name')
    .all()
    .map(mapContact);
}

export function countContacts(db: DatabaseSync): number {
  return (db.prepare('SELECT COUNT(*) as total FROM contacts').get() as { total: number }).total;
}

export function updateContact(db: DatabaseSync, id: string, updates: Partial<Pick<ContactRecord, 'name' | 'role' | 'team' | 'email' | 'slackId' | 'githubHandle' | 'notesMd' | 'preferredChannel' | 'lastMentionedAt'>>): void {
  const sets: string[] = [];
  const values: SQLValue[] = [];
  for (const [key, value] of Object.entries(updates)) {
    sets.push(`${toSnake(key)} = ?`);
    values.push(toSqlValue(value));
  }
  if (sets.length === 0) return;
  sets.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);
  db.prepare(`UPDATE contacts SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

export function deleteContact(db: DatabaseSync, id: string): void {
  db.prepare('DELETE FROM contacts WHERE id = ?').run(id);
}
