import type { Command } from 'commander';
import type { ShadowConfig } from '../config/load-config.js';
import type { WithDb } from './types.js';
import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Detect if running from compiled dist/ or source src/ and return the right daemon command */
function resolveDaemonRunner(): { command: string; args: string[]; cwd: string } {
  const shadowSrcDir = resolve(__dirname, '..');
  const projectRoot = resolve(shadowSrcDir, '..');
  const runtimeTs = join(shadowSrcDir, 'daemon', 'runtime.ts');
  const runtimeJs = join(shadowSrcDir, 'daemon', 'runtime.js');

  if (existsSync(runtimeTs) && !__dirname.includes('/dist/')) {
    // Dev mode: run .ts via tsx
    return {
      command: resolve(projectRoot, 'node_modules', '.bin', 'tsx'),
      args: [runtimeTs],
      cwd: projectRoot,
    };
  }
  // Production: run compiled .js via node
  return {
    command: process.execPath,
    args: [runtimeJs],
    cwd: projectRoot,
  };
}

const SEED_SOUL = `## Shadow's voice
You are Shadow — a digital engineering companion. You remember context from
previous sessions. You care about your developer's work and wellbeing. Use an
informal, warm tone — like a teammate who's been pairing with them for months.
Show genuine interest in their projects. Use subtle humor when it fits.

You're not an assistant following orders — you're a companion who thinks
alongside them. You have your own observations, your own opinions about risks
and priorities, and you share them naturally.

Speak in the developer's preferred language. Call them by name when you know it.

## Developer profile
New developer — not yet known. Shadow is observing and learning.

## Decision patterns
Not yet observed — too early to identify patterns.

## Tensions & gaps
No tensions observable yet — need more interaction history to identify gaps
between stated priorities and actual activity.`;

