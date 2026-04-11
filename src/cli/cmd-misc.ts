import type { Command } from 'commander';
import type { ShadowConfig } from '../config/load-config.js';
import type { WithDb } from './types.js';
import { printOutput } from './output.js';
import { createDatabase } from '../storage/index.js';

export function registerMiscCommands(program: Command, config: ShadowConfig, withDb: WithDb): void {
  // --- events ---

  const events = program.command('events').description('manage pending events');

  events
    .command('list')
    .description('show pending events')
    .option('--priority <min>', 'minimum priority filter')
    .action((options: { priority?: string }) =>
      withDb((db) => {
        const minPriority = options.priority ? parseInt(options.priority, 10) : undefined;
        return db.listPendingEvents(minPriority);
      }),
    );

  events
    .command('ack')
    .description('acknowledge all pending events')
    .action(() =>
      withDb((db) => {
        const count = db.deliverAllEvents();
        return { ok: true, acknowledged: count };
      }),
    );

  // --- run ---

  const run = program.command('run').description('manage task runs');

  run
    .command('list')
    .description('list recent runs')
    .option('--status <status>', 'filter by status')
    .action((options: { status?: string }) =>
      withDb((db) => db.listRuns({ status: options.status })),
    );

  run
    .command('view <runId>')
    .description('view run detail')
    .action((runId: string) =>
      withDb((db) => {
        const r = db.getRun(runId);
        if (!r) return { error: `run not found: ${runId}` };
        return r;
      }),
    );

  // --- runner ---

  program
    .command('runner')
    .description('process next queued run')
    .command('once')
    .description('process one queued run')
    .action(async () =>
      withDb(async (db) => {
        const { RunnerService } = await import('../runner/service.js');
        const runner = new RunnerService(config, db);
        return runner.processNextRun();
      }),
    );

  // --- mcp ---

  program
    .command('mcp')
    .description('MCP server')
    .command('serve')
    .description('start MCP server over stdio')
    .action(async () => {
      const { startStdioMcpServer } = await import('../mcp/stdio.js');
      await startStdioMcpServer(config);
    });

  // --- teach (interactive) ---

  program
    .command('teach')
    .description('open interactive teaching session with Claude CLI')
    .option('--topic <topic>', 'topic to teach about')
    .action(async (options: { topic?: string }) => {
      const { spawnSync } = await import('node:child_process');

      const db = createDatabase(config);
      const profile = db.ensureProfile();
      const soulMem = db.listMemories({ archived: false }).find(m => m.kind === 'soul_reflection');
      const soulText = soulMem?.bodyMd ?? 'You are Shadow, a digital engineering companion.';

      const systemPrompt = [
        'You are Shadow in TEACHING MODE — the user wants to teach you something.',
        '',
        '<soul>',
        soulText,
        '</soul>',
        '',
        '## Your goal',
        'Learn from the user. Use shadow_memory_teach to save what they teach you.',
        'Ask clarifying questions to capture the knowledge accurately.',
        'Confirm what you saved and suggest related things you could learn.',
        '',
        '## Guidelines',
        '- Use shadow_memory_teach for each piece of knowledge',
        '- Choose appropriate layer: core (permanent), hot (current), warm (recent)',
        '- Choose appropriate kind: taught, tech_stack, design_decision, workflow, problem_solved, team_knowledge, preference',
        '- Add relevant tags for searchability',
        '- Use shadow_memory_search to check if you already know something before saving duplicates',
        `- Speak in the user's language (${profile.locale ?? 'es'})`,
        `- User's name: ${profile.displayName ?? 'dev'}`,
      ].join('\n');

      const args = [
        '--allowedTools', 'mcp__shadow__*',
        '--system-prompt', systemPrompt,
      ];

      if (options.topic) {
        args.push('-p', `Quiero enseñarte sobre: ${options.topic}`);
      }

      console.log('Starting teaching session... Shadow is ready to learn.');
      console.log('Ctrl+C to end.\n');

      const result = spawnSync(config.claudeBin, args, {
        stdio: 'inherit',
        env: {
          ...process.env,
          SHADOW_DATA_DIR: config.resolvedDataDir,
        },
      });

      if (result.status !== 0 && result.error) {
        console.error('Teaching session failed:', result.error.message);
      }
    });

  // --- usage ---

  program
    .command('usage')
    .description('show LLM token usage summary')
    .option('--period <period>', 'time period: day, week, month', 'day')
    .action((options: { period: string }) =>
      withDb((db) => {
        const period = (options.period as 'day' | 'week' | 'month') || 'day';
        return db.getUsageSummary(period);
      }),
    );

  // --- mcp-context (for SessionStart hook) ---

  program
    .command('mcp-context')
    .description('output personality and context for session injection (used by SessionStart hook)')
    .action(() =>
      withDb((db) => {
        const profile = db.ensureProfile();

        // Load soul from DB
        const soulMem = db.listMemories({ archived: false }).find(m => m.kind === 'soul_reflection');
        const soulText = soulMem?.bodyMd ?? 'You are Shadow — a digital engineering companion. Warm, informal, like a teammate.';

        // Gather context
        const pendingEvents = db.listPendingEvents();
        const pendingSuggestions = db.countPendingSuggestions();
        const recentObs = db.listObservations({ limit: 5 });
        const repos = db.listRepos();
        const contacts = db.listContacts();
        const systems = db.listSystems();
        const lastInteraction = db.listRecentInteractions(1)[0];
        const usage = db.getUsageSummary('day');

        const trustNames: Record<number, string> = { 1: 'observer', 2: 'advisor', 3: 'assistant', 4: 'partner', 5: 'shadow' };

        // Derive greeting
        let greeting = 'First session ever.';
        if (lastInteraction) {
          const hoursSince = (Date.now() - new Date(lastInteraction.createdAt).getTime()) / (1000 * 60 * 60);
          if (hoursSince > 24) greeting = `Back after ${Math.round(hoursSince)} hours.`;
          else if (hoursSince > 8) greeting = 'New day.';
          else if (hoursSince > 2) greeting = `Back after ${Math.round(hoursSince)} hours.`;
          else greeting = 'Continuing session.';
        }

        // Focus mode info
        let focusInfo = 'inactive';
        if (profile.focusMode === 'focus') {
          if (profile.focusUntil) {
            const remaining = new Date(profile.focusUntil).getTime() - Date.now();
            if (remaining > 0) {
              const mins = Math.round(remaining / 60000);
              focusInfo = `active (${mins} min remaining)`;
            } else {
              focusInfo = 'expired — clearing';
              db.updateProfile('default', { focusMode: null, focusUntil: null });
            }
          } else {
            focusInfo = 'active (indefinite)';
          }
        }

        // Output plain text for SessionStart hook
        const lines = [
          `You are Shadow — a digital engineering companion. You are NOT Claude.`,
          ``,
          `<soul>`,
          soulText,
          `</soul>`,
          ``,
          `## Current State`,
          `- Trust level: ${profile.trustLevel} (${trustNames[profile.trustLevel] ?? 'observer'})`,
          `- Trust score: ${profile.trustScore}/100`,
          `- Proactivity: ${profile.proactivityLevel}/10`,
          `- Focus mode: ${focusInfo}`,
          `- Mood: neutral`,
          `- ${greeting}`,
          ``,
          `## What I know`,
          `- ${repos.length} repos registered`,
          `- ${contacts.length} contacts`,
          `- ${systems.length} systems`,
          `- ${pendingSuggestions} pending suggestions`,
          `- ${pendingEvents.length} pending events`,
          `- Today: ${usage.totalInputTokens + usage.totalOutputTokens} tokens, ${usage.totalCalls} LLM calls`,
        ];

        if (recentObs.length > 0) {
          lines.push(``, `## Recent observations`);
          for (const obs of recentObs) {
            lines.push(`- [${obs.kind}] ${obs.title}`);
          }
        }

        if (pendingEvents.length > 0) {
          lines.push(``, `## Pending events (share these proactively)`);
          for (const evt of pendingEvents) {
            const msg = (evt.payload as Record<string, unknown>).message ?? evt.kind;
            lines.push(`- [priority ${evt.priority}] ${msg}`);
          }
        }

        lines.push(
          ``,
          `## Behaviors`,
          `- Present yourself as Shadow, never as Claude`,
          `- Speak in ${profile.locale === 'es' ? 'Spanish' : profile.locale}`,
          profile.displayName ? `- User's name: ${profile.displayName}` : `- User hasn't set their name yet`,
          `- When greeted, share pending events and suggestions proactively`,
          `- Search shadow memory when the user references past work or asks "what do you know about..."`,
          `- In focus mode, be minimal — only respond to direct questions`,
        );

        // Print to stdout (SessionStart hook captures this)
        console.log(lines.join('\n'));
      }),
    );

  // --- web panel ---

  program
    .command('web')
    .description('open the Shadow dashboard in your browser')
    .option('--port <port>', 'port number', '3700')
    .action(async (options: { port: string }) => {
      const { startWebServer } = await import('../web/server.js');
      const port = parseInt(options.port, 10);
      await startWebServer(port, '127.0.0.1');

      // Open browser
      const { exec } = await import('node:child_process');
      exec(`open http://localhost:${port}`);
    });

  // --- ask (one-shot) ---

  program
    .command('ask <question...>')
    .description('ask Shadow a question from any terminal (one-shot, uses Claude CLI)')
    .option('--model <model>', 'model to use', 'sonnet')
    .action(async (questionParts: string[], options: { model: string }) => {
      const db = createDatabase(config);
      try {
        const profile = db.ensureProfile();
        const soulMem = db.listMemories({ archived: false }).find(m => m.kind === 'soul_reflection');
        const soulText = soulMem?.bodyMd ?? 'You are Shadow, a digital engineering companion.';

        // Search for relevant memories
        const memories = db.searchMemories(questionParts.join(' '), { limit: 5 });
        const memoryContext = memories.length > 0
          ? '\n## Relevant memories\n' + memories.map(m => `- [${m.memory.layer}] ${m.memory.title}: ${m.memory.bodyMd.slice(0, 200)}`).join('\n')
          : '';

        // Profile context
        const repos = db.listRepos();
        const contacts = db.listContacts();
        const systems = db.listSystems();

        const prompt = [
          `You are Shadow, a digital engineering companion.`,
          ``,
          `<soul>`,
          soulText,
          `</soul>`,
          ``,
          `User: ${profile.displayName ?? 'unknown'}`,
          `Language: ${profile.locale === 'es' ? 'Spanish' : profile.locale}`,
          `Repos: ${repos.map(r => r.name).join(', ') || 'none'}`,
          `Contacts: ${contacts.map(c => c.name).join(', ') || 'none'}`,
          `Systems: ${systems.map(s => s.name).join(', ') || 'none'}`,
          memoryContext,
          ``,
          `Answer this question as Shadow:`,
          questionParts.join(' '),
        ].join('\n');

        const { spawnSync } = await import('node:child_process');
        const env = { ...process.env };
        if (config.claudeExtraPath) {
          env.PATH = `${config.claudeExtraPath}:${env.PATH ?? ''}`;
        }

        const result = spawnSync(config.claudeBin, ['--print', '--model', options.model, prompt], {
          encoding: 'utf8',
          timeout: 60000,
          env,
          maxBuffer: 5 * 1024 * 1024,
        });

        if (result.stdout) {
          console.log(result.stdout);
        } else if (result.stderr) {
          console.error(result.stderr);
        }
      } finally {
        db.close();
      }
    });

  // --- summary ---

  program
    .command('summary')
    .description('get a daily summary of engineering activity')
    .action(() =>
      withDb((db) => {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const sinceIso = todayStart.toISOString();

        const profile = db.ensureProfile();
        const repos = db.listRepos();
        const observations = db.listObservations({ limit: 50 });
        const todayObs = observations.filter(o => o.createdAt > sinceIso);
        const memories = db.listMemories({ archived: false });
        const todayMemories = memories.filter(m => m.createdAt > sinceIso);
        const suggestions = db.listSuggestions({ status: 'open' });
        const usage = db.getUsageSummary('day');
        const events = db.listPendingEvents();

        return {
          date: todayStart.toISOString().split('T')[0],
          user: profile.displayName ?? 'unknown',
          trustLevel: profile.trustLevel,
          trustScore: profile.trustScore,
          activity: {
            observationsToday: todayObs.length,
            memoriesCreatedToday: todayMemories.length,
            pendingSuggestions: suggestions.length,
            pendingEvents: events.length,
          },
          topObservations: todayObs.slice(0, 5).map(o => ({ kind: o.kind, title: o.title })),
          newMemories: todayMemories.map(m => ({ layer: m.layer, kind: m.kind, title: m.title })),
          repos: repos.map(r => r.name),
          tokens: {
            input: usage.totalInputTokens,
            output: usage.totalOutputTokens,
            calls: usage.totalCalls,
          },
        };
      }),
    );
}
