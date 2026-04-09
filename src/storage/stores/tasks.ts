import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type { TaskRecord } from '../models.js';
import { type SQLValue, mapTask, toSqlValue } from '../mappers.js';

type CreateTaskInput = {
  title: string;
  status?: string;
  contextMd?: string | null;
  externalRefs?: { source: string; key: string; url: string }[];
  repoIds?: string[];
  projectId?: string | null;
  entities?: { type: string; id: string }[];
  sessionId?: string | null;
  sessionRepoPath?: string | null;
  prUrls?: string[];
};

export function createTask(db: DatabaseSync, input: CreateTaskInput): TaskRecord {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO tasks (id, title, status, context_md, external_refs_json, repo_ids_json, project_id, entities_json, session_id, session_repo_path, pr_urls_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.title,
    input.status ?? 'todo',
    input.contextMd ?? null,
    JSON.stringify(input.externalRefs ?? []),
    JSON.stringify(input.repoIds ?? []),
    input.projectId ?? null,
    JSON.stringify(input.entities ?? []),
    input.sessionId ?? null,
    input.sessionRepoPath ?? null,
    JSON.stringify(input.prUrls ?? []),
    now,
    now,
  );
  return getTask(db, id)!;
}

export function getTask(db: DatabaseSync, id: string): TaskRecord | null {
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  return row ? mapTask(row) : null;
}

export function listTasks(db: DatabaseSync, filters?: { status?: string; repoId?: string; projectId?: string; limit?: number; offset?: number }): TaskRecord[] {
  const clauses: string[] = [];
  const values: SQLValue[] = [];
  if (filters?.status) { clauses.push('status = ?'); values.push(filters.status); }
  if (filters?.repoId) { clauses.push('repo_ids_json LIKE ?'); values.push(`%${filters.repoId}%`); }
  if (filters?.projectId) { clauses.push('project_id = ?'); values.push(filters.projectId); }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const pagination = ` LIMIT ${filters?.limit ?? 50} OFFSET ${filters?.offset ?? 0}`;
  return db
    .prepare(`SELECT * FROM tasks ${where} ORDER BY updated_at DESC${pagination}`)
    .all(...values)
    .map(mapTask);
}

export function countTasks(db: DatabaseSync, filters?: { status?: string; repoId?: string; projectId?: string }): number {
  const clauses: string[] = [];
  const values: SQLValue[] = [];
  if (filters?.status) { clauses.push('status = ?'); values.push(filters.status); }
  if (filters?.repoId) { clauses.push('repo_ids_json LIKE ?'); values.push(`%${filters.repoId}%`); }
  if (filters?.projectId) { clauses.push('project_id = ?'); values.push(filters.projectId); }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  return (db.prepare(`SELECT COUNT(*) as total FROM tasks ${where}`).get(...values) as { total: number }).total;
}

export function updateTask(db: DatabaseSync, id: string, updates: Partial<Pick<TaskRecord, 'title' | 'status' | 'contextMd' | 'externalRefs' | 'repoIds' | 'projectId' | 'entities' | 'sessionId' | 'sessionRepoPath' | 'prUrls' | 'closedAt'>>): void {
  const columnMap: Record<string, string> = {
    title: 'title', status: 'status', contextMd: 'context_md', externalRefs: 'external_refs_json',
    repoIds: 'repo_ids_json', projectId: 'project_id', entities: 'entities_json',
    sessionId: 'session_id', sessionRepoPath: 'session_repo_path', prUrls: 'pr_urls_json', closedAt: 'closed_at',
  };
  const sets: string[] = ['updated_at = ?'];
  const values: SQLValue[] = [new Date().toISOString()];
  for (const [key, value] of Object.entries(updates)) {
    const col = columnMap[key];
    if (!col) continue;
    sets.push(`${col} = ?`);
    values.push(toSqlValue(value));
  }
  values.push(id);
  db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

export function deleteTask(db: DatabaseSync, id: string): void {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
}
