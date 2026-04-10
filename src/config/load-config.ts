import 'dotenv/config';

import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';

import { ConfigSchema } from './schema.js';
import type { ShadowConfig } from './schema.js';

export type { ShadowConfig };

export function loadConfig(): ShadowConfig {
  const modelsInput: Record<string, string> = {};
  if (process.env.SHADOW_MODEL_ANALYZE) modelsInput.analyze = process.env.SHADOW_MODEL_ANALYZE;
  if (process.env.SHADOW_MODEL_SUGGEST) modelsInput.suggest = process.env.SHADOW_MODEL_SUGGEST;
  if (process.env.SHADOW_MODEL_CONSOLIDATE) modelsInput.consolidate = process.env.SHADOW_MODEL_CONSOLIDATE;
  if (process.env.SHADOW_MODEL_RUNNER) modelsInput.runner = process.env.SHADOW_MODEL_RUNNER;
  if (process.env.SHADOW_MODEL_THOUGHT) modelsInput.thought = process.env.SHADOW_MODEL_THOUGHT;
  if (process.env.SHADOW_MODEL_ENRICH_PLAN) modelsInput.enrichPlan = process.env.SHADOW_MODEL_ENRICH_PLAN;
  if (process.env.SHADOW_MODEL_ENRICH_EXECUTE) modelsInput.enrichExecute = process.env.SHADOW_MODEL_ENRICH_EXECUTE;
  if (process.env.SHADOW_MODEL_DIGEST_DAILY) modelsInput.digestDaily = process.env.SHADOW_MODEL_DIGEST_DAILY;
  if (process.env.SHADOW_MODEL_DIGEST_WEEKLY) modelsInput.digestWeekly = process.env.SHADOW_MODEL_DIGEST_WEEKLY;
  if (process.env.SHADOW_MODEL_DIGEST_BRAG) modelsInput.digestBrag = process.env.SHADOW_MODEL_DIGEST_BRAG;
  if (process.env.SHADOW_MODEL_REPO_PROFILE) modelsInput.repoProfile = process.env.SHADOW_MODEL_REPO_PROFILE;
  if (process.env.SHADOW_MODEL_SUGGEST_VALIDATE) modelsInput.suggestValidate = process.env.SHADOW_MODEL_SUGGEST_VALIDATE;
  if (process.env.SHADOW_MODEL_SUGGEST_DEEP) modelsInput.suggestDeep = process.env.SHADOW_MODEL_SUGGEST_DEEP;
  if (process.env.SHADOW_MODEL_SUGGEST_PROJECT) modelsInput.suggestProject = process.env.SHADOW_MODEL_SUGGEST_PROJECT;
  if (process.env.SHADOW_MODEL_PROJECT_PROFILE) modelsInput.projectProfile = process.env.SHADOW_MODEL_PROJECT_PROFILE;

  const effortsInput: Record<string, string> = {};
  if (process.env.SHADOW_EFFORT_ANALYZE) effortsInput.analyze = process.env.SHADOW_EFFORT_ANALYZE;
  if (process.env.SHADOW_EFFORT_SUGGEST) effortsInput.suggest = process.env.SHADOW_EFFORT_SUGGEST;
  if (process.env.SHADOW_EFFORT_CONSOLIDATE) effortsInput.consolidate = process.env.SHADOW_EFFORT_CONSOLIDATE;
  if (process.env.SHADOW_EFFORT_RUNNER) effortsInput.runner = process.env.SHADOW_EFFORT_RUNNER;
  if (process.env.SHADOW_EFFORT_SUGGEST_DEEP) effortsInput.suggestDeep = process.env.SHADOW_EFFORT_SUGGEST_DEEP;
  if (process.env.SHADOW_EFFORT_SUGGEST_PROJECT) effortsInput.suggestProject = process.env.SHADOW_EFFORT_SUGGEST_PROJECT;
  if (process.env.SHADOW_EFFORT_PROJECT_PROFILE) effortsInput.projectProfile = process.env.SHADOW_EFFORT_PROJECT_PROFILE;

  const parsed = ConfigSchema.parse({
    env: process.env.SHADOW_ENV,
    dataDir: process.env.SHADOW_DATA_DIR,
    logLevel: process.env.SHADOW_LOG_LEVEL,
    backend: process.env.SHADOW_BACKEND,
    claudeBin: process.env.SHADOW_CLAUDE_BIN,
    claudeExtraPath: process.env.SHADOW_CLAUDE_EXTRA_PATH,
    runnerTimeoutMs: process.env.SHADOW_RUNNER_TIMEOUT_MS,
    heartbeatIntervalMs: process.env.SHADOW_HEARTBEAT_INTERVAL_MS,
    daemonPollIntervalMs: process.env.SHADOW_DAEMON_POLL_INTERVAL_MS,
    proactivityLevel: process.env.SHADOW_PROACTIVITY_LEVEL,
    thoughtsEnabled: process.env.SHADOW_THOUGHTS_ENABLED,
    thoughtIntervalMinMs: process.env.SHADOW_THOUGHT_INTERVAL_MIN_MS,
    thoughtIntervalMaxMs: process.env.SHADOW_THOUGHT_INTERVAL_MAX_MS,
    thoughtDurationMs: process.env.SHADOW_THOUGHT_DURATION_MS,
    models: Object.keys(modelsInput).length > 0 ? modelsInput : undefined,
    efforts: Object.keys(effortsInput).length > 0 ? effortsInput : undefined,
    locale: process.env.SHADOW_LOCALE,
    watcherEnabled: process.env.SHADOW_WATCHER_ENABLED,
    watcherDebounceMs: process.env.SHADOW_WATCHER_DEBOUNCE_MS,
    watcherMaxWindowMs: process.env.SHADOW_WATCHER_MAX_WINDOW_MS,
    activityHeartbeatMinIntervalMs: process.env.SHADOW_ACTIVITY_HEARTBEAT_MIN_INTERVAL_MS,
    activityHeartbeatMaxIntervalMs: process.env.SHADOW_ACTIVITY_HEARTBEAT_MAX_INTERVAL_MS,
    activityTriggerThreshold: process.env.SHADOW_ACTIVITY_TRIGGER_THRESHOLD,
    webBindHost: process.env.SHADOW_WEB_BIND_HOST,
    maxConcurrentRuns: process.env.SHADOW_MAX_CONCURRENT_RUNS,
    maxConcurrentJobs: process.env.SHADOW_MAX_CONCURRENT_JOBS,
    maxWatchedRepos: process.env.SHADOW_MAX_WATCHED_REPOS,
    remoteSyncEnabled: process.env.SHADOW_REMOTE_SYNC_ENABLED,
    remoteSyncIntervalMs: process.env.SHADOW_REMOTE_SYNC_INTERVAL_MS,
    remoteSyncBatchSize: process.env.SHADOW_REMOTE_SYNC_BATCH_SIZE,
    enrichmentEnabled: process.env.SHADOW_ENRICHMENT_ENABLED,
    enrichmentIntervalMs: process.env.SHADOW_ENRICHMENT_INTERVAL_MS,
    repoProfileEnabled: process.env.SHADOW_REPO_PROFILE_ENABLED,
    repoProfileIntervalMs: process.env.SHADOW_REPO_PROFILE_INTERVAL_MS,
    repoProfileBatchSize: process.env.SHADOW_REPO_PROFILE_BATCH_SIZE,
    suggestIntervalMs: process.env.SHADOW_SUGGEST_INTERVAL_MS,
    suggestReactiveThreshold: process.env.SHADOW_SUGGEST_REACTIVE_THRESHOLD,
    suggestReactiveMinGapMs: process.env.SHADOW_SUGGEST_REACTIVE_MIN_GAP_MS,
    suggestDeepMinCommits: process.env.SHADOW_SUGGEST_DEEP_MIN_COMMITS,
    suggestDeepActiveIntervalDays: process.env.SHADOW_SUGGEST_DEEP_ACTIVE_INTERVAL_DAYS,
    suggestDeepDormantIntervalDays: process.env.SHADOW_SUGGEST_DEEP_DORMANT_INTERVAL_DAYS,
    suggestDeepDormantThresholdDays: process.env.SHADOW_SUGGEST_DEEP_DORMANT_THRESHOLD_DAYS,
    suggestProjectMinGapDays: process.env.SHADOW_SUGGEST_PROJECT_MIN_GAP_DAYS,
    projectProfileMinGapMs: process.env.SHADOW_PROJECT_PROFILE_MIN_GAP_MS,
  });

  const resolvedDataDir = resolveDataDir(parsed.dataDir);
  const resolvedDatabasePath = resolve(resolvedDataDir, 'shadow.db');
  const resolvedArtifactsDir = resolve(resolvedDataDir, 'artifacts');

  mkdirSync(resolvedDataDir, { recursive: true });
  mkdirSync(resolvedArtifactsDir, { recursive: true });

  return {
    ...parsed,
    dataDir: parsed.dataDir ?? '~/.shadow',
    resolvedDataDir,
    resolvedDatabasePath,
    resolvedArtifactsDir,
  };
}

function resolveDataDir(dataDir: string | undefined): string {
  if (!dataDir) {
    return resolve(homedir(), '.shadow');
  }

  if (dataDir === '~' || dataDir.startsWith('~/')) {
    return resolve(homedir(), dataDir.slice(2));
  }

  if (isAbsolute(dataDir)) {
    return resolve(dataDir);
  }

  return resolve(process.cwd(), dataDir);
}
