import { execFile as _execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { z } from 'zod';

import type { McpTool, ToolContext } from './types.js';
import { mcpSchema, ok } from './types.js';
import { plansDir, readPlansDir, type PlanSummary } from '../resources.js';
import { getDaemonState } from '../../daemon/runtime.js';
import { log } from '../../log.js';

const execFile = promisify(_execFile);

// 1s/repo es agresivo, pero con Promise.allSettled + paralelismo no bloquea.
// Si un repo está bloqueado por un git lock, preferimos timeout antes que
// colgar la respuesta entera.
const DEFAULT_REPO_TIMEOUT_MS = 1000;

const WorkspaceStatusSchema = z.object({
  repoTimeoutMs: z.coerce.number().int().min(100).max(10_000).optional(),
});

type RepoGitStatus = {
  repoId: string;
  name: string;
  path: string;
  branch: string | null;
  dirty: boolean;
  changedFiles: number;
  ahead: number;
  behind: number;
  error?: string;
};

// Parsea la salida de `git status --porcelain=v1 --branch`. La primera línea
// es el header `## <branch>...<upstream> [ahead N, behind M]`; las siguientes
// son una entrada por archivo cambiado.
function parseGitStatus(stdout: string): { branch: string | null; ahead: number; behind: number; changedFiles: number } {
  const lines = stdout.split('\n').filter((l) => l.length > 0);
  let branch: string | null = null;
  let ahead = 0;
  let behind = 0;
  let changedFiles = 0;

  for (const line of lines) {
    if (line.startsWith('## ')) {
      const header = line.slice(3);
      const branchPart = header.split('...')[0].split(' ')[0];
      branch = branchPart || null;
      const aheadMatch = header.match(/ahead (\d+)/);
      const behindMatch = header.match(/behind (\d+)/);
      if (aheadMatch) ahead = parseInt(aheadMatch[1], 10);
      if (behindMatch) behind = parseInt(behindMatch[1], 10);
    } else {
      changedFiles++;
    }
  }
  return { branch, ahead, behind, changedFiles };
}

export async function scanRepoGitStatus(
  repo: { id: string; name: string; path: string },
  timeoutMs: number,
): Promise<RepoGitStatus> {
  if (!existsSync(repo.path)) {
    return { repoId: repo.id, name: repo.name, path: repo.path, branch: null, dirty: false, changedFiles: 0, ahead: 0, behind: 0, error: 'path-not-found' };
  }
  try {
    const { stdout } = await execFile(
      'git',
      ['status', '--porcelain=v1', '--branch'],
      { cwd: repo.path, timeout: timeoutMs, encoding: 'utf-8' },
    );
    const parsed = parseGitStatus(stdout);
    return {
      repoId: repo.id,
      name: repo.name,
      path: repo.path,
      branch: parsed.branch,
      dirty: parsed.changedFiles > 0,
      changedFiles: parsed.changedFiles,
      ahead: parsed.ahead,
      behind: parsed.behind,
    };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    const errLabel = code === 'ETIMEDOUT' ? 'timeout' : code === 'ENOENT' ? 'git-not-installed' : 'git-error';
    return { repoId: repo.id, name: repo.name, path: repo.path, branch: null, dirty: false, changedFiles: 0, ahead: 0, behind: 0, error: errLabel };
  }
}

export type WorkspaceStatusResult = {
  scannedAt: string;
  repos: {
    total: number;
    dirty: RepoGitStatus[];
    diverged: RepoGitStatus[];
    errored: RepoGitStatus[];
    clean: number;
  };
  awaitingPrRuns: Array<{ runId: string; taskId: string | null; prUrl: string | null; repoId: string | null }>;
  activePlans: PlanSummary[];
  openHighObservations: Array<{ id: string; title: string; severity: string; votes: number }>;
  alerts: Array<{ id: string; message: string; severity: string; since: string; acked: boolean }>;
};

export async function buildWorkspaceStatus(
  ctx: ToolContext,
  timeoutMs: number,
): Promise<WorkspaceStatusResult> {
  const repos = ctx.db.listRepos();
  const scanned = await Promise.allSettled(repos.map((r) => scanRepoGitStatus({ id: r.id, name: r.name, path: r.path }, timeoutMs)));

  const statuses: RepoGitStatus[] = scanned.map((res, idx) => {
    if (res.status === 'fulfilled') return res.value;
    log.error(`[workspace] scan unexpectedly rejected for ${repos[idx]?.name}:`, res.reason);
    return { repoId: repos[idx].id, name: repos[idx].name, path: repos[idx].path, branch: null, dirty: false, changedFiles: 0, ahead: 0, behind: 0, error: 'scan-rejected' };
  });

  const dirty = statuses.filter((s) => !s.error && s.dirty);
  const diverged = statuses.filter((s) => !s.error && (s.ahead > 0 || s.behind > 0));
  const errored = statuses.filter((s) => !!s.error);
  const clean = statuses.length - dirty.length - errored.length;

  const awaitingPrRuns = ctx.db.listRuns({ status: 'awaiting_pr', limit: 50 }).map((r) => ({
    runId: r.id,
    taskId: r.taskId ?? null,
    prUrl: r.prUrl ?? null,
    repoId: r.repoId ?? null,
  }));

  const activePlans = readPlansDir(plansDir());

  const openHighObservations = ctx.db
    .listObservations({ status: 'open', severity: 'high', limit: 50 })
    .map((o) => ({ id: o.id, title: o.title, severity: o.severity, votes: o.votes }));

  const state = getDaemonState(ctx.config);
  const alerts = state.alerts ?? [];

  return {
    scannedAt: new Date().toISOString(),
    repos: {
      total: statuses.length,
      dirty,
      diverged,
      errored,
      clean,
    },
    awaitingPrRuns,
    activePlans,
    openHighObservations,
    alerts,
  };
}

export function workspaceTools(ctx: ToolContext): McpTool[] {
  return [
    {
      name: 'shadow_workspace_status',
      description: 'Returns a unified view of the developer workspace: dirty repos (per `git status --porcelain`), diverged branches (ahead/behind), runs awaiting PR merge, active plan-mode plans, open HIGH-severity observations, and current daemon alerts. Use as a single-call replacement for running `git status` across many repos plus checking pending Shadow work. Parallelized with Promise.allSettled so a slow repo never blocks the others.',
      inputSchema: mcpSchema(WorkspaceStatusSchema),
      handler: async (params) => {
        const { repoTimeoutMs } = WorkspaceStatusSchema.parse(params);
        const result = await buildWorkspaceStatus(ctx, repoTimeoutMs ?? DEFAULT_REPO_TIMEOUT_MS);
        return ok(result);
      },
    },
  ];
}
