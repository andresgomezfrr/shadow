import { spawn, execFileSync } from 'node:child_process';
import { AsyncLocalStorage } from 'node:async_hooks';

import type { ShadowConfig } from '../config/load-config.js';
import type { BackendAdapter, BackendDoctorResult, BackendExecutionResult, ObjectivePack } from './types.js';

// Instance registry for concurrent adapter tracking
const adapterInstances = new Set<ClaudeCliAdapter>();

// Per-job adapter tracking via AsyncLocalStorage (safe for parallel execution)
const jobIdStorage = new AsyncLocalStorage<string>();
const jobAdapterGroups = new Map<string, Set<ClaudeCliAdapter>>();

/** Run a function within a job scope — any adapters created inside will be tracked for that jobId */
export function runInJobScope<T>(jobId: string, fn: () => T): T {
  return jobIdStorage.run(jobId, fn);
}

/** Kill all adapters associated with a specific job (used on job timeout) */
export function killJobAdapters(jobId: string): void {
  const group = jobAdapterGroups.get(jobId);
  if (group) {
    for (const adapter of group) adapter.kill();
    jobAdapterGroups.delete(jobId);
  }
}

/** @deprecated Use killJobAdapters(jobId) or killAllActiveChildren() instead */
export function killActiveChild(): void {
  killAllActiveChildren();
}

export function killAllActiveChildren(): void {
  for (const adapter of adapterInstances) {
    adapter.kill();
  }
}

export class ClaudeCliAdapter implements BackendAdapter {
  readonly kind = 'cli';
  private instanceChild: import('node:child_process').ChildProcess | null = null;

  constructor(private readonly config: ShadowConfig) {
    adapterInstances.add(this);
    // Auto-register with job group if running inside a job scope
    const jobId = jobIdStorage.getStore();
    if (jobId) {
      if (!jobAdapterGroups.has(jobId)) jobAdapterGroups.set(jobId, new Set());
      jobAdapterGroups.get(jobId)!.add(this);
    }
  }

