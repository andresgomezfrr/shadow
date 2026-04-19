import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { unlinkSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

import { ConfigSchema } from '../config/schema.js';
import type { ShadowConfig } from '../config/schema.js';
import { ShadowDatabase } from '../storage/database.js';
import type { RepoRecord, RunRecord } from '../storage/models.js';
import type { BackendAdapter, BackendDoctorResult, BackendExecutionResult, ObjectivePack } from '../backend/types.js';
import { EventBus } from '../web/event-bus.js';

// ---------------------------------------------------------------------------
// Mock adapter — replaces selectAdapter(config) in runner.service
// ---------------------------------------------------------------------------

export type MockExecuteFn = (pack: ObjectivePack) => Promise<BackendExecutionResult> | BackendExecutionResult;

export type MockAdapterOpts = {
  /** Full override of the execute method. Takes precedence over `scripted`. */
  execute?: MockExecuteFn;
  /** If true, every call throws — used to test catch paths. */
  throwOnExecute?: boolean;
  /**
   * Per-objective scripted responses. The selector is heuristic:
   *   - confidence: pack.title contains 'confidence' or 'evaluate'
   *   - plan: pack.permissionMode === 'plan'
   *   - execution: everything else
   * Each entry shape-overrides the default success response.
   */
  scripted?: {
    plan?: Partial<BackendExecutionResult>;
    execution?: Partial<BackendExecutionResult>;
    confidence?: Partial<BackendExecutionResult>;
  };
  /**
   * Side-effect to run *before* the execute response is returned.
   * Useful for making the test's git worktree dirty so diff capture sees changes.
   */
  onExecute?: (pack: ObjectivePack) => void | Promise<void>;
};

export type MockAdapter = BackendAdapter & {
  /** Array of every execute() invocation — for assertions. */
  calls: ObjectivePack[];
  /** Number of times execute() was called. */
  callCount: number;
};

/**
 * Build a configurable mock BackendAdapter. Defaults to a happy-path success
 * response so simple tests don't need to spell it out.
 */
export function makeMockAdapter(opts: MockAdapterOpts = {}): MockAdapter {
  const calls: ObjectivePack[] = [];

  const classify = (pack: ObjectivePack): 'plan' | 'execution' | 'confidence' => {
    if (/confidence|evaluate/i.test(pack.title)) return 'confidence';
    if (pack.permissionMode === 'plan') return 'plan';
    return 'execution';
  };

  const defaultResult = (kind: 'plan' | 'execution' | 'confidence'): BackendExecutionResult => ({
    status: 'success',
    exitCode: 0,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    output: kind === 'plan'
      ? '# Test Plan\n\n## Files to modify\n- src/foo.ts\n\n## Steps\n1. Edit foo\n2. Done'
      : kind === 'confidence'
        ? JSON.stringify({ confidence: 'high', doubts: [] })
        : 'Executed the plan successfully. Modified src/foo.ts as described.',
    summaryHint: null,
    inputTokens: 100,
    outputTokens: 200,
    sessionId: `mock-session-${randomUUID().slice(0, 8)}`,
  });

  return {
    kind: 'mock',
    calls,
    get callCount() { return calls.length; },
    async execute(pack: ObjectivePack): Promise<BackendExecutionResult> {
      calls.push(pack);
      if (opts.throwOnExecute) throw new Error('mock adapter configured to throw');
      if (opts.onExecute) await opts.onExecute(pack);
      if (opts.execute) return await opts.execute(pack);
      const kind = classify(pack);
      const base = defaultResult(kind);
      return { ...base, ...(opts.scripted?.[kind] ?? {}) };
    },
    async doctor(): Promise<BackendDoctorResult> {
      return { available: true, kind: 'mock', details: {} };
    },
  };
}

// ---------------------------------------------------------------------------
// Git fixture — real tmpdir repo with initial commit
// ---------------------------------------------------------------------------

export function initTmpGitRepo(): { path: string; cleanup: () => void } {
  const path = join(tmpdir(), `shadow-runner-test-${randomUUID()}`);
  mkdirSync(path, { recursive: true });
  const env = { ...process.env, GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@local', GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@local' };
  const run = (args: string[]) => execFileSync('git', args, { cwd: path, env, stdio: 'pipe' });
  run(['init', '--initial-branch=main']);
  run(['config', 'user.email', 'test@local']);
  run(['config', 'user.name', 'test']);
  // Seed a first commit so HEAD exists (needed for rev-parse / diff)
  writeFileSync(join(path, 'README.md'), '# test\n', 'utf-8');
  run(['add', 'README.md']);
  run(['commit', '-m', 'initial']);

  return {
    path,
    cleanup: () => {
      try { rmSync(path, { recursive: true, force: true }); } catch { /* best-effort */ }
    },
  };
}

/**
 * Mutate a fixture git repo so that a subsequent `git status --porcelain` is dirty.
 * Used by integration tests where the adapter claims to have made changes.
 */
export function makeRepoChange(repoPath: string, file = 'touched.txt', content?: string): void {
  writeFileSync(join(repoPath, file), content ?? `touched-${Date.now()}\n`, 'utf-8');
}

// ---------------------------------------------------------------------------
// Full bootstrap: DB + config + repo + eventBus + cleanup
// ---------------------------------------------------------------------------

export type TestRunnerEnv = {
  db: ShadowDatabase;
  config: ShadowConfig;
  repo: RepoRecord;
  repoPath: string;
  eventBus: EventBus;
  cleanup: () => void;
};

export function createTestRunnerContext(opts?: { maxConcurrentRuns?: number; runnerTimeoutMs?: number }): TestRunnerEnv {
  const dbPath = join(tmpdir(), `shadow-runner-db-${randomUUID()}.db`);
  const dataDir = join(tmpdir(), `shadow-runner-data-${randomUUID()}`);
  mkdirSync(dataDir, { recursive: true });

  const parsed = ConfigSchema.parse({});
  const config: ShadowConfig = {
    ...parsed,
    resolvedDataDir: dataDir,
    resolvedDatabasePath: dbPath,
    resolvedArtifactsDir: join(dataDir, 'artifacts'),
    maxConcurrentRuns: opts?.maxConcurrentRuns ?? parsed.maxConcurrentRuns,
    runnerTimeoutMs: opts?.runnerTimeoutMs ?? parsed.runnerTimeoutMs,
  };

  const db = new ShadowDatabase(config);
  db.ensureProfile('default');

  const git = initTmpGitRepo();
  const repo = db.createRepo({
    name: `test-repo-${randomUUID().slice(0, 8)}`,
    path: git.path,
    defaultBranch: 'main',
  });

  const eventBus = new EventBus();

  return {
    db,
    config,
    repo,
    repoPath: git.path,
    eventBus,
    cleanup: () => {
      db.close();
      git.cleanup();
      try { unlinkSync(dbPath); } catch { /* */ }
      try { unlinkSync(dbPath + '-wal'); } catch { /* */ }
      try { unlinkSync(dbPath + '-shm'); } catch { /* */ }
      try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* */ }
    },
  };
}

