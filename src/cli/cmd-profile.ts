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
    .option('--cwd <path>', 'resolve contextRepo against this path (typically the shell cwd)')
    .action(async (opts: { cwd?: string }) =>
      withDb(async (db) => {
        const profile = db.ensureProfile();
        const repos = db.listRepos();
        const systems = db.listSystems();
        const contacts = db.listContacts();
        const pendingSuggestions = db.countPendingSuggestions();
        const pendingEvents = db.listPendingEvents().length;
        const unreadEvents = db.listUnreadEvents();
        const unreadNotifications = unreadEvents.length;
        const topEvent = unreadEvents.find(e => e.priority >= 7);
        // Compute a deep-link target URL for the top notification so the
        // statusline can wrap the line 2 message in an OSC 8 hyperlink.
        // Unknown kinds fall back to /activity.
        function deepLinkFor(kind: string, payload: Record<string, unknown>): string {
          const runId = payload.runId as string | undefined;
          const observationId = payload.observationId as string | undefined;
          const suggestionId = payload.suggestionId as string | undefined;
          switch (kind) {
            case 'run_failed':
            case 'run_completed':
            case 'auto_execute_complete':
              return runId ? `/runs?highlight=${runId}` : '/runs';
            case 'plan_needs_review':
              return runId ? `/workspace?tab=planned&highlight=${runId}` : '/workspace';
            case 'observation_notable':
              return observationId ? `/observations?highlight=${observationId}` : '/observations';
            case 'suggestion_new':
            case 'suggestion_revalidated':
              return suggestionId ? `/suggestions?highlight=${suggestionId}` : '/suggestions';
            case 'version_available':
              return '/guide';
            default:
              return '/activity';
          }
        }
        const topNotification = topEvent
          ? {
              kind: topEvent.kind,
              message: (topEvent.payload as Record<string, unknown>).message as string,
              priority: topEvent.priority,
              targetPath: deepLinkFor(topEvent.kind, topEvent.payload as Record<string, unknown>),
            }
          : null;
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

        // Active project from daemon detection. Exposing the id too so the
        // statusline can deep-link to /projects/<id> without a second round-trip.
        const topActiveProject = (daemonState.activeProjects as Array<{ projectId: string; projectName: string }> | undefined)?.[0];
        const activeProject = topActiveProject?.projectName ?? null;
        const activeProjectId = topActiveProject?.projectId ?? null;

        // Resolve the shell's cwd against the registered repos so the
        // statusline can show "📦 <repo> · <branch>" for the directory the
        // user is actually in. Matching is a longest-prefix so nested paths
        // still resolve to the outer repo.
        let contextRepo: { id: string; name: string; branch: string | null } | null = null;
        if (opts.cwd) {
          const { resolve: pathResolve } = await import('node:path');
          const cwdAbs = pathResolve(opts.cwd);
          const match = repos
            .map(r => ({ r, abs: pathResolve(r.path) }))
            .filter(({ abs }) => cwdAbs === abs || cwdAbs.startsWith(abs + '/'))
            .sort((a, b) => b.abs.length - a.abs.length)[0];
          if (match) {
            let branch: string | null = null;
            try {
              const { execFileSync } = await import('node:child_process');
              branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
                cwd: match.abs,
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore'],
                timeout: 1000,
              }).trim() || null;
            } catch { /* detached HEAD, no git, permissions — ignore */ }
            contextRepo = { id: match.r.id, name: match.r.name, branch };
          }
        }

        return {
          bondTier: profile.bondTier,
          bondAxes: profile.bondAxes,
          bondResetAt: profile.bondResetAt,
          proactivityLevel: profile.proactivityLevel,
          focusMode: profile.focusMode,
          focusUntil: profile.focusUntil,
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
          activeProjectId,
          contextRepo,
          alerts: (daemonState.alerts as Array<{ id: string; message: string; severity: string; since: string }>) ?? [],
          unreadNotifications,
          topNotification,
        };
      }),
    );

  // --- doctor ---

  program
    .command('doctor')
    .description('check local environment')
    .action(async () =>
      withDb(async (db) => {
        const nodeVersion = process.version;
        const platform = process.platform;

        const adapter = selectAdapter(config);
        const doctorResult = await adapter.doctor();

        // Schema drift check (audit obs d0670559). Compares the MAX(version)
        // actually applied in this DB against the LATEST_SCHEMA_VERSION the
        // code was compiled with. Drift means: pull new code but daemon
        // wasn't restarted — next CLI command that touches tables the new
        // migrations added/removed will fail silently with cryptic errors
        // (e.g. "no such column: required_trust_level").
        const { LATEST_SCHEMA_VERSION, getAppliedSchemaVersion } = await import('../storage/migrations.js');
        const appliedVersion = getAppliedSchemaVersion(db.rawDb);
        const schema: Record<string, unknown> = {
          applied: appliedVersion,
          expected: LATEST_SCHEMA_VERSION,
          ok: appliedVersion === LATEST_SCHEMA_VERSION,
        };
        if (appliedVersion < LATEST_SCHEMA_VERSION) {
          schema.drift = LATEST_SCHEMA_VERSION - appliedVersion;
          schema.hint = 'Restart the daemon to apply pending migrations (shadow daemon restart).';
        } else if (appliedVersion > LATEST_SCHEMA_VERSION) {
          schema.drift = appliedVersion - LATEST_SCHEMA_VERSION;
          schema.hint = 'DB was migrated by a newer build — run `git pull && npm install && npm run build` to bring the code up to date.';
        }

        printOutput(
          {
            ok: schema.ok === true,
            node: nodeVersion,
            platform,
            dataDir: config.resolvedDataDir,
            databasePath: config.resolvedDatabasePath,
            schema,
            backend: {
              configured: config.backend,
              ...doctorResult,
            },
            proactivityLevel: config.proactivityLevel,
            models: config.models,
            heartbeatIntervalMs: config.heartbeatIntervalMs,
            daemonPollIntervalMs: config.daemonPollIntervalMs,
            locale: config.locale,
          },
          Boolean(program.opts().json),
        );
      }),
    );

  // --- profile ---

  const profile = program.command('profile').description('manage user profile');

  profile
    .command('show')
    .description('show current user profile')
    .action(() => withDb((db) => db.ensureProfile()));

  profile
    .command('bond')
    .description('show bond tier and axes')
    .action(() =>
      withDb((db) => {
        const p = db.ensureProfile();
        return {
          bondTier: p.bondTier,
          bondAxes: p.bondAxes,
          bondResetAt: p.bondResetAt,
          bondTierLastRiseAt: p.bondTierLastRiseAt,
          totalInteractions: p.totalInteractions,
        };
      }),
    );

  profile
    .command('bond-reset')
    .description('reset bond state to tier 1 (memories/suggestions/runs preserved)')
    .option('--confirm', 'required — this will zero your bond axes and clear chronicle entries')
    .action((opts: { confirm?: boolean }) =>
      withDb(async (db) => {
        if (!opts.confirm) {
          return {
            ok: false,
            error: 'Refusing to run without --confirm. This zeroes bond state.',
          };
        }
        const { resetBondState } = await import('../profile/bond.js');
        resetBondState(db);
        return {
          ok: true,
          message: 'Bond reset to tier 1 (observer). Memories and history preserved.',
        };
      }),
    );

  profile
    .command('set <key> <value>')
    .description('set a profile field (e.g., proactivityLevel, timezone, displayName)')
    .action((key: string, value: string) =>
      withDb((db) => {
        const numericFields = ['proactivityLevel'];
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
