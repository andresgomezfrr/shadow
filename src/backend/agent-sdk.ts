import type { ShadowConfig } from '../config/load-config.js';
import type { BackendAdapter, BackendDoctorResult, BackendExecutionResult, ObjectivePack } from './types.js';
import { log } from '../log.js';

/**
 * Claude Agent SDK adapter.
 * Uses @anthropic-ai/agent-sdk for programmatic agent control.
 * Requires ANTHROPIC_API_KEY environment variable.
 *
 * The SDK is loaded dynamically to avoid hard dependency.
 * If not installed, doctor() reports unavailable and execute() fails gracefully.
 */
export class AgentSdkAdapter implements BackendAdapter {
  readonly kind = 'api';

  constructor(private readonly config: ShadowConfig) {}

  async execute(pack: ObjectivePack): Promise<BackendExecutionResult> {
    const startedAt = new Date().toISOString();

    try {
      // Dynamic import to avoid hard dependency
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sdk = await (Function('return import("@anthropic-ai/agent-sdk")')() as Promise<any>);

      const modelMap: Record<string, string> = {
        sonnet: 'claude-sonnet-4-6',
        opus: 'claude-opus-4-6',
        haiku: 'claude-haiku-4-5-20251001',
      };
      const model = modelMap[pack.model ?? 'sonnet'] ?? pack.model ?? 'claude-sonnet-4-6';

      // Filter allowedTools to exclude any pattern in disallowedTools.
      // Note: this only denies MCP/custom tools enumerated in allowedTools.
      // Claude built-ins (e.g. AskUserQuestion) are NOT in allowedTools and cannot
      // be hard-denied here — the CLI backend uses --disallowedTools for that.
      let tools = pack.allowedTools ?? [];
      if (pack.disallowedTools?.length) {
        const builtinDenies = pack.disallowedTools.filter((d) => !d.includes('__') && !d.endsWith('*'));
        if (builtinDenies.length > 0) {
          log.error(
            `[agent-sdk] Built-in tools cannot be denied via allowedTools filter (backend=api): ${builtinDenies.join(', ')}`,
          );
        }
        tools = tools.filter((t) => !pack.disallowedTools!.some((d) => matchToolPattern(t, d)));
      }

      const agent = new sdk.Agent({
        model,
        tools,
      });

      const result = await agent.run(pack.prompt, {
        cwd: pack.repos.length > 0 ? pack.repos[0].path : process.cwd(),
        timeout: pack.timeoutMs ?? this.config.runnerTimeoutMs,
      });

      return {
        status: result.exitCode === 0 ? 'success' : 'failure',
        exitCode: result.exitCode,
        startedAt,
        finishedAt: new Date().toISOString(),
        output: result.output ?? '',
        summaryHint: result.summary ?? null,
        inputTokens: result.usage?.inputTokens,
        outputTokens: result.usage?.outputTokens,
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
    const hasApiKey = Boolean(process.env.ANTHROPIC_API_KEY);

    let sdkAvailable = false;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (Function('return import("@anthropic-ai/agent-sdk")')() as Promise<any>);
      sdkAvailable = true;
    } catch {
      // SDK not installed
    }

    return {
      available: hasApiKey && sdkAvailable,
      kind: 'api',
      details: {
        apiKeySet: hasApiKey,
        sdkInstalled: sdkAvailable,
      },
    };
  }
}

/** Matches an MCP tool name against a deny pattern. Supports exact match + trailing wildcard. */
function matchToolPattern(tool: string, pattern: string): boolean {
  if (pattern.endsWith('*')) return tool.startsWith(pattern.slice(0, -1));
  return tool === pattern;
}
