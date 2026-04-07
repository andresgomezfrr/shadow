import type { Command } from 'commander';
import type { ShadowConfig } from '../config/load-config.js';
import type { WithDb } from './types.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { printOutput } from './output.js';
import { selectAdapter } from '../backend/index.js';

export function registerProfileCommands(program: Command, config: ShadowConfig, withDb: WithDb): void {
  // --- status ---

  program
    .command('status')
    .description('show current shadow state summary')
    .action(async () =>
      withDb(async (db) => {
        const profile = db.ensureProfile();
        const repos = db.listRepos();
        const systems = db.listSystems();
        const contacts = db.listContacts();
        const pendingSuggestions = db.countPendingSuggestions();
        const pendingEvents = db.listPendingEvents().length;
        const lastHeartbeat = db.getLastJob('heartbeat');
        const recentInteractions = db.listRecentInteractions(5);
        const usage = db.getUsageSummary('day');

        // Daemon state
        let daemonRunning = false;
        let daemonState: Record<string, unknown> = {};
        try {
          const { isDaemonRunning, getDaemonState } = await import('../daemon/runtime.js');
          daemonRunning = isDaemonRunning(config);
          daemonState = getDaemonState(config) as unknown as Record<string, unknown>;
        } catch { /* daemon module not available */ }

        // Recent activity from interactions.jsonl
        let recentActivity = 0;
        const interactionsPath = resolve(config.resolvedDataDir, 'interactions.jsonl');
        try {
          const lines = readFileSync(interactionsPath, 'utf8').trim().split('\n').filter(Boolean);
          const fiveMinAgo = Date.now() - 5 * 60 * 1000;
          recentActivity = lines.filter(line => {
            try {
              const entry = JSON.parse(line) as { ts: string };
              return new Date(entry.ts).getTime() > fiveMinAgo;
            } catch { return false; }
          }).length;
        } catch { /* no interactions file */ }

        // Active project from daemon detection
        const activeProject = (daemonState.activeProjects as Array<{ projectName: string }> | undefined)?.[0]?.projectName ?? null;

        return {
          trustLevel: profile.trustLevel,
          trustScore: profile.trustScore,
          proactivityLevel: profile.proactivityLevel,
          personalityLevel: profile.personalityLevel,
          focusMode: profile.focusMode,
          focusUntil: profile.focusUntil,
          bondLevel: profile.bondLevel,
          totalInteractions: profile.totalInteractions,
          repos: repos.length,
          systems: systems.length,
          contacts: contacts.length,
          pendingSuggestions,
          pendingEvents,
          lastHeartbeat: lastHeartbeat
            ? { phase: lastHeartbeat.phase, at: lastHeartbeat.startedAt }
            : null,
          recentInteractions: recentInteractions.length,
          todayTokens: usage.totalInputTokens + usage.totalOutputTokens,
          todayLlmCalls: usage.totalCalls,
          daemon: {
            running: daemonRunning,
            lastHeartbeatPhase: daemonState.lastHeartbeatPhase ?? null,
            nextHeartbeatAt: daemonState.nextHeartbeatAt ?? null,
          },
          recentActivity,
          moodHint: profile.moodHint ?? 'neutral',
          energyLevel: profile.energyLevel ?? 'normal',
          thought: (daemonState.thought as string) ?? null,
          thoughtExpiresAt: (daemonState.thoughtExpiresAt as string) ?? null,
          activeProject,
        };
      }),
    );

  // --- doctor ---

  program
    .command('doctor')
    .description('check local environment')
    .action(async () => {
      const nodeVersion = process.version;
      const platform = process.platform;

      const adapter = selectAdapter(config);
      const doctorResult = await adapter.doctor();

      printOutput(
        {
          ok: true,
          node: nodeVersion,
          platform,
          dataDir: config.resolvedDataDir,
          databasePath: config.resolvedDatabasePath,
          backend: {
            configured: config.backend,
            ...doctorResult,
          },
          proactivityLevel: config.proactivityLevel,
          personalityLevel: config.personalityLevel,
          models: config.models,
          heartbeatIntervalMs: config.heartbeatIntervalMs,
          daemonPollIntervalMs: config.daemonPollIntervalMs,
          locale: config.locale,
        },
        Boolean(program.opts().json),
      );
    });

  // --- profile ---

  const profile = program.command('profile').description('manage user profile');

  profile
    .command('show')
    .description('show current user profile')
    .action(() => withDb((db) => db.ensureProfile()));

  profile
    .command('trust')
    .description('show trust level and score')
    .action(() =>
      withDb((db) => {
        const p = db.ensureProfile();
        return {
          trustLevel: p.trustLevel,
          trustScore: p.trustScore,
          bondLevel: p.bondLevel,
          totalInteractions: p.totalInteractions,
        };
      }),
    );

  profile
    .command('set <key> <value>')
    .description('set a profile field (e.g., proactivityLevel, personalityLevel, timezone)')
    .action((key: string, value: string) =>
      withDb((db) => {
        const numericFields = ['proactivityLevel', 'personalityLevel', 'trustLevel', 'trustScore', 'bondLevel'];
        const parsedValue = numericFields.includes(key) ? Number(value) : value;
        db.updateProfile('default', { [key]: parsedValue });
        return { ok: true, set: key, value: parsedValue };
      }),
    );

  // --- focus / available ---

  program
    .command('focus [duration]')
    .description('enter focus mode (proactivity → 1). Optional duration: "2h", "30m"')
    .action((duration?: string) =>
      withDb((db) => {
        const profile = db.ensureProfile();
        let focusUntil: string | null = null;

        if (duration) {
          const match = duration.match(/^(\d+)\s*(h|m|min|hour|hours|minutes?)$/i);
          if (match) {
            const amount = parseInt(match[1], 10);
            const unit = match[2].toLowerCase();
            const ms = unit.startsWith('h') ? amount * 60 * 60 * 1000 : amount * 60 * 1000;
            focusUntil = new Date(Date.now() + ms).toISOString();
          }
        }

        db.updateProfile('default', {
          focusMode: 'focus',
          focusUntil: focusUntil,
        });

        return {
          ok: true,
          mode: 'focus',
          previousProactivity: profile.proactivityLevel,
          until: focusUntil ?? 'indefinite (use `shadow available` to exit)',
        };
      }),
    );

  program
    .command('available')
    .description('exit focus mode, restore previous proactivity level')
    .action(() =>
      withDb((db) => {
        db.updateProfile('default', {
          focusMode: null,
          focusUntil: null,
        });
        const profile = db.ensureProfile();
        return {
          ok: true,
          mode: 'available',
          proactivityLevel: profile.proactivityLevel,
        };
      }),
    );
}