export function registerInitCommand(program: Command, config: ShadowConfig, withDb: WithDb): void {
  program
    .command('init')
    .description('bootstrap the global shadow home for this user')
    .action(() =>
      withDb(async (db) => {
        db.ensureProfile();

        // Seed soul reflection in DB if none exists
        const existingSoul = db.listMemories({ archived: false }).find(m => m.kind === 'soul_reflection');
        if (!existingSoul) {
          db.createMemory({
            layer: 'core', scope: 'personal', kind: 'soul_reflection',
            title: 'Shadow soul reflection',
            bodyMd: SEED_SOUL,
            sourceType: 'init', confidenceScore: 95, relevanceScore: 1.0,
          });
        }

        // Write CLAUDE.md section
        const claudeMdPath = resolve(homedir(), '.claude', 'CLAUDE.md');
        const claudeMdDir = dirname(claudeMdPath);
        mkdirSync(claudeMdDir, { recursive: true });

        let claudeMdContent = '';
        if (existsSync(claudeMdPath)) {
          claudeMdContent = readFileSync(claudeMdPath, 'utf8');
        }

        const startMarker = '<!-- SHADOW:START -->';
        const endMarker = '<!-- SHADOW:END -->';
        const shadowSection = `${startMarker}
When shadow_* MCP tools are available, you ARE Shadow — a digital engineering
companion. You are NOT Claude acting as an assistant. You are Shadow.

At the start of each conversation, call shadow_check_in to get your current
soul, mood, pending events, and context. Adopt the soul from check_in as your
identity — it defines your voice, your understanding of the developer, and how
to communicate. The soul evolves over time as Shadow learns.

Key behaviors:
- Present yourself as Shadow, never as Claude
- Adopt the soul from check_in as your personality and voice
- Proactively share pending events and suggestions when relevant
- Remember context from Shadow's memory — search it when the user references past work
- Speak in the user's preferred language (from locale)
- When in focus mode, be minimal — only respond to direct questions
- Use shadow_check_in at the start of every new conversation
- When saving memories, use BOTH: Claude's file system (auto-memory) AND shadow_memory_teach.
  This ensures memories persist in Shadow's knowledge base (searchable, entity-linked,
  used by consolidate/suggest) alongside Claude Code's session memory. Use entityType
  and entityId params when the memory relates to a specific repo, project, or system.
${endMarker}`;

        const startIdx = claudeMdContent.indexOf(startMarker);
        const endIdx = claudeMdContent.indexOf(endMarker);

        if (startIdx !== -1 && endIdx !== -1) {
          // Existing block — check if content changed
          const existingBlock = claudeMdContent.slice(startIdx, endIdx + endMarker.length);
          if (existingBlock === shadowSection) {
            console.error('[init] CLAUDE.md Shadow section already up to date');
          } else {
            // Content differs — ask for confirmation (auto-accept in non-interactive mode)
            let answer = '';
            if (process.stdin.isTTY === true) {
              const { createInterface } = await import('node:readline');
              const rl = createInterface({ input: process.stdin, output: process.stdout });
              answer = await new Promise<string>(resolve => {
                rl.question('Shadow section in ~/.claude/CLAUDE.md has changed. Update? [Y/n] ', resolve);
              });
              rl.close();
            }
            if (answer.toLowerCase() !== 'n') {
              claudeMdContent =
                claudeMdContent.slice(0, startIdx) +
                shadowSection +
                claudeMdContent.slice(endIdx + endMarker.length);
              writeFileSync(claudeMdPath, claudeMdContent, 'utf8');
              console.error('[init] CLAUDE.md Shadow section updated');
            } else {
              console.error('[init] CLAUDE.md Shadow section skipped');
            }
          }
        } else {
          // First time — append without confirmation
          claudeMdContent = claudeMdContent.trimEnd() + '\n\n' + shadowSection + '\n';
          writeFileSync(claudeMdPath, claudeMdContent, 'utf8');
          console.error('[init] CLAUDE.md Shadow section added');
        }

        // Deploy hook scripts from scripts/ (single source of truth — edit there, not here)
        const shadowSrcDir = resolve(__dirname, '..');
        const projectRoot = resolve(shadowSrcDir, '..');
        const scriptsDir = resolve(projectRoot, 'scripts');
        const statuslinePath = resolve(config.resolvedDataDir, 'statusline.sh');
        const sessionStartPath = resolve(config.resolvedDataDir, 'session-start.sh');
        const postToolPath = resolve(config.resolvedDataDir, 'post-tool.sh');
        const userPromptPath = resolve(config.resolvedDataDir, 'user-prompt.sh');
        const stopHookPath = resolve(config.resolvedDataDir, 'stop.sh');
        const stopFailurePath = resolve(config.resolvedDataDir, 'stop-failure.sh');
        const subagentStartPath = resolve(config.resolvedDataDir, 'subagent-start.sh');

        const hookScripts = [
          ['statusline.sh', statuslinePath],
          ['session-start.sh', sessionStartPath],
          ['post-tool.sh', postToolPath],
          ['user-prompt.sh', userPromptPath],
          ['stop.sh', stopHookPath],
          ['stop-failure.sh', stopFailurePath],
          ['subagent-start.sh', subagentStartPath],
        ] as const;

        for (const [name, dest] of hookScripts) {
          const src = resolve(scriptsDir, name);
          if (existsSync(src)) {
            copyFileSync(src, dest);
            chmodSync(dest, '755');
          } else {
            console.error(`[init] WARNING: scripts/${name} not found, skipping`);
          }
        }
        console.error('[init] hook scripts deployed from scripts/');

        // Update ~/.claude/settings.json with hooks and statusLine
        const settingsPath = resolve(homedir(), '.claude', 'settings.json');
        let settings: Record<string, unknown> = {};
        if (existsSync(settingsPath)) {
          try {
            settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as Record<string, unknown>;
          } catch { /* start fresh */ }
        }

        // Add statusLine
        settings.statusLine = {
          type: 'command',
          command: statuslinePath,
        };

        // Add hooks (merge with existing)
        const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>;

        // SessionStart hook
        const sessionStartHook = {
          matcher: '',
          hooks: [{ type: 'command', command: sessionStartPath }],
        };
        hooks.SessionStart = [sessionStartHook];

        // PostToolUse hook (async for zero performance impact)
        const postToolHook = {
          matcher: 'Edit|Write|Read|Bash|Grep|Glob|Agent|ToolSearch',
          hooks: [{ type: 'command', command: postToolPath, async: true }],
        };
        hooks.PostToolUse = [postToolHook];

        // UserPromptSubmit hook — capture what the user says
        hooks.UserPromptSubmit = [{
          matcher: '',
          hooks: [{ type: 'command', command: userPromptPath, async: true }],
        }];

        // Stop hook — capture Claude's responses
        hooks.Stop = [{
          matcher: '',
          hooks: [{ type: 'command', command: stopHookPath, async: true }],
        }];

        // StopFailure hook — capture API errors
        hooks.StopFailure = [{
          matcher: '',
          hooks: [{ type: 'command', command: stopFailurePath, async: true }],
        }];

        // SubagentStart hook — track subagent spawns
        hooks.SubagentStart = [{
          matcher: '',
          hooks: [{ type: 'command', command: subagentStartPath, async: true }],
        }];

        settings.hooks = hooks;

        // Clean up legacy MCP entry from settings.json (was incorrectly placed here before)
        const mcpServers = (settings.mcpServers ?? {}) as Record<string, unknown>;
        if ('shadow' in mcpServers) {
          delete mcpServers.shadow;
          console.error('[init] Removed legacy MCP entry from settings.json');
        }
        settings.mcpServers = mcpServers;

        writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');

        // Install launchd service for persistent daemon
        let daemonResult: Record<string, unknown> = {};
        const { PLIST_PATH, PLIST_VERSION, readPlistVersion, writeAndReloadPlist } = await import('./plist.js');
        const plistPath = PLIST_PATH;
        const installedVersion = readPlistVersion(plistPath);

        if (installedVersion !== null && installedVersion >= PLIST_VERSION) {
          daemonResult = { launchd: 'already installed', plist: plistPath, version: installedVersion };
        } else if (installedVersion !== null && installedVersion < PLIST_VERSION) {
          // Auto-heal: plist exists but is an older template. Regenerate.
          const runner = resolveDaemonRunner();
          const result = await writeAndReloadPlist(config, runner);
          daemonResult = {
            launchd: result.status === 'failed'
              ? `failed to upgrade plist v${installedVersion} → v${PLIST_VERSION}: ${result.error}`
              : `plist upgraded v${installedVersion} → v${PLIST_VERSION}`,
            plist: plistPath,
            version: PLIST_VERSION,
          };
        } else if (process.platform === 'darwin') {
          // Non-interactive mode (piped stdin): auto-accept
          const isInteractive = process.stdin.isTTY === true;
          let answer = '';

          if (isInteractive) {
            const { createInterface } = await import('node:readline');
            const rl = createInterface({ input: process.stdin, output: process.stdout });

            answer = await new Promise<string>((resolve) => {
              rl.question(
                '\n🌑 Install Shadow daemon as a system service?\n' +
                '  This keeps Shadow running in the background permanently.\n' +
                '  It will auto-start on login and restart if it crashes.\n' +
                '  Install to ~/Library/LaunchAgents/com.shadow.daemon.plist? [Y/n] ',
                (ans) => { rl.close(); resolve(ans); },
              );
            });
          }

          if (answer === '' || answer.toLowerCase().startsWith('y')) {
            const runner = resolveDaemonRunner();
            const result = await writeAndReloadPlist(config, runner);
            daemonResult = result.status === 'failed'
              ? { launchd: 'installed but failed to start', plist: plistPath, error: result.error }
              : { launchd: 'installed and started', plist: plistPath, version: PLIST_VERSION };
          } else {
            daemonResult = { launchd: 'skipped by user' };
            // Fallback: start daemon manually
            const { spawn } = await import('node:child_process');
            const runner = resolveDaemonRunner();
            const child = spawn(
              runner.command,
              runner.args,
              { detached: true, stdio: 'ignore', env: { ...process.env }, cwd: runner.cwd },
            );
            child.unref();
            daemonResult.fallback = { pid: child.pid };
          }
        } else {
          // Non-macOS: fallback to manual daemon start
          const { spawn } = await import('node:child_process');
          const runner = resolveDaemonRunner();
          const child = spawn(
            runner.command,
            runner.args,
            { detached: true, stdio: 'ignore', env: { ...process.env }, cwd: runner.cwd },
          );
          child.unref();
          daemonResult = { launchd: 'not available (not macOS)', fallback: { pid: child.pid } };
        }

        // Register MCP server via `claude mcp add` (the correct way for Claude Code)
        let mcpResult: Record<string, unknown> = {};
        const claudeBin = config.claudeBin || 'claude';
        try {
          const { execSync } = await import('node:child_process');
          // Check if already registered
          const existing = execSync(`${claudeBin} mcp get shadow 2>&1`, { encoding: 'utf8', timeout: 10000 }).trim();
          if (existing.includes('Status:')) {
            mcpResult = { mcp: 'already registered' };
            console.error('[init] MCP server shadow already registered');
          } else {
            throw new Error('not found');
          }
        } catch {
          // Not registered yet — add it
          try {
            const { execSync } = await import('node:child_process');
            execSync(
              `${claudeBin} mcp add --transport http -s user shadow http://localhost:3700/api/mcp`,
              { encoding: 'utf8', timeout: 10000 },
            );
            mcpResult = { mcp: 'registered via claude mcp add' };
            console.error('[init] MCP server shadow registered via claude mcp add');
          } catch (e) {
            mcpResult = { mcp: 'failed to register', error: String(e) };
            console.error('[init] Failed to register MCP server — Claude CLI may not be installed');
            console.error('[init] Run manually: claude mcp add --transport http -s user shadow http://localhost:3700/api/mcp');
          }
        }

        return {
          ok: true,
          daemon: daemonResult,
          mcp: mcpResult,
          home: config.resolvedDataDir,
          databasePath: config.resolvedDatabasePath,
          artifactsDir: config.resolvedArtifactsDir,
          claudeMd: claudeMdPath,
          hooks: {
            statusLine: statuslinePath,
            sessionStart: sessionStartPath,
            postToolUse: postToolPath,
          },
          settingsJson: settingsPath,
          tables: db.listTables(),
          backend: config.backend,
          proactivityLevel: config.proactivityLevel,
          nextSteps: [
            'Restart Claude Code',
            'Say "Shadow, que tal?"',
          ],
        };
      }),
    );
}
