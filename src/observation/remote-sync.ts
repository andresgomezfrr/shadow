import { execSync } from 'node:child_process';
import type { ShadowDatabase } from '../storage/database.js';

export type RemoteSyncResult = {
  repoId: string;
  repoName: string;
  newRemoteCommits: number;
  behindBranches: Array<{ branch: string; behind: number; ahead: number }>;
  newCommitMessages: string[];
  affectedEntities: Array<{ entityType: string; entityId: string }>;
  fetchedAt: string;
};

const GIT_ENV = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_SSH_COMMAND: 'ssh -o BatchMode=yes',
};

function gitExec(cmd: string, cwd: string, timeoutMs = 10_000): string | null {
  try {
    return execSync(cmd, {
      cwd,
      encoding: 'utf-8',
      timeout: timeoutMs,
      stdio: 'pipe',
      env: { ...process.env, ...GIT_ENV },
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Remote sync: check repos for remote changes using lightweight git ls-remote,
 * then selective git fetch only for repos with detected changes.
 * Round-robin: processes repos sorted by lastFetchedAt ASC (oldest first).
 */
export function remoteSyncRepos(db: ShadowDatabase, batchSize: number, repoId?: string): RemoteSyncResult[] {
  const allRepos = db.listRepos();
  const results: RemoteSyncResult[] = [];

  let batch: typeof allRepos;
  if (repoId) {
    // Specific repo requested (manual trigger)
    const repo = allRepos.find(r => r.id === repoId);
    batch = repo ? [repo] : [];
  } else {
    // Sort by lastFetchedAt ASC (NULL first = never fetched), then take batchSize
    const sorted = [...allRepos].sort((a, b) => {
      if (!a.lastFetchedAt && !b.lastFetchedAt) return 0;
      if (!a.lastFetchedAt) return -1;
      if (!b.lastFetchedAt) return 1;
      return a.lastFetchedAt.localeCompare(b.lastFetchedAt);
    });
    batch = sorted.slice(0, batchSize);
  }

  for (const repo of batch) {
    const now = new Date().toISOString();

    // Step 1: Lightweight detection — git ls-remote vs local HEAD
    const remoteHead = gitExec('git ls-remote origin HEAD', repo.path);
    if (!remoteHead) {
      // No remote or network error — skip, don't update timestamp so we retry next cycle
      continue;
    }

    const remoteHeadSha = remoteHead.split('\t')[0];
    const localHead = gitExec('git rev-parse HEAD', repo.path);

    if (!localHead || remoteHeadSha === localHead) {
      // No changes — just update fetch timestamp
      db.updateRepo(repo.id, { lastFetchedAt: now });
      results.push({
        repoId: repo.id, repoName: repo.name,
        newRemoteCommits: 0, behindBranches: [], newCommitMessages: [],
        affectedEntities: [], fetchedAt: now,
      });
      continue;
    }

    // Step 2: Selective fetch — remote has changes
    const defaultBranch = repo.defaultBranch || 'main';
    const oldRemoteHead = repo.lastRemoteHead;

    const fetchResult = gitExec('git fetch --prune', repo.path, 30_000);
    if (fetchResult === null) {
      // Fetch failed — don't update timestamp so we retry next cycle
      continue;
    }

    // Step 2b: Fast-forward local branch if possible (safe — fails if diverged)
    gitExec(`git merge --ff-only origin/${defaultBranch}`, repo.path, 10_000);

    // Step 3: Count NEW remote commits since last sync (delta, not total behind)
    const newRemoteHead = gitExec(`git rev-parse origin/${defaultBranch}`, repo.path);

    let newRemoteCommits = 0;
    let commitMessages: string[] = [];

    if (oldRemoteHead && newRemoteHead && oldRemoteHead !== newRemoteHead) {
      // Delta: commits between last known remote head and current remote head
      const countStr = gitExec(`git rev-list --count ${oldRemoteHead}..origin/${defaultBranch}`, repo.path);
      newRemoteCommits = countStr ? parseInt(countStr, 10) : 0;
      const msgs = gitExec(`git log ${oldRemoteHead}..origin/${defaultBranch} --format="%h %s" -n 10`, repo.path);
      commitMessages = msgs ? msgs.split('\n').filter(Boolean) : [];
    } else if (!oldRemoteHead) {
      // First sync for this repo — count behind as initial baseline
      const countStr = gitExec(`git rev-list --count HEAD..origin/${defaultBranch}`, repo.path);
      newRemoteCommits = countStr ? parseInt(countStr, 10) : 0;
      const msgs = gitExec(`git log HEAD..origin/${defaultBranch} --format="%h %s" -n 10`, repo.path);
      commitMessages = msgs ? msgs.split('\n').filter(Boolean) : [];
    }
    // else: oldRemoteHead === newRemoteHead → 0 new commits

    // Current local divergence (for observations)
    const behindCount = gitExec(`git rev-list --count HEAD..origin/${defaultBranch}`, repo.path);
    const aheadCount = gitExec(`git rev-list --count origin/${defaultBranch}..HEAD`, repo.path);
    const behind = behindCount ? parseInt(behindCount, 10) : 0;
    const ahead = aheadCount ? parseInt(aheadCount, 10) : 0;

    const behindBranches = behind > 0 || ahead > 0
      ? [{ branch: defaultBranch, behind, ahead }]
      : [];

    // Step 4: Find affected entities via relationship graph
    let affectedEntities: Array<{ entityType: string; entityId: string }> = [];
    try {
      affectedEntities = db.getRelatedEntities('repo', repo.id, { direction: 'both', maxDepth: 1 });
    } catch { /* graph not available */ }

    db.updateRepo(repo.id, { lastFetchedAt: now, lastRemoteHead: newRemoteHead ?? undefined });

    results.push({
      repoId: repo.id,
      repoName: repo.name,
      newRemoteCommits,
      behindBranches,
      newCommitMessages: commitMessages,
      affectedEntities,
      fetchedAt: now,
    });
  }

  return results;
}
