import type { Command } from 'commander';
import type { ShadowConfig } from '../config/load-config.js';
import type { WithDb } from './types.js';

// `shadow workspace` — git-status global multi-repo + work pendiente (runs awaiting_pr,
// plans activos, observations HIGH, daemon alerts). Reusa la misma función pura que
// alimenta el MCP tool `shadow_workspace_status`.
export function registerWorkspaceCommand(program: Command, config: ShadowConfig, withDb: WithDb): void {
  program
    .command('workspace')
    .description('show a global git-status across all repos + pending Shadow work (runs, plans, observations, alerts)')
    .option('--timeout <ms>', 'per-repo git status timeout in ms (default 1000)', (v) => parseInt(v, 10))
    .action(async (options: { timeout?: number }) =>
      withDb(async (db) => {
        const { buildWorkspaceStatus } = await import('../mcp/tools/workspace.js');
        // Construimos un ToolContext mínimo — workspace solo necesita db y config.
        const ctx = {
          db,
          config,
          getTrustLevel: () => db.getProfile('default')?.bondTier ?? 0,
          deriveMood: () => 'neutral',
          deriveGreeting: () => 'continuing_session',
          trustNames: {},
        };
        return buildWorkspaceStatus(ctx, options.timeout ?? 1000);
      }),
    );
}
