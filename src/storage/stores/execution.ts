import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type { JobRecord, RunRecord } from '../models.js';
import {
  type SQLValue,
  mapRun,
  mapJob,
  toSnake,
  toSqlValue,
} from '../mappers.js';
import { assertTransition, type RunStatus } from '../../runner/state-machine.js';

// --- Runs ---

export function createRun(db: DatabaseSync, input: { repoId: string; repoIds?: string[]; suggestionId?: string | null; taskId?: string | null; parentRunId?: string | null; kind: string; prompt: string }): RunRecord {
  const id = randomUUID();
  const now = new Date().toISOString();
  db
    .prepare(
      `INSERT INTO runs (id, repo_id, repo_ids_json, suggestion_id, task_id, parent_run_id, kind, prompt, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.repoId,
      JSON.stringify(input.repoIds ?? []),
      input.suggestionId ?? null,
      input.taskId ?? null,
      input.parentRunId ?? null,
      input.kind,
      input.prompt,
      now,
    );
  return getRun(db, id)!;
}

export function getRun(db: DatabaseSync, id: string): RunRecord | null {
  const row = db.prepare('SELECT * FROM runs WHERE id = ?').get(id);
  return row ? mapRun(row) : null;
}

export function listRuns(db: DatabaseSync, filters?: { status?: string; repoId?: string; parentRunId?: string; archived?: boolean; startedAfter?: string; limit?: number; offset?: number }): RunRecord[] {
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
  if (filters?.parentRunId) {
    clauses.push('parent_run_id = ?');
    values.push(filters.parentRunId);
  }
  // Default: hide archived unless explicitly requested
  if (filters?.archived === true) {
    clauses.push('archived = 1');
  } else if (filters?.archived !== undefined) {
    clauses.push('archived = 0');
  } else {
    clauses.push('archived = 0');
  }
  if (filters?.startedAfter) {
    clauses.push('COALESCE(started_at, created_at) >= ?');
    values.push(filters.startedAfter);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const pagination = `${filters?.limit != null ? ` LIMIT ${Number(filters.limit)}` : ''}${filters?.offset != null ? ` OFFSET ${Number(filters.offset)}` : ''}`;
  return db
    .prepare(`SELECT * FROM runs ${where} ORDER BY created_at DESC, id ASC${pagination}`)
    .all(...values)
    .map(mapRun);
}

export function countRuns(db: DatabaseSync, filters?: { status?: string; archived?: boolean }): number {
  const clauses: string[] = [];
  const values: SQLValue[] = [];
  if (filters?.status) { clauses.push('status = ?'); values.push(filters.status); }
  if (filters?.archived === true) { clauses.push('archived = 1'); }
  else { clauses.push('archived = 0'); }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  return (db.prepare(`SELECT COUNT(*) as total FROM runs ${where}`).get(...values) as { total: number }).total;
}

export function updateRun(db: DatabaseSync, id: string, updates: Partial<Pick<RunRecord, 'status' | 'resultSummaryMd' | 'errorSummary' | 'artifactDir' | 'sessionId' | 'worktreePath' | 'confidence' | 'prUrl' | 'snapshotRef' | 'resultRef' | 'diffStat' | 'verified' | 'closedNote' | 'autoEvalAt' | 'archived' | 'activity' | 'outcome' | 'taskId' | 'startedAt' | 'finishedAt'>> & { doubts?: string[]; verification?: RunRecord['verification'] }): void {
  const sets: string[] = [];
  const values: SQLValue[] = [];
  for (const [key, value] of Object.entries(updates)) {
    const colName = key === 'doubts' ? 'doubts_json' : key === 'verification' ? 'verification_json' : toSnake(key);
    sets.push(`${colName} = ?`);
    values.push(toSqlValue(value));
  }
  if (sets.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE runs SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

/** List planned runs eligible for auto-execution: planned, confidence evaluated, not yet reviewed by auto-execute. */
export function listPlannedRunsForAutoExec(db: DatabaseSync): RunRecord[] {
  return db
    .prepare(`SELECT * FROM runs WHERE status = 'planned' AND confidence IS NOT NULL AND auto_eval_at IS NULL AND archived = 0 ORDER BY created_at ASC`)
    .all()
    .map(mapRun);
}

/**
 * Transition a run's status with validation.
 * Throws RunTransitionError if the transition is invalid.
 */
export function transitionRun(db: DatabaseSync, id: string, to: import('../models.js').RunRecord['status']): void {
  const run = getRun(db, id);
  if (!run) throw new Error(`Run ${id} not found`);
  assertTransition(run.status, to as RunStatus);
  updateRun(db, id, { status: to });
}

// --- Jobs ---

export function createJob(db: DatabaseSync, input: { type: string; startedAt: string }): JobRecord {
  const id = randomUUID();
  db
    .prepare('INSERT INTO jobs (id, type, started_at, created_at) VALUES (?, ?, ?, ?)')
    .run(id, input.type, input.startedAt, input.startedAt);
  return getJob(db, id)!;
}

export function getJob(db: DatabaseSync, id: string): JobRecord | null {
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  return row ? mapJob(row) : null;
}

export function updateJob(db: DatabaseSync, id: string, updates: Partial<Pick<JobRecord, 'phase' | 'phases' | 'activity' | 'status' | 'llmCalls' | 'tokensUsed' | 'result' | 'durationMs' | 'finishedAt'>>): void {
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
  db.prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

export function listJobs(db: DatabaseSync, filters?: { type?: string; typePrefix?: string; status?: string; startedAfter?: string; limit?: number; offset?: number }): JobRecord[] {
  const clauses: string[] = [];
  const values: SQLValue[] = [];
  if (filters?.type) { clauses.push('type = ?'); values.push(filters.type); }
  if (filters?.typePrefix) { clauses.push('type LIKE ?'); values.push(`${filters.typePrefix}%`); }
  if (filters?.status) { clauses.push('status = ?'); values.push(filters.status); }
  if (filters?.startedAfter) { clauses.push('started_at >= ?'); values.push(filters.startedAfter); }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = filters?.limit ?? 30;
  const offsetClause = filters?.offset != null ? ` OFFSET ${Number(filters.offset)}` : '';
  return db
    .prepare(`SELECT * FROM jobs ${where} ORDER BY started_at DESC LIMIT ?${offsetClause}`)
    .all(...values, limit)
    .map(mapJob);
}

export function countJobs(db: DatabaseSync, filters?: { type?: string; typePrefix?: string; status?: string }): number {
  const clauses: string[] = [];
  const values: SQLValue[] = [];
  if (filters?.type) { clauses.push('type = ?'); values.push(filters.type); }
  if (filters?.typePrefix) { clauses.push('type LIKE ?'); values.push(`${filters.typePrefix}%`); }
  if (filters?.status) { clauses.push('status = ?'); values.push(filters.status); }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  return (db.prepare(`SELECT COUNT(*) as total FROM jobs ${where}`).get(...values) as { total: number }).total;
}

export function getLastJob(db: DatabaseSync, type: string): JobRecord | null {
  const row = db
    .prepare('SELECT * FROM jobs WHERE type = ? ORDER BY started_at DESC LIMIT 1')
    .get(type);
  return row ? mapJob(row) : null;
}

export function enqueueJob(db: DatabaseSync, type: string, opts?: { priority?: number; triggerSource?: string; params?: Record<string, unknown> }): JobRecord {
  const id = randomUUID();
  const now = new Date().toISOString();
  const resultJson = JSON.stringify(opts?.params ?? {});
  db
    .prepare('INSERT INTO jobs (id, type, status, priority, trigger_source, result_json, started_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, type, 'queued', opts?.priority ?? 5, opts?.triggerSource ?? 'schedule', resultJson, now, now);
  return getJob(db, id)!;
}

export function claimNextJob(db: DatabaseSync, opts?: { types?: string[]; excludeTypes?: string[]; triggerSource?: string }): JobRecord | null {
  const params: SQLValue[] = [];
  let where = "status = 'queued'";
  if (opts?.types?.length) {
    where += ` AND type IN (${opts.types.map(() => '?').join(',')})`;
    params.push(...opts.types);
  }
  if (opts?.excludeTypes?.length) {
    where += ` AND type NOT IN (${opts.excludeTypes.map(() => '?').join(',')})`;
    params.push(...opts.excludeTypes);
  }
  if (opts?.triggerSource) {
    where += ' AND trigger_source = ?';
    params.push(opts.triggerSource);
  }
  const row = db
    .prepare(`SELECT id FROM jobs WHERE ${where} ORDER BY priority DESC, created_at ASC LIMIT 1`)
    .get(...params) as { id: string } | undefined;
  if (!row) return null;
  const now = new Date().toISOString();
  db
    .prepare("UPDATE jobs SET status = 'running', started_at = ? WHERE id = ? AND status = 'queued'")
    .run(now, row.id);
  return getJob(db, row.id)!;
}

export function hasQueuedOrRunning(db: DatabaseSync, type: string): boolean {
  const row = db
    .prepare("SELECT 1 FROM jobs WHERE type = ? AND status IN ('queued', 'running') LIMIT 1")
    .get(type);
  return !!row;
}

export function hasQueuedOrRunningWithParams(
  db: DatabaseSync, type: string, paramKey: string, paramValue: string,
): boolean {
  const rows = db
    .prepare("SELECT result_json FROM jobs WHERE type = ? AND status IN ('queued', 'running')")
    .all(type) as Array<{ result_json: string }>;
  return rows.some(row => {
    try {
      const params = JSON.parse(row.result_json);
      return params[paramKey] === paramValue;
    } catch { return false; }
  });
}