// ---------------------------------------------------------------------------
// Seed helpers — run-specific (complements mcp/tools/_test-helpers)
// ---------------------------------------------------------------------------

export function seedPlanRun(db: ShadowDatabase, opts: { repoId: string; suggestionId?: string; prompt?: string }): RunRecord {
  // createRun already inserts with status='queued' (default); no transition needed.
  return db.createRun({
    repoId: opts.repoId,
    kind: 'plan',
    prompt: opts.prompt ?? 'Generate a plan for the test suggestion',
    suggestionId: opts.suggestionId ?? null,
  });
}

export function seedExecutionRun(db: ShadowDatabase, opts: { repoId: string; parentRunId: string; prompt?: string }): RunRecord {
  return db.createRun({
    repoId: opts.repoId,
    kind: 'execution',
    prompt: opts.prompt ?? 'Execute the plan from the parent',
    parentRunId: opts.parentRunId,
  });
}

export function seedParentWithChildren(
  db: ShadowDatabase,
  opts: { repoId: string; childStatuses: Array<'queued' | 'running' | 'done' | 'failed' | 'dismissed' | 'planned'> },
): { parent: RunRecord; children: RunRecord[] } {
  // Drive parent through the legal path queued → running → planned.
  const parent = db.createRun({ repoId: opts.repoId, kind: 'plan', prompt: 'parent' });
  db.transitionRun(parent.id, 'running');
  db.transitionRun(parent.id, 'planned');

  const children = opts.childStatuses.map(status => {
    const child = db.createRun({ repoId: opts.repoId, kind: 'execution', prompt: 'child', parentRunId: parent.id });
    // createRun leaves it in queued. Drive through legal path if requested status differs.
    if (status === 'queued') {
      // already queued
    } else if (status === 'running') {
      db.transitionRun(child.id, 'running');
    } else if (status === 'failed') {
      db.transitionRun(child.id, 'running');
      db.transitionRun(child.id, 'failed');
    } else if (status === 'done') {
      db.transitionRun(child.id, 'running');
      db.transitionRun(child.id, 'done');
    } else if (status === 'planned') {
      db.transitionRun(child.id, 'running');
      db.transitionRun(child.id, 'planned');
    } else if (status === 'dismissed') {
      db.transitionRun(child.id, 'running');
      db.transitionRun(child.id, 'planned');
      db.transitionRun(child.id, 'dismissed');
    }
    return db.getRun(child.id)!;
  });
  return { parent: db.getRun(parent.id)!, children };
}
