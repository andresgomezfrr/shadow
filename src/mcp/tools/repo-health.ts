import { execFile as _execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';

import type { McpTool, ToolContext } from './types.js';
import { mcpSchema, ok, err } from './types.js';

const execFile = promisify(_execFile);

// 3s/call: `gh` puede ser más lento que git local (red GitHub). Si timeout
// excede, devolvemos error parcial — el resto de aspects siguen.
const GH_TIMEOUT_MS = 3000;

const RepoHealthSchema = z.object({
  repoId: z.string().min(1),
  aspects: z.array(z.enum(['prs', 'ci', 'branch'])).optional(),
});

type Aspect = 'prs' | 'ci' | 'branch';

export type AspectResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

type PrSummary = { number: number; state: string; title: string; headRefName: string };
type CiSummary = { workflowName: string; status: string; conclusion: string | null; createdAt: string } | null;
type BranchSummary = { ahead: number; behind: number; defaultBranch: string };

export type RepoHealthResult = {
  repoId: string;
  repoName: string;
  defaultBranch: string;
  scannedAt: string;
  prs?: AspectResult<PrSummary[]>;
  ci?: AspectResult<CiSummary>;
  branch?: AspectResult<BranchSummary>;
};

function ghErrorLabel(e: unknown): string {
  const code = (e as NodeJS.ErrnoException).code;
  if (code === 'ENOENT') return 'gh-not-installed';
  if (code === 'ETIMEDOUT') return 'timeout';
  const msg = (e instanceof Error ? e.message : String(e)).slice(0, 200);
  return `gh-error: ${msg}`;
}

async function fetchPrs(repoPath: string): Promise<AspectResult<PrSummary[]>> {
  try {
    const { stdout } = await execFile(
      'gh',
      ['pr', 'list', '--json', 'number,state,title,headRefName', '--limit', '20'],
      { cwd: repoPath, timeout: GH_TIMEOUT_MS, encoding: 'utf-8' },
    );
    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      return { ok: false, error: 'parse-error: gh stdout was not valid json' };
    }
    if (!Array.isArray(parsed)) {
      return { ok: false, error: 'parse-error: expected array' };
    }
    return { ok: true, data: parsed as PrSummary[] };
  } catch (e) {
    return { ok: false, error: ghErrorLabel(e) };
  }
}

async function fetchCi(repoPath: string, defaultBranch: string): Promise<AspectResult<CiSummary>> {
  try {
    const { stdout } = await execFile(
      'gh',
      ['run', 'list', '--branch', defaultBranch, '--limit', '1', '--json', 'workflowName,status,conclusion,createdAt'],
      { cwd: repoPath, timeout: GH_TIMEOUT_MS, encoding: 'utf-8' },
    );
    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      return { ok: false, error: 'parse-error: gh stdout was not valid json' };
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return { ok: true, data: null };
    }
    return { ok: true, data: parsed[0] as CiSummary };
  } catch (e) {
    return { ok: false, error: ghErrorLabel(e) };
  }
}

async function fetchBranch(repoPath: string, defaultBranch: string): Promise<AspectResult<BranchSummary>> {
  try {
    const { stdout } = await execFile(
      'git',
      ['rev-list', '--left-right', '--count', `origin/${defaultBranch}...HEAD`],
      { cwd: repoPath, timeout: GH_TIMEOUT_MS, encoding: 'utf-8' },
    );
    const parts = stdout.trim().split(/\s+/);
    if (parts.length !== 2) return { ok: false, error: `parse-error: unexpected rev-list output "${stdout.trim()}"` };
    const behind = parseInt(parts[0], 10);
    const ahead = parseInt(parts[1], 10);
    if (Number.isNaN(ahead) || Number.isNaN(behind)) return { ok: false, error: 'parse-error: NaN in rev-list output' };
    return { ok: true, data: { ahead, behind, defaultBranch } };
  } catch (e) {
    return { ok: false, error: ghErrorLabel(e) };
  }
}

export async function buildRepoHealth(
  ctx: ToolContext,
  repoId: string,
  aspects: Aspect[],
): Promise<RepoHealthResult | { error: string }> {
  const repo = ctx.db.getRepo(repoId);
  if (!repo) return { error: `repo not found: ${repoId}` };

  const result: RepoHealthResult = {
    repoId: repo.id,
    repoName: repo.name,
    defaultBranch: repo.defaultBranch,
    scannedAt: new Date().toISOString(),
  };

  // Lanzamos los aspects solicitados en paralelo — todos comparten timeout
  // individual, así que un aspect lento no bloquea los otros.
  const tasks: Promise<void>[] = [];
  if (aspects.includes('prs')) {
    tasks.push(fetchPrs(repo.path).then((r) => { result.prs = r; }));
  }
  if (aspects.includes('ci')) {
    tasks.push(fetchCi(repo.path, repo.defaultBranch).then((r) => { result.ci = r; }));
  }
  if (aspects.includes('branch')) {
    tasks.push(fetchBranch(repo.path, repo.defaultBranch).then((r) => { result.branch = r; }));
  }
  await Promise.all(tasks);
  return result;
}

export function repoHealthTools(ctx: ToolContext): McpTool[] {
  return [
    {
      name: 'shadow_repo_health',
      description: 'Reports repo health for a single repo via gh CLI + git: open PRs (number/state/title/branch), last CI run on default branch (workflow/status/conclusion), and branch divergence vs origin (ahead/behind). Per-aspect error envelope — if `gh` is not installed or unauthenticated, that aspect fails gracefully and others continue. Touches network (GitHub API via gh).',
      inputSchema: mcpSchema(RepoHealthSchema),
      annotations: { openWorldHint: true, readOnlyHint: true, idempotentHint: true },
      handler: async (params) => {
        const { repoId, aspects } = RepoHealthSchema.parse(params);
        const aspectList: Aspect[] = aspects ?? ['prs', 'ci', 'branch'];
        const result = await buildRepoHealth(ctx, repoId, aspectList);
        if ('error' in result) return err(result.error);
        return ok(result);
      },
    },
  ];
}
