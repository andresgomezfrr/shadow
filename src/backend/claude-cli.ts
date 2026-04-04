import { spawn, execFileSync } from 'node:child_process';

import type { ShadowConfig } from '../config/load-config.js';
import type { BackendAdapter, BackendDoctorResult, BackendExecutionResult, ObjectivePack } from './types.js';

// Instance registry for concurrent adapter tracking
const adapterInstances = new Set<ClaudeCliAdapter>();

// Legacy singleton for backward compat (heartbeat/suggest jobs still use single adapter)
let activeChild: import('node:child_process').ChildProcess | null = null;

export function killActiveChild(): void {
  if (activeChild && !activeChild.killed) {
    activeChild.kill('SIGTERM');
    activeChild = null;
  }
}

export function killAllActiveChildren(): void {
  killActiveChild();
  for (const adapter of adapterInstances) {
    adapter.kill();
  }
}

export class ClaudeCliAdapter implements BackendAdapter {
  readonly kind = 'cli';
  private instanceChild: import('node:child_process').ChildProcess | null = null;

  constructor(private readonly config: ShadowConfig) {
    adapterInstances.add(this);
  }

  kill(): void {
    if (this.instanceChild && !this.instanceChild.killed) {
      this.instanceChild.kill('SIGTERM');
      this.instanceChild = null;
    }
    adapterInstances.delete(this);
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

    if (pack.model) {
      args.push('--model', pack.model);
    }
    if (pack.effort) {
      args.push('--effort', pack.effort);
    }

    // Tool access: undefined = default MCP tools, [] = no tools, [...] = MCP + extras
    if (!pack.allowedTools || pack.allowedTools.length > 0) {
      const tools = ['mcp__shadow__*', ...(pack.allowedTools ?? [])];
      args.push('--allowedTools', tools.join(','));
    }

    // Prompt via stdin — avoids ARG_MAX limit with large prompts (conversations, memories, etc.)

    const env = { ...process.env };
    if (this.config.claudeExtraPath) {
      env.PATH = `${this.config.claudeExtraPath}:${env.PATH ?? ''}`;
    }

    const cwd = pack.repos.length > 0 ? pack.repos[0].path : process.cwd();

    try {
      const { stdout, stderr, exitCode } = await spawnAsync(
        this.config.claudeBin, args, {
          cwd, timeout: timeoutMs, env, stdin: pack.prompt,
          onSpawn: (child) => { activeChild = child; this.instanceChild = child; },
        },
      );
      activeChild = null;
      this.instanceChild = null;

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
