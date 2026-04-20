import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type { EntityLink, TaskRecord } from '../models.js';
import { type SQLValue, mapTask, toSqlValue } from '../mappers.js';
import { syncEntityLinks } from './knowledge.js';

type CreateTaskInput = {
  title: string;
  status?: string;
  contextMd?: string | null;
  externalRefs?: { source: string; key: string; url: string }[];
  repoIds?: string[];
  projectId?: string | null;
  entities?: { type: string; id: string }[];
  suggestionId?: string | null;
  sessionId?: string | null;
  sessionRepoPath?: string | null;
  prUrls?: string[];
};

/**
 * SELECT that decorates each row with a synthetic `repo_ids_json` column
 * populated from the task_repo_links junction (audit D-03). Keeps mapTask
 * unchanged — the mapper reads repo_ids_json either way.
 */
const TASKS_SELECT = `
  SELECT t.*,
    COALESCE(
      (SELECT json_group_array(repo_id) FROM task_repo_links WHERE task_id = t.id),
      '[]'
    ) AS repo_ids_json
  FROM tasks t
`;

function writeRepoLinks(db: DatabaseSync, taskId: string, repoIds: string[]): void {
  db.prepare('DELETE FROM task_repo_links WHERE task_id = ?').run(taskId);
  if (repoIds.length === 0) return;
  const ins = db.prepare('INSERT OR IGNORE INTO task_repo_links (task_id, repo_id) VALUES (?, ?)');
  for (const repoId of repoIds) ins.run(taskId, repoId);
}

export function createTask(db: DatabaseSync, input: CreateTaskInput): TaskRecord {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`
      INSERT INTO tasks (id, title, status, context_md, external_refs_json, project_id, entities_json, suggestion_id, session_id, session_repo_path, pr_urls_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.title,
      input.status ?? 'open',
      input.contextMd ?? null,
      JSON.stringify(input.externalRefs ?? []),
      input.projectId ?? null,
      JSON.stringify(input.entities ?? []),
      input.suggestionId ?? null,
      input.sessionId ?? null,
      input.sessionRepoPath ?? null,
      JSON.stringify(input.prUrls ?? []),
      now,
      now,
    );
    writeRepoLinks(db, id, input.repoIds ?? []);
    if (input.entities?.length) {
      syncEntityLinks(db, 'tasks', id, input.entities as EntityLink[]);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return getTask(db, id)!;
}

export function getTask(db: DatabaseSync, id: string): TaskRecord | null {
  const row = db.prepare(`${TASKS_SELECT} WHERE t.id = ?`).get(id);
  return row ? mapTask(row) : null;
}

export function listTasks(db: DatabaseSync, filters?: { status?: string; repoId?: string; projectId?: string; archived?: boolean; limit?: number; offset?: number }): TaskRecord[] {
  const clauses: string[] = [];
  const values: SQLValue[] = [];
  let from = TASKS_SELECT;
  if (filters?.repoId) {
    from = `
      SELECT t.*,
        COALESCE(
          (SELECT json_group_array(repo_id) FROM task_repo_links WHERE task_id = t.id),
          '[]'
        ) AS repo_ids_json
      FROM tasks t
      INNER JOIN task_repo_links trl ON trl.task_id = t.id
    `;
    clauses.push('trl.repo_id = ?');
    values.push(filters.repoId);
  }
  if (filters?.status) { clauses.push('t.status = ?'); values.push(filters.status); }
  if (filters?.projectId) { clauses.push('t.project_id = ?'); values.push(filters.projectId); }
  if (filters?.archived === true) { clauses.push('t.archived = 1'); }
  else if (filters?.archived === false) { clauses.push('t.archived = 0'); }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const pagination = ` LIMIT ${filters?.limit ?? 50} OFFSET ${filters?.offset ?? 0}`;
  return db
    .prepare(`${from} ${where} ORDER BY t.updated_at DESC${pagination}`)
    .all(...values)
    .map(mapTask);
}

export function countTasks(db: DatabaseSync, filters?: { status?: string; repoId?: string; projectId?: string }): number {
  const clauses: string[] = [];
  const values: SQLValue[] = [];
  let from = 'FROM tasks t';
  if (filters?.repoId) {
    from = 'FROM tasks t INNER JOIN task_repo_links trl ON trl.task_id = t.id';
    clauses.push('trl.repo_id = ?');
    values.push(filters.repoId);
  }
  if (filters?.status) { clauses.push('t.status = ?'); values.push(filters.status); }
  if (filters?.projectId) { clauses.push('t.project_id = ?'); values.push(filters.projectId); }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  return (db.prepare(`SELECT COUNT(DISTINCT t.id) as total ${from} ${where}`).get(...values) as { total: number }).total;
}

export function updateTask(db: DatabaseSync, id: string, updates: Partial<Pick<TaskRecord, 'title' | 'status' | 'contextMd' | 'externalRefs' | 'repoIds' | 'projectId' | 'entities' | 'suggestionId' | 'sessionId' | 'sessionRepoPath' | 'prUrls' | 'archived' | 'closedAt' | 'closedNote'>>): void {
  const columnMap: Record<string, string> = {
    title: 'title', status: 'status', contextMd: 'context_md', externalRefs: 'external_refs_json',
    projectId: 'project_id', entities: 'entities_json', suggestionId: 'suggestion_id',
    sessionId: 'session_id', sessionRepoPath: 'session_repo_path', prUrls: 'pr_urls_json', archived: 'archived', closedAt: 'closed_at', closedNote: 'closed_note',
  };
  const sets: string[] = ['updated_at = ?'];
  const values: SQLValue[] = [new Date().toISOString()];
  for (const [key, value] of Object.entries(updates)) {
    if (key === 'repoIds') continue; // handled via junction below
    const col = columnMap[key];
    if (!col) continue;
    sets.push(`${col} = ?`);
    values.push(toSqlValue(value));
  }
  values.push(id);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    if (updates.repoIds !== undefined) {
      writeRepoLinks(db, id, updates.repoIds);
    }
    if (updates.entities) {
      syncEntityLinks(db, 'tasks', id, updates.entities as EntityLink[]);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function deleteTask(db: DatabaseSync, id: string): void {
  db.exec('BEGIN IMMEDIATE');
  try {
    // task_repo_links cleaned by FK CASCADE
    db.prepare("DELETE FROM entity_links WHERE source_table = 'tasks' AND source_id = ?").run(id);
    db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
