import { execFileSync } from 'node:child_process';

import type { ShadowDatabase } from '../storage/database.js';
import type { ObservationRecord, RepoRecord } from '../storage/models.js';

// --- Types ---

export type ObserveResult = {
  repoId: string;
  repoName: string;
  observations: ObservationRecord[];
  lastCommitAt: string | null;
  commitsSinceLastObservation: number;
};

type CommitEntry = {
  hash: string;
  date: string;
  subject: string;
  files: string[];
};

// --- Constants ---

const GIT_TIMEOUT = 10_000;

// --- Helpers ---

/**
 * Check if a similar observation already exists recently (last 1h).
 * Prevents duplicate observations across heartbeats.
 */
function hasRecentObservation(db: ShadowDatabase, repoId: string, kind: string): boolean {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const recent = db.listObservations({ repoId, limit: 50 });
  return recent.some(o => o.kind === kind && o.createdAt > oneHourAgo);
}

function gitExec(args: string[], cwd: string): string {
  return execFileSync('git', args, {
    cwd,
    timeout: GIT_TIMEOUT,
    encoding: 'utf8',
  });
}

function tryGitExec(args: string[], cwd: string): string | null {
  try {
    return gitExec(args, cwd);
  } catch {
    return null;
  }
}

function parseGitLog(raw: string): CommitEntry[] {
  const commits: CommitEntry[] = [];
  let current: CommitEntry | null = null;

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;

    const headerMatch = line.match(/^([0-9a-f]{40})\|(.+?)\|(.*)$/);
    if (headerMatch) {
      if (current) commits.push(current);
      current = {
        hash: headerMatch[1],
        date: headerMatch[2],
        subject: headerMatch[3],
        files: [],
      };
      continue;
    }

    if (current) {
      const parts = line.split('\t');
      if (parts.length >= 3) {
        current.files.push(parts[2]);
      }
    }
  }
  if (current) commits.push(current);

  return commits;
}

// --- Observation: recent commits summary (LLM-friendly) ---

function observeRecentCommits(
  db: ShadowDatabase,
  repo: RepoRecord,
  commits: CommitEntry[],
): ObservationRecord | null {
  if (commits.length === 0) return null;

  // Build a useful summary of what changed
  const allFiles = new Set<string>();
  const subjects: string[] = [];
  for (const c of commits.slice(0, 20)) {
    subjects.push(`${c.hash.slice(0, 7)} ${c.subject}`);
    for (const f of c.files) allFiles.add(f);
  }

  // Group files by directory
  const dirCounts = new Map<string, number>();
  for (const f of allFiles) {
    const dir = f.includes('/') ? f.split('/').slice(0, 2).join('/') : '.';
    dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1);
  }
  const topDirs = [...dirCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([dir, count]) => `${dir} (${count} files)`);

  return db.createObservation({
    repoId: repo.id,
    sourceKind: 'repo',
    sourceId: repo.id,
    kind: 'recent_commits',
    severity: 'info',
    title: `${commits.length} new commits in ${repo.name}`,
    detail: {
      commitCount: commits.length,
      commits: subjects.slice(0, 10),
      filesChanged: allFiles.size,
      topDirectories: topDirs,
      dateRange: {
        from: commits[commits.length - 1].date,
        to: commits[0].date,
      },
    },
  });
}

// --- Observation: uncommitted work ---

function observeUncommittedWork(
  db: ShadowDatabase,
  repo: RepoRecord,
  statusOutput: string | null,
  diffStatOutput: string | null,
): ObservationRecord | null {
  if (!statusOutput || !statusOutput.trim()) return null;

  const lines = statusOutput.trim().split('\n').filter(Boolean);
  if (lines.length === 0) return null;

  // Parse status into categories
  const modified: string[] = [];
  const added: string[] = [];
  const deleted: string[] = [];
  const untracked: string[] = [];

  for (const line of lines) {
    const status = line.slice(0, 2).trim();
    const file = line.slice(3).trim();
    if (status === 'M' || status === 'MM') modified.push(file);
    else if (status === 'A' || status === 'AM') added.push(file);
    else if (status === 'D') deleted.push(file);
    else if (status === '??') untracked.push(file);
  }

  // Calculate diff size
  let diffLines = 0;
  if (diffStatOutput) {
    const summary = diffStatOutput.trim().split('\n').pop() ?? '';
    const ins = summary.match(/(\d+) insertion/);
    const del = summary.match(/(\d+) deletion/);
    if (ins) diffLines += parseInt(ins[1], 10);
    if (del) diffLines += parseInt(del[1], 10);
  }

  // Only create observation if there's meaningful uncommitted work
  if (modified.length === 0 && added.length === 0) return null;

  return db.createObservation({
    repoId: repo.id,
    sourceKind: 'repo',
    sourceId: repo.id,
    kind: 'uncommitted_work',
    severity: diffLines > 500 ? 'warning' : 'info',
    title: `Uncommitted work in ${repo.name}: ${modified.length} modified, ${added.length} added`,
    detail: {
      modified: modified.slice(0, 10),
      added: added.slice(0, 10),
      deleted: deleted.slice(0, 5),
      untracked: untracked.length,
      diffLines,
    },
  });
}

// --- Observation: project structure snapshot (first observation only) ---

