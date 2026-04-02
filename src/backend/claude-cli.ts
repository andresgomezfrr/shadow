import { spawn, execFileSync } from 'node:child_process';

import type { ShadowConfig } from '../config/load-config.js';
import type { BackendAdapter, BackendDoctorResult, BackendExecutionResult, ObjectivePack } from './types.js';

export class ClaudeCliAdapter implements BackendAdapter {
  readonly kind = 'cli';

  constructor(private readonly config: ShadowConfig) {}

  async execute(pack: ObjectivePack): Promise<BackendExecutionResult> {
    const startedAt = new Date().toISOString();
    const timeoutMs = pack.timeoutMs ?? this.config.runnerTimeoutMs;

    const args = ['--print', '--output-format', 'json'];

    // Override system prompt so the model acts as a pure JSON analysis engine
    // Without this, it loads CLAUDE.md/hooks context and may reject the prompt
    args.push('--system-prompt', 'You are a JSON-only analysis engine for the Shadow engineering companion. Output raw JSON only. Never wrap in markdown fences. Never add explanations before or after the JSON.');

    if (pack.model) {
      args.push('--model', pack.model);
    }
    if (pack.effort) {
      args.push('--effort', pack.effort);
    }

    args.push(pack.prompt);

    const env = { ...process.env };
    if (this.config.claudeExtraPath) {
      env.PATH = `${this.config.claudeExtraPath}:${env.PATH ?? ''}`;
    }

    const cwd = pack.repos.length > 0 ? pack.repos[0].path : process.cwd();

    try {
      const { stdout, stderr, exitCode } = await spawnAsync(
        this.config.claudeBin, args, { cwd, timeout: timeoutMs, env },
      );

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
        output: outputText,
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
  options: { cwd: string; timeout: number; env: Record<string, string | undefined> },
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

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
