import { execFileSync } from 'node:child_process';

import type { ShadowDatabase } from '../storage/database.js';
import type { RepoRecord } from '../storage/models.js';

// --- Types ---

export type RepoContext = {
  repoId: string;
  repoName: string;
  path: string;
  currentBranch: string;
  uncommittedFiles: string[];
  recentCommits: string[];
};

// --- Helpers ---

function tryGitExec(args: string[], cwd: string): string | null {
  try {
    return execFileSync('git', args, {
      cwd,
      timeout: 10_000,
      encoding: 'utf8',
    });
  } catch {
    return null;
  }
}

// --- Lightweight context collector ---

export function collectRepoContext(repo: RepoRecord): RepoContext {
  const ctx: RepoContext = {
    repoId: repo.id,
    repoName: repo.name,
    path: repo.path,
    currentBranch: 'unknown',
    uncommittedFiles: [],
    recentCommits: [],
  };

  try {
    // Current branch
    const branch = tryGitExec(['branch', '--show-current'], repo.path);
    if (branch) ctx.currentBranch = branch.trim();

    // Uncommitted files (just names, not full diff)
    const status = tryGitExec(['status', '--porcelain'], repo.path);
    if (status) {
      ctx.uncommittedFiles = status.trim().split('\n')
        .filter(Boolean)
        .map(line => line.slice(3).trim())
        .slice(0, 20);
    }

    // Last 5 commit subjects
    const log = tryGitExec(['log', '-5', '--format=%s'], repo.path);
    if (log) {
      ctx.recentCommits = log.trim().split('\n').filter(Boolean);
    }
  } catch {
    // Not a git repo or other error
  }

  return ctx;
}

export function collectAllRepoContexts(db: ShadowDatabase): RepoContext[] {
  const repos = db.listRepos();
  return repos.map(repo => collectRepoContext(repo));
}

export function summarizeRepoContexts(contexts: RepoContext[]): string {
  if (contexts.length === 0) return '';

  const lines: string[] = [`${contexts.length} tracked repos:`];

  for (const ctx of contexts) {
    lines.push(`\n### ${ctx.repoName} (${ctx.path})`);
    lines.push(`  Branch: ${ctx.currentBranch}`);

    if (ctx.uncommittedFiles.length > 0) {
      lines.push(`  Uncommitted (${ctx.uncommittedFiles.length} files): ${ctx.uncommittedFiles.slice(0, 10).join(', ')}`);
    }

    if (ctx.recentCommits.length > 0) {
      lines.push(`  Recent commits:`);
      for (const subject of ctx.recentCommits) {
        lines.push(`    - ${subject}`);
      }
    }
  }

  return lines.join('\n');
}

// --- Legacy exports for backwards compatibility ---

export type ObserveResult = {
  repoId: string;
  repoName: string;
  observations: never[];
  lastCommitAt: string | null;
  commitsSinceLastObservation: number;
};

export async function observeAllRepos(db: ShadowDatabase): Promise<ObserveResult[]> {
  const repos = db.listRepos();
  return repos.map(repo => ({
    repoId: repo.id,
    repoName: repo.name,
    observations: [],
    lastCommitAt: null,
    commitsSinceLastObservation: 0,
  }));
}