function observeProjectStructure(
  db: ShadowDatabase,
  repo: RepoRecord,
): ObservationRecord | null {
  // Only run on first observation (lastObservedAt === null)
  if (repo.lastObservedAt !== null) return null;

  // Detect project type from files
  const indicators: Record<string, string> = {};

  const checkFile = (file: string, label: string) => {
    const output = tryGitExec(['ls-files', file], repo.path);
    if (output && output.trim()) indicators[label] = file;
  };

  checkFile('package.json', 'Node.js/TypeScript');
  checkFile('requirements.txt', 'Python');
  checkFile('Cargo.toml', 'Rust');
  checkFile('go.mod', 'Go');
  checkFile('pom.xml', 'Java/Maven');
  checkFile('build.gradle', 'Java/Gradle');
  checkFile('Dockerfile', 'Docker');
  checkFile('docker-compose.yml', 'Docker Compose');
  checkFile('.github/workflows', 'GitHub Actions');
  checkFile('tsconfig.json', 'TypeScript');
  checkFile('.eslintrc', 'ESLint');
  checkFile('jest.config', 'Jest');
  checkFile('vitest.config', 'Vitest');

  // Get current branch
  const branch = tryGitExec(['branch', '--show-current'], repo.path)?.trim() ?? 'unknown';

  // Get top-level directory structure
  const tree = tryGitExec(['ls-tree', '--name-only', 'HEAD'], repo.path);
  const topLevel = tree ? tree.trim().split('\n').filter(Boolean).slice(0, 15) : [];

  // Count total files
  const fileCount = tryGitExec(['ls-files'], repo.path);
  const totalFiles = fileCount ? fileCount.trim().split('\n').length : 0;

  if (Object.keys(indicators).length === 0 && topLevel.length === 0) return null;

  return db.createObservation({
    repoId: repo.id,
    sourceKind: 'repo',
    sourceId: repo.id,
    kind: 'project_structure',
    severity: 'info',
    title: `Project structure: ${repo.name} (${Object.keys(indicators).join(', ') || 'unknown stack'})`,
    detail: {
      techStack: indicators,
      currentBranch: branch,
      topLevelEntries: topLevel,
      totalFiles,
    },
  });
}

// --- Observation: active branches ---

function observeActiveBranches(
  db: ShadowDatabase,
  repo: RepoRecord,
): ObservationRecord | null {
  const branchOutput = tryGitExec(
    ['branch', '-a', '--sort=-committerdate', '--format=%(refname:short)|%(committerdate:iso)|%(subject)'],
    repo.path,
  );
  if (!branchOutput) return null;

  const branches: { name: string; date: string; subject: string }[] = [];
  for (const line of branchOutput.trim().split('\n')) {
    if (!line) continue;
    const parts = line.split('|');
    if (parts.length >= 2) {
      branches.push({
        name: parts[0].trim(),
        date: parts[1].trim(),
        subject: parts[2]?.trim() ?? '',
      });
    }
  }

  // Only report if there are feature branches (not just main/master)
  const featureBranches = branches.filter(b =>
    !['main', 'master', 'HEAD', 'origin/main', 'origin/master', 'origin/HEAD'].includes(b.name) &&
    !b.name.startsWith('origin/HEAD'),
  );

  if (featureBranches.length === 0) return null;

  return db.createObservation({
    repoId: repo.id,
    sourceKind: 'repo',
    sourceId: repo.id,
    kind: 'active_branches',
    severity: 'info',
    title: `${featureBranches.length} feature branches in ${repo.name}`,
    detail: {
      branches: featureBranches.slice(0, 10).map(b => ({
        name: b.name,
        lastCommit: b.date,
        subject: b.subject,
      })),
    },
  });
}

// --- Main observation function ---

export async function observeRepo(db: ShadowDatabase, repo: RepoRecord): Promise<ObserveResult> {
  const result: ObserveResult = {
    repoId: repo.id,
    repoName: repo.name,
    observations: [],
    lastCommitAt: null,
    commitsSinceLastObservation: 0,
  };

  try {
    const sinceArg = repo.lastObservedAt ?? '1970-01-01T00:00:00Z';

    // Git data collection
    const logOutput = tryGitExec(
      ['log', `--since=${sinceArg}`, '--format=%H|%aI|%s', '--numstat'],
      repo.path,
    );
    const commits = logOutput ? parseGitLog(logOutput) : [];
    result.commitsSinceLastObservation = commits.length;

    if (commits.length > 0) {
      const sorted = [...commits].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
      );
      result.lastCommitAt = sorted[0].date;
    }

    const statusOutput = tryGitExec(['status', '--porcelain'], repo.path);
    const diffStatOutput = tryGitExec(['diff', '--stat', 'HEAD'], repo.path);

    // --- Create observations (with dedup) ---

    // Project structure (first time only — gives LLM full context about the repo)
    const structure = observeProjectStructure(db, repo);
    if (structure) result.observations.push(structure);

    // Recent commits (what was worked on) — only if new commits
    if (commits.length > 0 && !hasRecentObservation(db, repo.id, 'recent_commits')) {
      const commitObs = observeRecentCommits(db, repo, commits);
      if (commitObs) result.observations.push(commitObs);
    }

    // Uncommitted work (what's in progress) — dedup
    if (!hasRecentObservation(db, repo.id, 'uncommitted_work')) {
      const uncommitted = observeUncommittedWork(db, repo, statusOutput, diffStatOutput);
      if (uncommitted) result.observations.push(uncommitted);
    }

    // Active branches (what features are in flight) — dedup
    if (!hasRecentObservation(db, repo.id, 'active_branches')) {
      const branches = observeActiveBranches(db, repo);
      if (branches) result.observations.push(branches);
    }

    // Update lastObservedAt
    db.updateRepo(repo.id, { lastObservedAt: new Date().toISOString() });
  } catch {
    // Repo might not exist or might not be a git repo
  }

  return result;
}

// --- Observe all repos ---

export async function observeAllRepos(db: ShadowDatabase): Promise<ObserveResult[]> {
  const repos = db.listRepos();
  const results: ObserveResult[] = [];

  for (const repo of repos) {
    const result = await observeRepo(db, repo);
    results.push(result);
  }

  return results;
}
