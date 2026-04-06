import type { ShadowConfig } from '../config/load-config.js';
import type { BackendAdapter, BackendDoctorResult, BackendExecutionResult, ObjectivePack } from './types.js';

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

      const agent = new sdk.Agent({
        model,
        tools: pack.allowedTools ?? [],
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
