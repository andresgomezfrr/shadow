import type { Command } from 'commander';
import type { ShadowConfig } from '../config/load-config.js';
import type { WithDb } from './types.js';
import type { CheckInData } from '../mcp/tools/status.js';

// `shadow context` — snapshot rico del estado del compañero para uso terminal.
// Reusa la pure function buildCheckInData() del MCP tool sin disparar el bond
// delta (CLI uso ad-hoc, no debe alterar el bond).
export function registerContextCommand(program: Command, config: ShadowConfig, withDb: WithDb): void {
  program
    .command('context')
    .description('snapshot of Shadow context: mood, focus, alerts, observations, plans')
    .option('--repo <path>', 'scope context to a specific repo path')
    .option('--json', 'machine-readable JSON output (default: human)')
    .action(async (options: { repo?: string; json?: boolean }) =>
      withDb(async (db) => {
        const { buildCheckInData } = await import('../mcp/tools/status.js');
        const { createDerivers } = await import('../mcp/server.js');
        const derivers = createDerivers(db);
        const data = await buildCheckInData({
          db,
          config,
          repoPath: options.repo,
          deriveMood: derivers.deriveMood,
          deriveGreeting: derivers.deriveGreeting,
          trustNames: derivers.trustNames,
        });
        if (options.json) return data;
        process.stdout.write(renderContext(data));
        return undefined as unknown;
      }),
    );
}

function renderContext(d: CheckInData): string {
  const lines: string[] = [];
  lines.push('--- Shadow context ---');
  lines.push(`identity:    ${d.displayName ?? '(no name)'} | locale=${d.locale}`);
  lines.push(`bond:        tier ${d.bondTier} ${d.bondTierName} | proactivity ${d.proactivityLevel}/10`);
  const axes = d.bondAxes;
  lines.push(`bond axes:   time=${axes.time} depth=${axes.depth} momentum=${axes.momentum} alignment=${axes.alignment} autonomy=${axes.autonomy}`);
  lines.push(`mood:        ${d.mood} | greeting: ${d.greeting}`);
  if (d.focusMode) lines.push(`focus mode:  ${d.focusMode}${d.focusUntil ? ` (until ${d.focusUntil})` : ''}`);
  lines.push(`today usage: ${d.todayLlmCalls} llm calls, ${d.todayTokens} tokens`);

  if (d.contextEntities?.repo) {
    lines.push('');
    lines.push(`context repo:     ${d.contextEntities.repo.name}`);
    if (d.contextEntities.projects.length > 0) {
      lines.push(`context projects: ${d.contextEntities.projects.map(p => p.name).join(', ')}`);
    }
    if (d.contextEntities.systems.length > 0) {
      lines.push(`context systems:  ${d.contextEntities.systems.map(s => `${s.name} (${s.kind})`).join(', ')}`);
    }
  }

  if (d.activeAlerts.length > 0) {
    lines.push('');
    lines.push(`active alerts (${d.activeAlerts.length}):`);
    for (const a of d.activeAlerts) lines.push(`  [${a.severity}] ${a.id}: ${a.message}`);
  }

  if (d.pendingEvents.length > 0) {
    lines.push('');
    lines.push(`pending events (${d.pendingEvents.length}):`);
    for (const e of d.pendingEvents.slice(0, 5)) lines.push(`  [${e.priority}] ${e.kind}: ${e.message}`);
  }

  if (d.recentObservations.length > 0) {
    lines.push('');
    lines.push(`recent observations:`);
    for (const o of d.recentObservations) lines.push(`  [${o.severity}] ${o.kind} (${o.votes}v): ${o.title}`);
  }

  lines.push('');
  lines.push(`pending suggestions: ${d.pendingSuggestions}`);

  if (d.contextKnowledge.length > 0) {
    lines.push('');
    lines.push('context knowledge:');
    for (const k of d.contextKnowledge.slice(0, 5)) lines.push(`  [${k.kind}] ${k.title}`);
  }

  if (d.updateAvailable) {
    lines.push('');
    lines.push(`update available: ${d.updateAvailable.current} → ${d.updateAvailable.latest}`);
  }

  if (d.soul) {
    lines.push('');
    lines.push('--- soul snippet ---');
    lines.push(d.soul.slice(0, 500) + (d.soul.length > 500 ? '...' : ''));
  }

  return lines.join('\n') + '\n';
}
