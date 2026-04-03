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

  const effortsInput: Record<string, string> = {};
  if (process.env.SHADOW_EFFORT_ANALYZE) effortsInput.analyze = process.env.SHADOW_EFFORT_ANALYZE;
  if (process.env.SHADOW_EFFORT_SUGGEST) effortsInput.suggest = process.env.SHADOW_EFFORT_SUGGEST;
  if (process.env.SHADOW_EFFORT_CONSOLIDATE) effortsInput.consolidate = process.env.SHADOW_EFFORT_CONSOLIDATE;
  if (process.env.SHADOW_EFFORT_RUNNER) effortsInput.runner = process.env.SHADOW_EFFORT_RUNNER;

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
    personalityLevel: process.env.SHADOW_PERSONALITY_LEVEL,
    thoughtsEnabled: process.env.SHADOW_THOUGHTS_ENABLED,
    thoughtIntervalMinMs: process.env.SHADOW_THOUGHT_INTERVAL_MIN_MS,
    thoughtIntervalMaxMs: process.env.SHADOW_THOUGHT_INTERVAL_MAX_MS,
    thoughtDurationMs: process.env.SHADOW_THOUGHT_DURATION_MS,
    models: Object.keys(modelsInput).length > 0 ? modelsInput : undefined,
    efforts: Object.keys(effortsInput).length > 0 ? effortsInput : undefined,
    locale: process.env.SHADOW_LOCALE,
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