  kill(): void {
    if (this.instanceChild && !this.instanceChild.killed) {
      this.instanceChild.kill('SIGTERM');
      // SIGKILL fallback if SIGTERM is ignored
      const child = this.instanceChild;
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 5_000);
      this.instanceChild = null;
    }
    adapterInstances.delete(this);
    for (const group of jobAdapterGroups.values()) {
      group.delete(this);
    }
  }

  dispose(): void {
    this.kill();
  }

  async execute(pack: ObjectivePack): Promise<BackendExecutionResult> {
    const startedAt = new Date().toISOString();
    const timeoutMs = pack.timeoutMs ?? this.config.runnerTimeoutMs;

    const args = ['--print', '--output-format', 'json'];

    // System prompt: string = override, null = no override (Claude uses default + MCP), undefined = JSON-only
    if (pack.systemPrompt === null) {
      // Don't pass --system-prompt — Claude uses default behavior with MCP tools
    } else if (typeof pack.systemPrompt === 'string') {
      args.push('--system-prompt', pack.systemPrompt);
    } else {
      // Default: JSON-only engine for heartbeat/suggest jobs
      args.push('--system-prompt', 'You are a JSON-only analysis engine for the Shadow engineering companion. Output raw JSON only. Never wrap in markdown fences. Never add explanations before or after the JSON.');
    }

    // appendSystemPrompt stacks on top of Claude's default (or the explicit
    // --system-prompt above). Runner uses this for the soul/persona so it
    // lives in system context instead of polluting the user briefing.
    // Audit P-12.
    if (typeof pack.appendSystemPrompt === 'string' && pack.appendSystemPrompt.length > 0) {
      args.push('--append-system-prompt', pack.appendSystemPrompt);
    }

    if (pack.model) {
      args.push('--model', pack.model);
    }
    if (pack.effort) {
      args.push('--effort', pack.effort);
    }
    if (pack.permissionMode) {
      args.push('--permission-mode', pack.permissionMode);
    }

    // Tool access: undefined = default (shadow MCP only), [] = no tools, [...] = explicit list
    if (!pack.allowedTools || pack.allowedTools.length > 0) {
      const tools = pack.allowedTools ?? ['mcp__shadow__*'];
      args.push('--allowedTools', tools.join(','));
    }

    // Explicit deny list — deny rules win over allowedTools in Claude CLI.
    // `AskUserQuestion` is ALWAYS denied by default: daemon-spawned Claude has
    // no human to answer questions, so if it tries, the session hangs or errors.
    // Previously only runner applied this guard; suggest/autonomy/reflect/etc.
    // paths leaked the built-in. Caller can override by passing the tool name
    // in `allowedTools` explicitly (it's filtered out before merging here).
    // See audit S-03.
    const denies = new Set<string>(pack.disallowedTools ?? []);
    const callerAllowedAsk = (pack.allowedTools ?? []).some((t) => t === 'AskUserQuestion');
    if (!callerAllowedAsk) denies.add('AskUserQuestion');
    if (denies.size > 0) {
      args.push('--disallowedTools', [...denies].join(','));
    }

    // Prompt via stdin — avoids ARG_MAX limit with large prompts (conversations, memories, etc.)

    const env: Record<string, string | undefined> = { ...process.env, SHADOW_JOB: '1' }; // Mark daemon LLM calls so hooks can skip them
    if (this.config.claudeExtraPath) {
      env.PATH = `${this.config.claudeExtraPath}:${env.PATH ?? ''}`;
    }

    const cwd = pack.repos.length > 0 ? pack.repos[0].path : process.cwd();

    try {
      const { stdout, stderr, exitCode } = await spawnAsync(
        this.config.claudeBin, args, {
          cwd, timeout: timeoutMs, env, stdin: pack.prompt,
          onSpawn: (child) => {
            this.instanceChild = child;
            // Write pidfile so the stale-run detector can probe liveness
            // via process.kill(pid, 0) instead of waiting out the full
            // runnerTimeoutMs when the adapter crashes (audit R-15).
            if (pack.runId && child.pid) {
              void import('../runner/pidfile.js').then(({ writeRunPid }) => {
                writeRunPid(this.config.resolvedDataDir, pack.runId!, child.pid!);
              });
            }
          },
        },
      );
      this.instanceChild = null;
      if (pack.runId) {
        void import('../runner/pidfile.js').then(({ clearRunPid }) => {
          clearRunPid(this.config.resolvedDataDir, pack.runId!);
        });
      }

      const finishedAt = new Date().toISOString();

      if (exitCode === null) {
        return {
          status: 'timeout',
          exitCode: null,
          startedAt,
          finishedAt,
          output: stderr || 'Process timed out',
          summaryHint: null,
        };
      }

      // Parse JSON output from Claude CLI to extract text and token usage
      let outputText = stdout;
      let inputTokens: number | undefined;
      let outputTokens: number | undefined;
      let sessionId: string | undefined;

      try {
        const jsonOutput = JSON.parse(outputText) as {
          result?: string;
          session_id?: string;
          usage?: { input_tokens?: number; output_tokens?: number };
          cost_usd?: number;
          duration_ms?: number;
          num_turns?: number;
        };
        outputText = jsonOutput.result ?? outputText;
        inputTokens = jsonOutput.usage?.input_tokens;
        outputTokens = jsonOutput.usage?.output_tokens;
        sessionId = jsonOutput.session_id;
      } catch {
        // Not JSON — use raw text output (fallback)
      }

      return {
        status: exitCode === 0 ? 'success' : 'failure',
        exitCode,
        startedAt,
        finishedAt,
        output: outputText || stderr,
        summaryHint: null,
        inputTokens,
        outputTokens,
        sessionId,
      };
    } catch (error) {
      if (pack.runId) {
        void import('../runner/pidfile.js').then(({ clearRunPid }) => {
          clearRunPid(this.config.resolvedDataDir, pack.runId!);
        });
      }
      return {
        status: 'failure',
        exitCode: null,
        startedAt,
        finishedAt: new Date().toISOString(),
        output: error instanceof Error ? error.message : String(error),
        summaryHint: null,
      };
    }
  }

  async doctor(): Promise<BackendDoctorResult> {
    try {
      const env = { ...process.env };
      if (this.config.claudeExtraPath) {
        env.PATH = `${this.config.claudeExtraPath}:${env.PATH ?? ''}`;
      }

      const version = execFileSync(this.config.claudeBin, ['--version'], {
        encoding: 'utf8',
        timeout: 5000,
        env,
      }).trim();

      return {
        available: true,
        kind: 'cli',
        details: {
          bin: this.config.claudeBin,
          version,
        },
      };
    } catch {
      return {
        available: false,
        kind: 'cli',
        details: {
          bin: this.config.claudeBin,
          error: 'claude CLI not found or not logged in',
        },
      };
    }
  }
}

// --- Async spawn helper (doesn't block the event loop) ---

function spawnAsync(
  command: string,
  args: string[],
  options: { cwd: string; timeout: number; env: Record<string, string | undefined>; stdin?: string; onSpawn?: (child: import('node:child_process').ChildProcess) => void },
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    options.onSpawn?.(child);

    // Write prompt to stdin if provided
    if (options.stdin) {
      child.stdin.write(options.stdin);
      child.stdin.end();
    } else {
      child.stdin.end();
    }

    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    child.stdout.on('data', (d: Buffer) => chunks.push(d));
    child.stderr.on('data', (d: Buffer) => errChunks.push(d));

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      // SIGKILL fallback if SIGTERM is ignored
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 5_000);
    }, options.timeout);

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        stdout: Buffer.concat(chunks).toString('utf8'),
        stderr: Buffer.concat(errChunks).toString('utf8'),
        exitCode: timedOut ? null : code,
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        stdout: '',
        stderr: err.message,
        exitCode: null,
      });
    });
  });
}
