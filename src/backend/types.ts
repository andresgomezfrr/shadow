import type { MemoryRecord } from '../storage/models.js';

// --- Backend adapter interface ---

export interface BackendAdapter {
  readonly kind: string;
  execute(pack: ObjectivePack): Promise<BackendExecutionResult>;
  doctor(): Promise<BackendDoctorResult>;
}

// --- Objective pack (input to a run or LLM call) ---

export type RepoPack = {
  id: string;
  name: string;
  path: string;
};

export type ObjectivePack = {
  runId?: string;
  repos: RepoPack[];
  suggestionId?: string | null;
  title: string;
  goal: string;
  prompt: string;
  relevantMemories: MemoryRecord[];
  artifactDir?: string;
  model?: string;
  effort?: string;
  systemPrompt?: string | null; // string = override, null = no --system-prompt, undefined = JSON-only default
  appendSystemPrompt?: string;   // appended to Claude's default system prompt via --append-system-prompt (stacks with CLAUDE.md)
  allowedTools?: string[];       // extra tools beyond mcp__shadow__*. undefined = default MCP, [] = no tools at all
  disallowedTools?: string[];    // explicit deny list — takes precedence over allowedTools (deny rules win)
  permissionMode?: 'plan' | 'acceptEdits' | 'bypassPermissions';
  timeoutMs?: number;
  /**
   * Optional AbortSignal that, when aborted, kills the spawned child process
   * (SIGTERM with SIGKILL fallback after 5s). Callers running inside a job
   * should pass `ctx.signal` so shutdown/drain cancels in-flight LLM calls
   * cooperatively instead of waiting for them to complete into a closed DB.
   * See audit obs 4af409c6 (R-16 completion).
   */
  signal?: AbortSignal;
};

// --- Execution result ---

export type BackendExecutionResult = {
  status: 'success' | 'failure' | 'timeout' | 'interrupted';
  exitCode: number | null;
  startedAt: string;
  finishedAt: string;
  output: string;
  summaryHint: string | null;
  inputTokens?: number;
  outputTokens?: number;
  sessionId?: string;
};

// --- Doctor result ---

export type BackendDoctorResult = {
  available: boolean;
  kind: string;
  details: Record<string, unknown>;
};
