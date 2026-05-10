import type { Command } from 'commander';
import type { ShadowConfig } from '../config/load-config.js';
import type { WithDb } from './types.js';

// `shadow recap [hours]` — ad-hoc activity summary, stats only by default.
// `--narrate` (placeholder) llamará al LLM en una iteración futura; reusará
// el wiring de analysis/digests.ts para no duplicar.
export function registerRecapCommand(_program: Command, _config: ShadowConfig, withDb: WithDb): void {
  _program
    .command('recap [hours]')
    .description('summarize audit-event activity over the last N hours (default 24)')
    .option('--markdown', 'render as markdown (default JSON)')
    .option('--narrate', 'TODO: include LLM narrative (not yet implemented — placeholder)')
    .action(async (hoursArg: string | undefined, options: { markdown?: boolean; narrate?: boolean }) =>
      withDb(async (db) => {
        const hours = hoursArg ? parseInt(hoursArg, 10) : 24;
        if (!Number.isFinite(hours) || hours <= 0) {
          return { error: `invalid hours: ${hoursArg}` };
        }
        const { buildRecap, renderRecapMarkdown } = await import('../analysis/recap.js');
        const recap = buildRecap(db, hours);
        if (options.narrate) {
          // Conscious gate — flag explícito requerido para LLM call.
          return { ...recap, narrative: '(narrative flag set but LLM hook not yet wired)' };
        }
        if (options.markdown) {
          process.stdout.write(renderRecapMarkdown(recap));
          return undefined as unknown;
        }
        return recap;
      }),
    );
}
