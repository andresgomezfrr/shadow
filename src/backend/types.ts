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
  allowedTools?: string[];       // extra tools beyond mcp__shadow__*. undefined = default MCP, [] = no tools at all
  permissionMode?: 'plan' | 'acceptEdits' | 'bypassPermissions';
  timeoutMs?: number;
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
