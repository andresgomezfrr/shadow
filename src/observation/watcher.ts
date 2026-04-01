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
const COMMIT_BURST_THRESHOLD = 5;
const FILE_HOTSPOT_COMMIT_WINDOW = 10;
const FILE_HOTSPOT_THRESHOLD = 3;
const STALE_BRANCH_DAYS = 14;
const LARGE_DIFF_LINES = 500;
const FORGOTTEN_STASH_DAYS = 7;
const WORK_SESSION_GAP_HOURS = 4;
const WORK_SESSION_END_HOURS = 2;

const DEPENDENCY_FILES = new Set([
  'package.json',
  'requirements.txt',
  'Cargo.toml',
]);

// --- Helpers ---

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

function hoursBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / (1000 * 60 * 60);
}

function daysBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24);
}

/**
 * Parse the output of `git log --format='%H|%aI|%s' --numstat`.
 *
 * Each commit block looks like:
 *   <hash>|<iso-date>|<subject>
 *   <added>\t<removed>\t<file>
 *   ...
 *   (blank line)
 */
function parseGitLog(raw: string): CommitEntry[] {
  const commits: CommitEntry[] = [];
  const lines = raw.split('\n');
  let current: CommitEntry | null = null;

  for (const line of lines) {
    if (line === '') {
      if (current) {
        commits.push(current);
        current = null;
      }
      continue;
    }

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

    // numstat line: <added>\t<removed>\t<file>
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

function parseDiffStatLineCount(raw: string): number {
  // Last line of `git diff --stat` looks like:
  //  3 files changed, 120 insertions(+), 45 deletions(-)
  const lines = raw.trim().split('\n');
  const summary = lines[lines.length - 1] ?? '';
  let total = 0;
  const insertions = summary.match(/(\d+) insertion/);
  if (insertions) total += parseInt(insertions[1], 10);
  const deletions = summary.match(/(\d+) deletion/);
  if (deletions) total += parseInt(deletions[1], 10);
  return total;
}

// --- Detection functions ---

function detectCommitBurst(commits: CommitEntry[]): { found: boolean; windowStart: string; windowEnd: string; count: number } | null {
  if (commits.length < COMMIT_BURST_THRESHOLD) return null;

  // Sliding window: find any 1-hour window with > threshold commits
  const sorted = [...commits].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  for (let i = 0; i <= sorted.length - COMMIT_BURST_THRESHOLD; i++) {
    const windowStart = new Date(sorted[i].date);
    let count = 1;
    for (let j = i + 1; j < sorted.length; j++) {
      const t = new Date(sorted[j].date);
      if (hoursBetween(windowStart, t) <= 1) {
        count++;
      } else {
        break;
      }
    }
    if (count > COMMIT_BURST_THRESHOLD) {
      return {
        found: true,
        windowStart: sorted[i].date,
        windowEnd: sorted[i + count - 1].date,
        count,
      };
    }
  }
  return null;
}

function detectFileHotspots(commits: CommitEntry[]): string[] {
  // Look at the last N commits and find files appearing in > threshold of them
  const recent = commits.slice(0, FILE_HOTSPOT_COMMIT_WINDOW);
  const fileCounts = new Map<string, number>();
  for (const commit of recent) {
    const seen = new Set(commit.files);
    for (const file of seen) {
      fileCounts.set(file, (fileCounts.get(file) ?? 0) + 1);
    }
  }

  const hotspots: string[] = [];
  for (const [file, count] of fileCounts) {
    if (count > FILE_HOTSPOT_THRESHOLD) {
      hotspots.push(file);
    }
  }
  return hotspots;
}

function detectDependencyUpdates(commits: CommitEntry[]): { file: string; commitHash: string }[] {
  const results: { file: string; commitHash: string }[] = [];
  for (const commit of commits) {
    for (const file of commit.files) {
      const basename = file.split('/').pop() ?? file;
      if (DEPENDENCY_FILES.has(basename)) {
        results.push({ file, commitHash: commit.hash });
      }
    }
  }
  return results;
}

function detectWorkSessionStart(commits: CommitEntry[], lastObservedAt: string | null): CommitEntry | null {
  if (commits.length === 0) return null;

  const sorted = [...commits].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // Check gap between lastObservedAt and first commit
  if (lastObservedAt) {
    const gap = hoursBetween(new Date(lastObservedAt), new Date(sorted[0].date));
    if (gap > WORK_SESSION_GAP_HOURS) {
      return sorted[0];
    }
  }

  // Check gaps between consecutive commits
  for (let i = 1; i < sorted.length; i++) {
    const gap = hoursBetween(new Date(sorted[i - 1].date), new Date(sorted[i].date));
    if (gap > WORK_SESSION_GAP_HOURS) {
      return sorted[i];
    }
  }

  return null;
}

function detectWorkSessionEnd(commits: CommitEntry[]): CommitEntry | null {
  if (commits.length === 0) return null;

  const sorted = [...commits].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const lastCommit = sorted[0];
  const now = new Date();
  const gap = hoursBetween(new Date(lastCommit.date), now);

  if (gap > WORK_SESSION_END_HOURS) {
    return lastCommit;
  }
  return null;
}

type BranchInfo = {
  name: string;
  lastCommitDate: string;
};

function parseBranches(raw: string): BranchInfo[] {
  const branches: BranchInfo[] = [];
  for (const line of raw.trim().split('\n')) {
    if (!line) continue;
    const parts = line.split('|');
    if (parts.length >= 2) {
      branches.push({
        name: parts[0].trim(),
        lastCommitDate: parts[1].trim(),
      });
    }
  }
  return branches;
}

type StashEntry = {
  index: number;
  description: string;
  date: string | null;
};

function parseStashList(raw: string, cwd: string): StashEntry[] {
  const entries: StashEntry[] = [];
  const lines = raw.trim().split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    // stash@{0}: WIP on main: abc1234 some message
    const match = line.match(/^stash@\{(\d+)\}:\s*(.*)$/);
    if (!match) continue;
    const index = parseInt(match[1], 10);
    const description = match[2];

    // Get the date for this stash entry
    let date: string | null = null;
    const dateOutput = tryGitExec(
      ['log', '-1', '--format=%aI', `stash@{${index}}`],
      cwd,
    );
    if (dateOutput) {
      date = dateOutput.trim();
    }

    entries.push({ index, description, date });
  }
  return entries;
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

    // 1. Git log: new commits with file stats
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

    // 2. Git status: uncommitted changes
    const statusOutput = tryGitExec(['status', '--porcelain'], repo.path);

    // 3. Git diff stat: working tree diff size
    const diffStatOutput = tryGitExec(['diff', '--stat', 'HEAD'], repo.path);

    // 4. Branch freshness
    const branchOutput = tryGitExec(
      ['branch', '-a', '--sort=-committerdate', '--format=%(refname:short)|%(committerdate:iso)'],
      repo.path,
    );

    // 5. Stash list
    const stashOutput = tryGitExec(['stash', 'list'], repo.path);

    // --- Detect observation kinds ---

    // commit_burst: >5 commits in 1h window
    const burst = detectCommitBurst(commits);
    if (burst) {
      result.observations.push(
        db.createObservation({
          repoId: repo.id,
          sourceKind: 'repo',
          sourceId: repo.id,
          kind: 'commit_burst',
          severity: 'info',
          title: `Commit burst: ${burst.count} commits in 1 hour`,
          detail: {
            count: burst.count,
            windowStart: burst.windowStart,
            windowEnd: burst.windowEnd,
          },
        }),
      );
    }

    // file_hotspot: same file in >3 of last 10 commits
    const hotspots = detectFileHotspots(commits);
    for (const file of hotspots) {
      result.observations.push(
        db.createObservation({
          repoId: repo.id,
          sourceKind: 'repo',
          sourceId: repo.id,
          kind: 'file_hotspot',
          severity: 'info',
          title: `File hotspot: ${file}`,
          detail: { file },
        }),
      );
    }

    // stale_branch: branch with no commits in >14 days
    if (branchOutput) {
      const branches = parseBranches(branchOutput);
      const now = new Date();
      for (const branch of branches) {
        if (!branch.lastCommitDate) continue;
        const branchDate = new Date(branch.lastCommitDate);
        if (daysBetween(now, branchDate) > STALE_BRANCH_DAYS) {
          result.observations.push(
            db.createObservation({
              repoId: repo.id,
              sourceKind: 'repo',
              sourceId: repo.id,
              kind: 'stale_branch',
              severity: 'low',
              title: `Stale branch: ${branch.name}`,
              detail: {
                branch: branch.name,
                lastCommitDate: branch.lastCommitDate,
                staleDays: Math.floor(daysBetween(now, branchDate)),
              },
            }),
          );
        }
      }
    }

    // large_diff: uncommitted diff >500 lines
    if (diffStatOutput) {
      const diffLines = parseDiffStatLineCount(diffStatOutput);
      if (diffLines > LARGE_DIFF_LINES) {
        result.observations.push(
          db.createObservation({
            repoId: repo.id,
            sourceKind: 'repo',
            sourceId: repo.id,
            kind: 'large_diff',
            severity: 'warning',
            title: `Large uncommitted diff: ${diffLines} lines`,
            detail: {
              lines: diffLines,
              statusSummary: statusOutput?.trim().split('\n').length ?? 0,
            },
          }),
        );
      }
    }

    // test_failure: repo.testCommand exits non-zero
    if (repo.testCommand) {
      try {
        execFileSync('sh', ['-c', repo.testCommand], {
          cwd: repo.path,
          timeout: GIT_TIMEOUT,
          encoding: 'utf8',
          stdio: 'pipe',
        });
      } catch {
        result.observations.push(
          db.createObservation({
            repoId: repo.id,
            sourceKind: 'repo',
            sourceId: repo.id,
            kind: 'test_failure',
            severity: 'high',
            title: `Tests failing: ${repo.testCommand}`,
            detail: { testCommand: repo.testCommand },
          }),
        );
      }
    }

    // forgotten_stash: stash entries >7 days old
    if (stashOutput && stashOutput.trim()) {
      const stashes = parseStashList(stashOutput, repo.path);
      const now = new Date();
      for (const stash of stashes) {
        if (!stash.date) continue;
        const stashDate = new Date(stash.date);
        if (daysBetween(now, stashDate) > FORGOTTEN_STASH_DAYS) {
          result.observations.push(
            db.createObservation({
              repoId: repo.id,
              sourceKind: 'repo',
              sourceId: repo.id,
              kind: 'forgotten_stash',
              severity: 'low',
              title: `Forgotten stash: stash@{${stash.index}}`,
              detail: {
                index: stash.index,
                description: stash.description,
                date: stash.date,
                ageDays: Math.floor(daysBetween(now, stashDate)),
              },
            }),
          );
        }
      }
    }

    // dependency_update: package.json/requirements.txt/Cargo.toml changed
    const depUpdates = detectDependencyUpdates(commits);
    if (depUpdates.length > 0) {
      // Group by file to avoid spamming
      const uniqueFiles = [...new Set(depUpdates.map((d) => d.file))];
      for (const file of uniqueFiles) {
        const relatedCommits = depUpdates
          .filter((d) => d.file === file)
          .map((d) => d.commitHash);
        result.observations.push(
          db.createObservation({
            repoId: repo.id,
            sourceKind: 'repo',
            sourceId: repo.id,
            kind: 'dependency_update',
            severity: 'info',
            title: `Dependency file changed: ${file}`,
            detail: {
              file,
              commitCount: relatedCommits.length,
              commits: relatedCommits,
            },
          }),
        );
      }
    }

    // work_session_start: first commit after >4h gap
    const sessionStart = detectWorkSessionStart(commits, repo.lastObservedAt);
    if (sessionStart) {
      result.observations.push(
        db.createObservation({
          repoId: repo.id,
          sourceKind: 'repo',
          sourceId: repo.id,
          kind: 'work_session_start',
          severity: 'info',
          title: `Work session started at ${sessionStart.date}`,
          detail: {
            commitHash: sessionStart.hash,
            commitDate: sessionStart.date,
            commitSubject: sessionStart.subject,
          },
        }),
      );
    }

    // work_session_end: no commits for >2h after last commit
    const sessionEnd = detectWorkSessionEnd(commits);
    if (sessionEnd) {
      const gap = hoursBetween(new Date(sessionEnd.date), new Date());
      result.observations.push(
        db.createObservation({
          repoId: repo.id,
          sourceKind: 'repo',
          sourceId: repo.id,
          kind: 'work_session_end',
          severity: 'info',
          title: `Work session ended ${gap.toFixed(1)}h ago`,
          detail: {
            lastCommitHash: sessionEnd.hash,
            lastCommitDate: sessionEnd.date,
            lastCommitSubject: sessionEnd.subject,
            hoursAgo: parseFloat(gap.toFixed(1)),
          },
        }),
      );
    }

    // Update lastObservedAt
    db.updateRepo(repo.id, { lastObservedAt: new Date().toISOString() });
  } catch {
    // Repo might not exist or might not be a git repo — return empty result
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
