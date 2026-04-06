import { EventEmitter } from 'node:events';
import { watch, type FSWatcher } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { relative } from 'node:path';

import type { ShadowConfig } from '../config/schema.js';
import type { ShadowDatabase } from '../storage/database.js';

// Paths that generate too much noise — filter before debounce
const IGNORE_SEGMENTS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '__pycache__',
  'target', 'vendor', '.tox', '.venv', '.shadow-worktrees',
]);

function shouldIgnore(filename: string): boolean {
  const parts = filename.split('/');
  return parts.some((p) => IGNORE_SEGMENTS.has(p));
}

export type ActivityEvent = {
  repoId: string;
  repoName: string;
  fileCount: number;
  durationMs: number;
};

export type GitEvent = {
  repoId: string;
  repoName: string;
  type: 'commit' | 'branch-switch';
};

export class RepoWatcher extends EventEmitter {
  private watchers = new Map<string, FSWatcher>();
  private activityWindows = new Map<string, { firstSeen: number; lastSeen: number; fileCount: number }>();
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private maxWindowTimers = new Map<string, NodeJS.Timeout>();
  private headCache = new Map<string, string>();

  constructor(
    private readonly config: ShadowConfig,
    private readonly db: ShadowDatabase,
  ) {
    super();
  }

  startAll(): void {
    if (!this.config.watcherEnabled) return;

    const repos = this.db.listRepos();
    // Sort by most recently observed first — prioritize active repos within FD budget
    const sorted = [...repos].sort((a, b) =>
      (b.lastObservedAt ?? '').localeCompare(a.lastObservedAt ?? ''));
    const toWatch = sorted.slice(0, this.config.maxWatchedRepos);
    for (const repo of toWatch) {
      this.watchRepo(repo.id, repo.name, repo.path);
    }
  }

  watchRepo(repoId: string, repoName: string, repoPath: string): void {
    if (this.watchers.has(repoId)) return;
    if (this.watchers.size >= this.config.maxWatchedRepos) return;

    // Cache current HEAD
    try {
      const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoPath, encoding: 'utf-8', timeout: 5_000 }).trim();
      this.headCache.set(repoId, head);
    } catch { /* not a git repo or no commits */ }

    try {
      const watcher = watch(repoPath, { recursive: true }, (_event, filename) => {
        if (!filename || shouldIgnore(filename)) return;
        this.onFileChange(repoId, repoName, repoPath);
      });

      watcher.on('error', (err) => {
        if ((err as NodeJS.ErrnoException).code === 'EMFILE') {
          console.error(`[watcher] FD limit hit — unwatching ${repoName}. Consider raising maxWatchedRepos or OS limits.`);
          this.unwatchRepo(repoId);
          return;
        }
        this.emit('error', { repoId, error: err });
      });

      this.watchers.set(repoId, watcher);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EMFILE') {
        console.error(`[watcher] FD limit hit — cannot watch ${repoName}.`);
      } else {
        console.error(`[watcher] Failed to watch ${repoName}:`, err instanceof Error ? err.message : err);
      }
    }
  }

  /** Rotate watchers: drop least-recently-active, add most-recently-active unwatched repos. */
  rotateWatchers(): void {
    if (!this.config.watcherEnabled) return;
    if (this.watchers.size >= this.config.maxWatchedRepos) return;

    const repos = this.db.listRepos();
    const unwatched = repos.filter(r => !this.watchers.has(r.id));
    const sorted = [...unwatched].sort((a, b) =>
      (b.lastObservedAt ?? '').localeCompare(a.lastObservedAt ?? ''));
    for (const repo of sorted.slice(0, this.config.maxWatchedRepos - this.watchers.size)) {
      this.watchRepo(repo.id, repo.name, repo.path);
    }
  }

  unwatchRepo(repoId: string): void {
    const watcher = this.watchers.get(repoId);
    if (watcher) {
      watcher.close();
      this.watchers.delete(repoId);
    }
    this.clearTimers(repoId);
    this.activityWindows.delete(repoId);
    this.headCache.delete(repoId);
  }

  stopAll(): void {
    for (const [repoId, watcher] of this.watchers) {
      watcher.close();
      this.clearTimers(repoId);
    }
    this.watchers.clear();
    this.activityWindows.clear();
    this.headCache.clear();
  }

  get watchedCount(): number {
    return this.watchers.size;
  }

  // --- Internal ---

  private onFileChange(repoId: string, repoName: string, repoPath: string): void {
    const now = Date.now();
    const window = this.activityWindows.get(repoId);

    if (window) {
      window.lastSeen = now;
      window.fileCount++;
    } else {
      this.activityWindows.set(repoId, { firstSeen: now, lastSeen: now, fileCount: 1 });

      // Start max window timer — force emit after maxWindowMs even with continuous activity
      const maxTimer = setTimeout(() => {
        this.flushActivity(repoId, repoName, repoPath);
      }, this.config.watcherMaxWindowMs);
      this.maxWindowTimers.set(repoId, maxTimer);
    }

    // Reset debounce timer — fires after debounceMs of quiet
    const existing = this.debounceTimers.get(repoId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.flushActivity(repoId, repoName, repoPath);
    }, this.config.watcherDebounceMs);
    this.debounceTimers.set(repoId, timer);
  }

  private flushActivity(repoId: string, repoName: string, repoPath: string): void {
    const window = this.activityWindows.get(repoId);
    if (!window) return;

    const durationMs = window.lastSeen - window.firstSeen;
    const fileCount = window.fileCount;

    // Clear state
    this.activityWindows.delete(repoId);
    this.clearTimers(repoId);

    // Emit activity event
    const activity: ActivityEvent = { repoId, repoName, fileCount, durationMs };
    this.emit('activity', activity);

    // Check for git events (new commit or branch switch)
    this.checkGitEvents(repoId, repoName, repoPath);
  }

  private checkGitEvents(repoId: string, repoName: string, repoPath: string): void {
    try {
      const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoPath, encoding: 'utf-8', timeout: 5_000 }).trim();
      const previousHead = this.headCache.get(repoId);

      if (previousHead && head !== previousHead) {
        // HEAD changed — could be commit or branch switch
        let type: GitEvent['type'] = 'commit';
        try {
          const branch = execFileSync('git', ['branch', '--show-current'], { cwd: repoPath, encoding: 'utf-8', timeout: 5_000 }).trim();
          const prevBranch = execFileSync('git', ['branch', '--contains', previousHead, '--format=%(refname:short)'], {
            cwd: repoPath, encoding: 'utf-8', timeout: 5_000,
          }).trim().split('\n')[0];
          if (branch !== prevBranch) type = 'branch-switch';
        } catch { /* assume commit */ }

        const gitEvent: GitEvent = { repoId, repoName, type };
        this.emit('git-event', gitEvent);
      }

      this.headCache.set(repoId, head);
    } catch { /* not a git repo or detached head */ }
  }

  private clearTimers(repoId: string): void {
    const debounce = this.debounceTimers.get(repoId);
    if (debounce) { clearTimeout(debounce); this.debounceTimers.delete(repoId); }
    const maxWindow = this.maxWindowTimers.get(repoId);
    if (maxWindow) { clearTimeout(maxWindow); this.maxWindowTimers.delete(repoId); }
  }
}
