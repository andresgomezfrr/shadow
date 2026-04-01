import type { ShadowConfig } from '../config/load-config.js';
import type { BackendAdapter } from './types.js';
import { ClaudeCliAdapter } from './claude-cli.js';
import { AgentSdkAdapter } from './agent-sdk.js';

export type { BackendAdapter, BackendExecutionResult, BackendDoctorResult, ObjectivePack, RepoPack } from './types.js';

export function selectAdapter(config: ShadowConfig): BackendAdapter {
  if (config.backend === 'api') {
    return new AgentSdkAdapter(config);
  }
  return new ClaudeCliAdapter(config);
}
