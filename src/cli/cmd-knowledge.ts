import type { Command } from 'commander';
import type { ShadowConfig } from '../config/load-config.js';
import type { WithDb } from './types.js';

export function registerKnowledgeCommands(program: Command, _config: ShadowConfig, withDb: WithDb): void {
  // --- observe ---

  program
    .command('observe')
    .description('run observation on all repos (or a specific one)')
    .option('--repo <nameOrId>', 'observe a specific repo by name or id')
    .action(async (options: { repo?: string }) =>
      withDb(async (db) => {
        const { collectRepoContext, collectAllRepoContexts } = await import('../observation/watcher.js');

        if (options.repo) {
          const found = db.findRepoByName(options.repo) ?? db.getRepo(options.repo);
          if (!found) return { error: `repo not found: ${options.repo}` };
          return collectRepoContext(found);
        }

        return collectAllRepoContexts(db);
      }),
    );

  // --- memory ---

  const memory = program.command('memory').description('manage shadow memory');

  memory
    .command('list')
    .description('list memories')
    .option('--layer <layer>', 'filter by layer (core, hot, warm, cool, cold)')
    .option('--scope <scope>', 'filter by scope (personal, repo, team, system, cross-repo)')
    .action((options: { layer?: string; scope?: string }) =>
      withDb((db) =>
        db.listMemories({
          layer: options.layer,
          scope: options.scope,
          archived: false,
        }),
      ),
    );

  memory
    .command('search <query>')
    .description('search memories using full-text search')
    .option('--limit <limit>', 'max results', '10')
    .option('--layer <layer>', 'filter by layer')
    .action((query: string, options: { limit: string; layer?: string }) =>
      withDb((db) =>
        db.searchMemories(query, {
          layer: options.layer,
          limit: parseInt(options.limit, 10),
        }),
      ),
    );

  memory
    .command('teach <title>')
    .description('explicitly teach shadow something')
    .requiredOption('--body <body>', 'memory content (markdown)')
    .option('--scope <scope>', 'memory scope', 'personal')
    .option('--layer <layer>', 'memory layer (core for permanent)', 'hot')
    .option('--repo <repoId>', 'associate with a repo')
    .action((title: string, options: { body: string; scope: string; layer: string; repo?: string }) =>
      withDb((db) =>
        db.createMemory({
          repoId: options.repo ?? null,
          layer: options.layer,
          scope: options.scope,
          kind: 'fact',
          title,
          bodyMd: options.body,
          sourceType: 'teach',
          confidenceScore: 95,
        }),
      ),
    );

  memory
    .command('forget <memoryId>')
    .description('archive a memory')
    .action((memoryId: string) =>
      withDb((db) => {
        const existing = db.getMemory(memoryId);
        if (!existing) {
          return { error: `memory not found: ${memoryId}` };
        }
        db.updateMemory(memoryId, { archivedAt: new Date().toISOString() });
        db.deleteEmbedding('memory_vectors', memoryId);
        return { ok: true, archived: memoryId, title: existing.title };
      }),
    );

  // --- suggest ---

  const suggest = program.command('suggest').description('manage suggestions');

  suggest
    .command('list')
    .description('list pending suggestions')
    .option('--status <status>', 'filter by status', 'open')
    .action((options: { status: string }) =>
      withDb((db) => db.listSuggestions({ status: options.status })),
    );

  suggest
    .command('view <suggestionId>')
    .description('view suggestion detail')
    .action((suggestionId: string) =>
      withDb((db) => {
        const s = db.getSuggestion(suggestionId);
        if (!s) return { error: `suggestion not found: ${suggestionId}` };
        db.updateSuggestion(suggestionId, { shownAt: new Date().toISOString() });
        return s;
      }),
    );

  suggest
    .command('accept <suggestionId>')
    .description('accept a suggestion')
    .action((suggestionId: string) =>
      withDb((db) => {
        const s = db.getSuggestion(suggestionId);
        if (!s) return { error: `suggestion not found: ${suggestionId}` };
        db.updateSuggestion(suggestionId, { status: 'accepted', resolvedAt: new Date().toISOString() });
        return { ok: true, accepted: suggestionId, title: s.title };
      }),
    );

  suggest
    .command('dismiss <suggestionId>')
    .description('dismiss a suggestion')
    .option('--note <note>', 'reason for dismissal')
    .action((suggestionId: string, options: { note?: string }) =>
      withDb((db) => {
        const s = db.getSuggestion(suggestionId);
        if (!s) return { error: `suggestion not found: ${suggestionId}` };
        db.updateSuggestion(suggestionId, {
          status: 'dismissed',
          feedbackNote: options.note ?? null,
          resolvedAt: new Date().toISOString(),
        });
        return { ok: true, dismissed: suggestionId, title: s.title };
      }),
    );

  suggest
    .command('snooze <suggestionId>')
    .description('snooze a suggestion')
    .option('--hours <hours>', 'hours to snooze', '72')
    .action((suggestionId: string, options: { hours: string }) =>
      withDb((db) => {
        const s = db.getSuggestion(suggestionId);
        if (!s) return { error: `suggestion not found: ${suggestionId}` };
        const until = new Date(Date.now() + Number(options.hours) * 3600_000).toISOString();
        db.updateSuggestion(suggestionId, { status: 'snoozed', expiresAt: until });
        return { ok: true, snoozed: suggestionId, until, title: s.title };
      }),
    );

  // --- digest ---

  const digest = program.command('digest').description('generate and view digests (standup, 1:1, brag doc)');

  digest
    .command('daily')
    .description('generate daily standup digest')
    .action(() =>
      withDb(async (db) => {
        const config = (await import('../config/load-config.js')).loadConfig();
        const { activityDailyDigest } = await import('../analysis/digests.js');
        const result = await activityDailyDigest(db, config);
        return result.contentMd;
      }),
    );

  digest
    .command('weekly')
    .description('generate weekly 1:1 digest')
    .action(() =>
      withDb(async (db) => {
        const config = (await import('../config/load-config.js')).loadConfig();
        const { activityWeeklyDigest } = await import('../analysis/digests.js');
        const result = await activityWeeklyDigest(db, config);
        return result.contentMd;
      }),
    );

  digest
    .command('brag')
    .description('generate/update quarterly brag doc')
    .action(() =>
      withDb(async (db) => {
        const config = (await import('../config/load-config.js')).loadConfig();
        const { activityBragDoc } = await import('../analysis/digests.js');
        const result = await activityBragDoc(db, config);
        return result.contentMd;
      }),
    );

  digest
    .command('list')
    .description('list previous digests')
    .option('--kind <kind>', 'filter by kind: daily, weekly, brag')
    .action((options: { kind?: string }) =>
      withDb((db) => db.listDigests({ kind: options.kind })),
    );
}
