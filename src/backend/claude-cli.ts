import { execFileSync, spawnSync } from 'node:child_process';

import type { ShadowConfig } from '../config/load-config.js';
import type { BackendAdapter, BackendDoctorResult, BackendExecutionResult, ObjectivePack } from './types.js';

export class ClaudeCliAdapter implements BackendAdapter {
  readonly kind = 'cli';

  constructor(private readonly config: ShadowConfig) {}

  async execute(pack: ObjectivePack): Promise<BackendExecutionResult> {
    const startedAt = new Date().toISOString();
    const timeoutMs = pack.timeoutMs ?? this.config.runnerTimeoutMs;

    const args = ['--print', '--output-format', 'json'];

    if (pack.model) {
      args.push('--model', pack.model);
    }

    args.push(pack.prompt);

    const env = { ...process.env };
    if (this.config.claudeExtraPath) {
      env.PATH = `${this.config.claudeExtraPath}:${env.PATH ?? ''}`;
    }

    const cwd = pack.repos.length > 0 ? pack.repos[0].path : process.cwd();

    try {
      const result = spawnSync(this.config.claudeBin, args, {
        cwd,
        timeout: timeoutMs,
        encoding: 'utf8',
        env,
        maxBuffer: 10 * 1024 * 1024,
      });

      const finishedAt = new Date().toISOString();

      if (result.error) {
        const isTimeout = (result.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
        return {
          status: isTimeout ? 'timeout' : 'failure',
          exitCode: result.status,
          startedAt,
          finishedAt,
          output: result.stderr || result.error.message,
          summaryHint: null,
        };
      }

      // Parse JSON output from Claude CLI to extract text and token usage
      let outputText = result.stdout || '';
      let inputTokens: number | undefined;
      let outputTokens: number | undefined;

      try {
        const jsonOutput = JSON.parse(outputText) as {
          result?: string;
          usage?: { input_tokens?: number; output_tokens?: number };
          cost_usd?: number;
          duration_ms?: number;
          num_turns?: number;
        };
        outputText = jsonOutput.result ?? outputText;
        inputTokens = jsonOutput.usage?.input_tokens;
        outputTokens = jsonOutput.usage?.output_tokens;
      } catch {
        // Not JSON — use raw text output (fallback)
      }

      return {
        status: result.status === 0 ? 'success' : 'failure',
        exitCode: result.status,
        startedAt,
        finishedAt,
        output: outputText,
        summaryHint: null,
        inputTokens,
        outputTokens,
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
