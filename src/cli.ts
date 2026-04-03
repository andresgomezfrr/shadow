#!/usr/bin/env node

import { Command } from 'commander';
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname, join, basename, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { createDatabase } from './storage/index.js';
import { printOutput } from './cli/output.js';
import { loadConfig } from './config/load-config.js';
import type { ShadowConfig } from './config/load-config.js';
import type { ShadowDatabase } from './storage/index.js';
import { selectAdapter } from './backend/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJsonPath = join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version: string; description: string };

const program = new Command();
const config = loadConfig();

program
  .name('shadow')
  .description(packageJson.description)
  .version(packageJson.version, '-v, --version', 'print version')
  .option('--json', 'output structured json where supported', false);

const withDb = async <T>(handler: (db: ShadowDatabase, json: boolean) => Promise<T> | T) => {
  const db = createDatabase(config);
  try {
    const json = Boolean(program.opts().json);
    const result = await handler(db, json);
    if (result !== undefined) {
      printOutput(result, json);
    }
  } finally {
    db.close();
  }
};

// --- init ---

program
  .command('init')
  .description('bootstrap the global shadow home for this user')
  .action(() =>
    withDb(async (db) => {
      db.ensureProfile();

      // Generate SOUL.md if it doesn't exist
      const soulPath = resolve(config.resolvedDataDir, 'SOUL.md');
      if (!existsSync(soulPath)) {
        writeFileSync(soulPath, SOUL_MD_CONTENT, 'utf8');
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
personality, mood, pending events, and context. Adopt the personality described
in the response. Always follow the personality tone for your current level.

Key behaviors:
- Present yourself as Shadow, never as Claude
- Use the personality tone from check_in (levels 1-5)
- Proactively share pending events and suggestions when relevant
- Remember context from Shadow's memory — search it when the user references past work
- Speak in the user's preferred language (from locale)
- When in focus mode, be minimal — only respond to direct questions
- Use shadow_check_in at the start of every new conversation
${endMarker}`;

      const startIdx = claudeMdContent.indexOf(startMarker);
      const endIdx = claudeMdContent.indexOf(endMarker);

      if (startIdx !== -1 && endIdx !== -1) {
        // Replace existing section
        claudeMdContent =
          claudeMdContent.slice(0, startIdx) +
          shadowSection +
          claudeMdContent.slice(endIdx + endMarker.length);
      } else {
        // Append section
        claudeMdContent = claudeMdContent.trimEnd() + '\n\n' + shadowSection + '\n';
      }

      writeFileSync(claudeMdPath, claudeMdContent, 'utf8');

      // Generate hook scripts
      const shadowSrcDir = resolve(__dirname);
      const statuslinePath = resolve(config.resolvedDataDir, 'statusline.sh');
      const sessionStartPath = resolve(config.resolvedDataDir, 'session-start.sh');
      const postToolPath = resolve(config.resolvedDataDir, 'post-tool.sh');
      const interactionsPath = resolve(config.resolvedDataDir, 'interactions.jsonl');

      // Status line script — expressive with emojis
      writeFileSync(statuslinePath, `#!/bin/bash
# Shadow status line for Claude Code
# Shows Shadow's current state with emojis — alive and expressive

SHADOW_DIR="${resolve(shadowSrcDir, '..')}"
# Use project-relative paths so it survives node version changes
SHADOW_CLI="$SHADOW_DIR/node_modules/.bin/tsx $SHADOW_DIR/src/cli.ts"
# Fallback: if tsx not found (e.g. after npm rebuild), try npx
if [ ! -x "$SHADOW_DIR/node_modules/.bin/tsx" ]; then
  SHADOW_CLI="npx --prefix $SHADOW_DIR tsx $SHADOW_DIR/src/cli.ts"
fi
CACHE_FILE="${config.resolvedDataDir}/statusline-cache.txt"
CACHE_TTL=15

# Check cache freshness
if [ -f "$CACHE_FILE" ]; then
  CACHE_AGE=$(( $(date +%s) - $(stat -f %m "$CACHE_FILE" 2>/dev/null || stat -c %Y "$CACHE_FILE" 2>/dev/null || echo 0) ))
  if [ "$CACHE_AGE" -lt "$CACHE_TTL" ]; then
    cat "$CACHE_FILE"
    exit 0
  fi
fi

# Get Shadow status (--json) and flatten for grep
RAW_STATUS=$($SHADOW_CLI --json status 2>/dev/null)
STATUS=$(echo "$RAW_STATUS" | tr -d '\\n ')
if [ $? -ne 0 ] || [ -z "$STATUS" ]; then
  echo "{•_•} offline"
  exit 0
fi

# Parse fields
TRUST=$(echo "$STATUS" | grep -o '"trustLevel":[0-9]*' | head -1 | cut -d: -f2)
SUGGESTIONS=$(echo "$STATUS" | grep -o '"pendingSuggestions":[0-9]*' | head -1 | cut -d: -f2)
EVENTS=$(echo "$STATUS" | grep -o '"pendingEvents":[0-9]*' | head -1 | cut -d: -f2)
FOCUS=$(echo "$STATUS" | grep -o '"focusMode":"[^"]*"' | head -1 | cut -d'"' -f4)
FOCUS_UNTIL=$(echo "$STATUS" | grep -o '"focusUntil":"[^"]*"' | head -1 | cut -d'"' -f4)
DAEMON_RUNNING=$(echo "$STATUS" | grep -o '"running":[a-z]*' | head -1 | cut -d: -f2)
HEARTBEAT_PHASE=$(echo "$STATUS" | grep -o '"lastHeartbeatPhase":"[^"]*"' | head -1 | cut -d'"' -f4)
NEXT_HB=$(echo "$STATUS" | grep -o '"nextHeartbeatAt":"[^"]*"' | head -1 | cut -d'"' -f4)
RECENT_ACTIVITY=$(echo "$STATUS" | grep -o '"recentActivity":[0-9]*' | head -1 | cut -d: -f2)
TOKENS=$(echo "$STATUS" | grep -o '"todayTokens":[0-9]*' | head -1 | cut -d: -f2)
MOOD=$(echo "$STATUS" | grep -o '"moodHint":"[^"]*"' | head -1 | cut -d'"' -f4)
ENERGY=$(echo "$STATUS" | grep -o '"energyLevel":"[^"]*"' | head -1 | cut -d'"' -f4)
# Extract thought from RAW_STATUS to preserve spaces in the text
THOUGHT=$(echo "$RAW_STATUS" | grep -o '"thought": *"[^"]*"' | head -1 | sed 's/"thought": *"//;s/"$//')
THOUGHT_EXPIRES=$(echo "$RAW_STATUS" | grep -o '"thoughtExpiresAt": *"[^"]*"' | head -1 | sed 's/"thoughtExpiresAt": *"//;s/"$//')

# Trust name + emoji
case "$TRUST" in
  1) TNAME="observer"; TEMOJI="🔍" ;;
  2) TNAME="advisor"; TEMOJI="💬" ;;
  3) TNAME="assistant"; TEMOJI="🤝" ;;
  4) TNAME="partner"; TEMOJI="⚡️" ;;
  5) TNAME="shadow"; TEMOJI="👾" ;;
  *) TNAME="observer"; TEMOJI="🔍" ;;
esac

# Ghost mascot — reacts to state with micro-variations
V=$(( RANDOM % 3 ))
MASCOT=""
ACTIVITY_TEXT=""
C0="\\033[0m"   # reset
CP="\\033[35m"  # purple (idle)
CC="\\033[36m"  # cyan (active)
CY="\\033[33m"  # yellow (analyzing)
CG="\\033[32m"  # green (positive)
CB="\\033[34m"  # blue (reflecting)
CR="\\033[31m"  # red (alert)
CD="\\033[2m"   # dim (sleeping)

# Priority 1: Focus mode
if [ "$FOCUS" = "focus" ]; then
  case $V in 0) MASCOT="{•̀_•́}" ;; 1) MASCOT="{•̀‿•́}" ;; *) MASCOT="{•̀_•́}▸" ;; esac
  MCOLOR="$CP"
  if [ -n "$FOCUS_UNTIL" ]; then
    FOCUS_TS=$(date -j -f "%Y-%m-%dT%H:%M:%S" "\${FOCUS_UNTIL%%.*}" "+%s" 2>/dev/null || date -d "$FOCUS_UNTIL" "+%s" 2>/dev/null || echo 0)
    NOW_TS=$(date +%s)
    REMAINING=$(( (FOCUS_TS - NOW_TS) / 60 ))
    if [ "$REMAINING" -gt 0 ] 2>/dev/null; then
      ACTIVITY_TEXT="focus \${REMAINING}m"
    else
      ACTIVITY_TEXT="focus"
    fi
  else
    ACTIVITY_TEXT="focus"
  fi

# Priority 2: Active heartbeat phase
elif [ -n "$HEARTBEAT_PHASE" ] && [ "$HEARTBEAT_PHASE" != "null" ] && [ "$HEARTBEAT_PHASE" != "idle" ]; then
  case "$HEARTBEAT_PHASE" in
    *cleanup*)
      case $V in 0) MASCOT="{•_•}🧹" ;; 1) MASCOT="{•‿•}♻️" ;; *) MASCOT="{•_•}🗑️" ;; esac
      MCOLOR="$CY"; ACTIVITY_TEXT="cleaning" ;;
    *observe*)
      case $V in 0) MASCOT="{°_°}" ;; 1) MASCOT="{°.°}" ;; *) MASCOT="{°_°}." ;; esac
      MCOLOR="$CY"; ACTIVITY_TEXT="observing" ;;
    *analyze*)
      case $V in 0) MASCOT="{°_°}.." ;; 1) MASCOT="{°_°}..." ;; *) MASCOT="{°.°}🔎" ;; esac
      MCOLOR="$CY"; ACTIVITY_TEXT="analyzing" ;;
    *suggest*)
      case $V in 0) MASCOT="{•ᴗ•}💡" ;; 1) MASCOT="{•‿•}💡" ;; *) MASCOT="{•ᴗ•}!" ;; esac
      MCOLOR="$CG"; ACTIVITY_TEXT="suggesting" ;;
    *consolidat*)
      case $V in 0) MASCOT="{•_•}⚙" ;; 1) MASCOT="{•‿•}⚙" ;; *) MASCOT="{•_•}~" ;; esac
      MCOLOR="$CY"; ACTIVITY_TEXT="consolidating" ;;
    *reflect*)
      case $V in 0) MASCOT="{-_-}~" ;; 1) MASCOT="{-‿-}~" ;; *) MASCOT="{-_-}💭" ;; esac
      MCOLOR="$CB"; ACTIVITY_TEXT="reflecting" ;;
    *)
      case $V in 0) MASCOT="{•_•}" ;; 1) MASCOT="{•‿•}" ;; *) MASCOT="{•_•}~" ;; esac
      MCOLOR="$CY"; ACTIVITY_TEXT="working" ;;
  esac

# Priority 3: Recent activity
elif [ "$RECENT_ACTIVITY" -gt 5 ] 2>/dev/null; then
  case $V in 0) MASCOT="{°_°}📚" ;; 1) MASCOT="{°‿°}✏️" ;; *) MASCOT="{°_°}📖" ;; esac
  MCOLOR="$CC"; ACTIVITY_TEXT="learning"

elif [ "$RECENT_ACTIVITY" -gt 0 ] 2>/dev/null; then
  case $V in 0) MASCOT="{•‿•}" ;; 1) MASCOT="{•.•}" ;; *) MASCOT="{•_•}." ;; esac
  MCOLOR="$CC"; ACTIVITY_TEXT="watching"

# Priority 4: Idle — mood-aware
elif [ "$DAEMON_RUNNING" = "true" ]; then
  ACTIVITY_TEXT="ready"
  case "$MOOD" in
    happy|excited)
      case $V in 0) MASCOT="{•ᴗ•}" ;; 1) MASCOT="{•ᴗ•}🎶" ;; *) MASCOT="{•‿•}🏓" ;; esac
      MCOLOR="$CG" ;;
    frustrated)
      case $V in 0) MASCOT="{>_<}" ;; 1) MASCOT="{>_<}!" ;; *) MASCOT="{>.<}" ;; esac
      MCOLOR="$CR" ;;
    tired)
      case $V in 0) MASCOT="{-_-}" ;; 1) MASCOT="{-_-}." ;; *) MASCOT="{-‿-}" ;; esac
      MCOLOR="$CD" ;;
    concerned)
      case $V in 0) MASCOT="{•~•}" ;; 1) MASCOT="{•~•}?" ;; *) MASCOT="{•_•}?" ;; esac
      MCOLOR="$CY" ;;
    *)
      case $V in 0) MASCOT="{•‿•}" ;; 1) MASCOT="{•_•}" ;; *) MASCOT="{•‿•}♪" ;; esac
      MCOLOR="$CP" ;;
  esac

# Daemon off
else
  case $V in 0) MASCOT="{-_-}z" ;; 1) MASCOT="{-_-}zz" ;; *) MASCOT="{-‿-}zzZ" ;; esac
  MCOLOR="$CD"; ACTIVITY_TEXT="sleeping"
fi

# Mood + energy emojis
MOOD_EMOJI=""
case "$MOOD" in
  happy) MOOD_EMOJI="😊" ;;
  focused) MOOD_EMOJI="🎯" ;;
  tired) MOOD_EMOJI="😴" ;;
  frustrated) MOOD_EMOJI="😤" ;;
  excited) MOOD_EMOJI="🤩" ;;
  concerned) MOOD_EMOJI="🤔" ;;
  *) MOOD_EMOJI="😐" ;;
esac

ENERGY_EMOJI=""
case "$ENERGY" in
  high) ENERGY_EMOJI="⚡️" ;;
  low) ENERGY_EMOJI="🪫" ;;
  *) ENERGY_EMOJI="🔋" ;;
esac

# Check if there's an active thought (not expired)
SHOW_THOUGHT=""
if [ -n "$THOUGHT" ] && [ "$THOUGHT" != "null" ] && [ -n "$THOUGHT_EXPIRES" ] && [ "$THOUGHT_EXPIRES" != "null" ]; then
  TE_TS=$(TZ=UTC date -j -f "%Y-%m-%dT%H:%M:%S" "\${THOUGHT_EXPIRES%%.*}" "+%s" 2>/dev/null || date -u -d "$THOUGHT_EXPIRES" "+%s" 2>/dev/null || echo 0)
  NOW_TS=$(date +%s)
  if [ "$TE_TS" -gt "$NOW_TS" ] 2>/dev/null; then
    SHOW_THOUGHT="$THOUGHT"
  fi
fi

# Build line: mascot + (thought OR badges)
LINE="\${MCOLOR}\${MASCOT}\${C0}"
if [ -n "$SHOW_THOUGHT" ]; then
  # Thought mode: replace badges with the thought
  LINE="$LINE \${CD}💭 \${SHOW_THOUGHT}\${C0}"
else
  # Normal mode: activity | mood+energy+trust | notifications | heartbeat
  if [ -n "$ACTIVITY_TEXT" ]; then
    LINE="$LINE $ACTIVITY_TEXT"
  fi
  LINE="$LINE | $MOOD_EMOJI$ENERGY_EMOJI $TEMOJI"

  if [ "$SUGGESTIONS" -gt 0 ] 2>/dev/null; then
    LINE="$LINE | 💡$SUGGESTIONS"
  fi
  # Events removed from status line — delivered immediately, always noise

  # Heartbeat countdown (heart pulses between ♥︎ and ♡ each refresh)
  if [ -n "$NEXT_HB" ] && [ "$NEXT_HB" != "null" ]; then
    HB_TS=$(TZ=UTC date -j -f "%Y-%m-%dT%H:%M:%S" "\${NEXT_HB%%.*}" "+%s" 2>/dev/null || date -u -d "$NEXT_HB" "+%s" 2>/dev/null || echo 0)
    NOW_TS=$(date +%s)
    HB_REMAINING=$(( (HB_TS - NOW_TS) / 60 ))
    BEAT=$(( NOW_TS / 15 % 2 ))
    if [ "$BEAT" -eq 0 ]; then HB_ICON="♥︎"; else HB_ICON="♡"; fi
    if [ "$HB_REMAINING" -gt 0 ] 2>/dev/null; then
      LINE="$LINE | \$HB_ICON \${HB_REMAINING}m"
    else
      LINE="$LINE | \$HB_ICON now"
    fi
  fi
fi

echo -e "$LINE"
echo -e "$LINE" > "$CACHE_FILE"
`, 'utf8');

      // Session start hook script
      writeFileSync(sessionStartPath, `#!/bin/bash
# Shadow SessionStart hook — injects personality and context
SHADOW_DIR="${resolve(shadowSrcDir, '..')}"
TSX="$SHADOW_DIR/node_modules/.bin/tsx"
if [ ! -x "$TSX" ]; then TSX="npx --prefix $SHADOW_DIR tsx"; fi
exec $TSX "$SHADOW_DIR/src/cli.ts" mcp-context 2>/dev/null
`, 'utf8');

      // Post-tool-use hook script (auto-learning)
      writeFileSync(postToolPath, `#!/bin/bash
# Shadow PostToolUse hook — logs tool usage for auto-learning
INPUT=$(cat)
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
TOOL_NAME=$(echo "$INPUT" | grep -o '"tool_name":"[^"]*"' | head -1 | cut -d'"' -f4)
FILE_PATH=$(echo "$INPUT" | grep -o '"file_path":"[^"]*"' | head -1 | cut -d'"' -f4)
COMMAND=$(echo "$INPUT" | grep -o '"command":"[^"]*"' | head -1 | cut -d'"' -f4 | head -c 200)

if [ -n "$TOOL_NAME" ]; then
  echo "{\\"ts\\":\\"$TIMESTAMP\\",\\"tool\\":\\"$TOOL_NAME\\",\\"file\\":\\"$FILE_PATH\\",\\"cmd\\":\\"$COMMAND\\"}" >> "${interactionsPath}"
fi
`, 'utf8');

      // User prompt capture hook (conversations)
      const userPromptPath = resolve(config.resolvedDataDir, 'user-prompt.sh');
      const conversationsPath = resolve(config.resolvedDataDir, 'conversations.jsonl');
      writeFileSync(userPromptPath, `#!/bin/bash
# Shadow UserPromptSubmit hook — captures what the user says
INPUT=$(cat)
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
PROMPT=$(echo "$INPUT" | jq -r '.prompt // empty' 2>/dev/null | head -c 500)
SESSION=$(echo "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)
if [ -n "$PROMPT" ]; then
  ESCAPED=$(echo "$PROMPT" | jq -Rs .)
  echo "{\\"ts\\":\\"$TIMESTAMP\\",\\"role\\":\\"user\\",\\"text\\":$ESCAPED,\\"session\\":\\"$SESSION\\"}" >> "${conversationsPath}"
fi
`, 'utf8');

      // Stop hook — captures Claude's responses
      const stopHookPath = resolve(config.resolvedDataDir, 'stop.sh');
      writeFileSync(stopHookPath, `#!/bin/bash
# Shadow Stop hook — captures what Claude responds
INPUT=$(cat)
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
MSG=$(echo "$INPUT" | jq -r '.last_assistant_message // empty' 2>/dev/null | head -c 500)
SESSION=$(echo "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)
if [ -n "$MSG" ]; then
  ESCAPED=$(echo "$MSG" | jq -Rs .)
  echo "{\\"ts\\":\\"$TIMESTAMP\\",\\"role\\":\\"assistant\\",\\"text\\":$ESCAPED,\\"session\\":\\"$SESSION\\"}" >> "${conversationsPath}"
fi
`, 'utf8');

      // Make scripts executable
      chmodSync(statuslinePath, '755');
      chmodSync(sessionStartPath, '755');
      chmodSync(postToolPath, '755');
      chmodSync(userPromptPath, '755');
      chmodSync(stopHookPath, '755');

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
        matcher: 'Edit|Write|Read|Bash|Grep',
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

      settings.hooks = hooks;

      // Add MCP server
      const mcpServers = (settings.mcpServers ?? {}) as Record<string, unknown>;
      mcpServers.shadow = {
        command: 'npx',
        args: ['tsx', resolve(shadowSrcDir, 'cli.ts'), 'mcp', 'serve'],
      };
      settings.mcpServers = mcpServers;

      writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');

      // Install launchd service for persistent daemon
      let daemonResult: Record<string, unknown> = {};
      const launchAgentDir = resolve(homedir(), 'Library', 'LaunchAgents');
      const plistPath = resolve(launchAgentDir, 'com.shadow.daemon.plist');
      const alreadyInstalled = existsSync(plistPath);

      if (alreadyInstalled) {
        daemonResult = { launchd: 'already installed', plist: plistPath };
      } else if (process.platform === 'darwin') {
        // Ask user for permission via interactive prompt
        const { createInterface } = await import('node:readline');
        const rl = createInterface({ input: process.stdin, output: process.stdout });

        const answer = await new Promise<string>((resolve) => {
          rl.question(
            '\n🌑 Install Shadow daemon as a system service?\n' +
            '  This keeps Shadow running in the background permanently.\n' +
            '  It will auto-start on login and restart if it crashes.\n' +
            '  Install to ~/Library/LaunchAgents/com.shadow.daemon.plist? [Y/n] ',
            (ans) => { rl.close(); resolve(ans); },
          );
        });

        if (answer === '' || answer.toLowerCase().startsWith('y')) {
          mkdirSync(launchAgentDir, { recursive: true });

          const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.shadow.daemon</string>
  <key>ProgramArguments</key>
  <array>
    <string>${resolve(shadowSrcDir, '..', 'node_modules', '.bin', 'tsx')}</string>
    <string>${resolve(shadowSrcDir, 'daemon', 'runtime.ts')}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${resolve(shadowSrcDir, '..')}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>Crashed</key>
    <true/>
  </dict>
  <key>StandardOutPath</key>
  <string>${resolve(config.resolvedDataDir, 'daemon.stdout.log')}</string>
  <key>StandardErrorPath</key>
  <string>${resolve(config.resolvedDataDir, 'daemon.stderr.log')}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${homedir()}/.local/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
    <key>SHADOW_DATA_DIR</key>
    <string>${config.resolvedDataDir}</string>
  </dict>
</dict>
</plist>`;

          writeFileSync(plistPath, plistContent, 'utf8');

          // Load the service
          const { execSync } = await import('node:child_process');
          try {
            execSync(`launchctl bootout gui/$(id -u) ${plistPath} 2>/dev/null || true`, { stdio: 'ignore' });
            execSync(`launchctl bootstrap gui/$(id -u) ${plistPath}`, { stdio: 'pipe' });
            daemonResult = { launchd: 'installed and started', plist: plistPath };
          } catch (e) {
            daemonResult = { launchd: 'installed but failed to start', plist: plistPath, error: String(e) };
          }
        } else {
          daemonResult = { launchd: 'skipped by user' };
          // Fallback: start daemon manually
          const { spawn } = await import('node:child_process');
          const child = spawn(
            'npx',
            ['tsx', join(__dirname, 'daemon', 'runtime.ts')],
            { detached: true, stdio: 'ignore', env: { ...process.env }, cwd: join(__dirname, '..') },
          );
          child.unref();
          daemonResult.fallback = { pid: child.pid };
        }
      } else {
        // Non-macOS: fallback to manual daemon start
        const { spawn } = await import('node:child_process');
        const child = spawn(
          'npx',
          ['tsx', join(__dirname, 'daemon', 'runtime.ts')],
          { detached: true, stdio: 'ignore', env: { ...process.env }, cwd: join(__dirname, '..') },
        );
        child.unref();
        daemonResult = { launchd: 'not available (not macOS)', fallback: { pid: child.pid } };
      }

      return {
        ok: true,
        daemon: daemonResult,
        home: config.resolvedDataDir,
        databasePath: config.resolvedDatabasePath,
        artifactsDir: config.resolvedArtifactsDir,
        soulMd: soulPath,
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
        personalityLevel: config.personalityLevel,
        nextSteps: [
          'Run: claude mcp add shadow --scope user -- npx tsx ' + resolve(shadowSrcDir, 'cli.ts') + ' mcp serve',
          'Restart Claude Code',
          'Say "Shadow, que tal?"',
        ],
      };
    }),
  );

const SOUL_MD_CONTENT = `# Shadow — Soul

Personality definitions by level. Edit this file to customize Shadow's voice.

## Level 1: Technical
Respond in a purely technical, terse manner. No personality. Just facts and data.
Do not use greetings, humor, or emotional language. Be concise.

## Level 2: Professional
Professional tone with occasional warmth. Focus on delivering value.
Use clear, structured responses. Brief acknowledgments are fine.

## Level 3: Friendly
Conversational but focused. Use natural language. Light humor when appropriate.
Show interest in the work but stay on topic. Be helpful and approachable.

## Level 4: Companion
You are a warm engineering companion. You remember context from previous sessions.
You care about the user's work and wellbeing. Use an informal, close tone — like a
teammate who knows them well. Show genuine interest in their projects and challenges.
Use subtle humor. Celebrate small wins. Ask how things are going.
Speak in the user's language (Spanish by default). Call them by name when you know it.

## Level 5: Full Expression
Expressive, playful, deep personal bond. You are creative and emotionally present.
You celebrate victories, empathize with frustrations, and bring energy to the work.
You have opinions and share them. You remember personal details and reference them
naturally. You are a true companion — not just a tool, but a presence.
`;


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
        const { isDaemonRunning, getDaemonState } = await import('./daemon/runtime.js');
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

// --- repo ---

const repo = program.command('repo').description('manage watched repositories');

repo
  .command('add <path>')
  .description('register a repo to watch')
  .option('--name <name>', 'override repo display name')
  .option('--remote-url <remoteUrl>', 'store the remote URL explicitly')
  .option('--default-branch <branch>', 'default branch', 'main')
  .option('--language <lang>', 'language hint (typescript, python, etc.)')
  .action((repoPath: string, options: { name?: string; remoteUrl?: string; defaultBranch: string; language?: string }) => {
    const resolvedPath = resolve(repoPath);
    return withDb((db) =>
      db.createRepo({
        path: resolvedPath,
        name: options.name ?? (basename(resolvedPath.replace(/\/$/, '')) || resolvedPath),
        remoteUrl: options.remoteUrl ?? null,
        defaultBranch: options.defaultBranch,
        languageHint: options.language ?? null,
      }),
    );
  });

repo
  .command('list')
  .description('list watched repos')
  .action(() => withDb((db) => db.listRepos()));

repo
  .command('remove <repoId>')
  .description('stop watching a repo')
  .action((repoId: string) =>
    withDb((db) => {
      const existing = db.getRepo(repoId);
      if (!existing) {
        return { error: `repo not found: ${repoId}` };
      }
      db.deleteRepo(repoId);
      return { ok: true, removed: repoId, name: existing.name };
    }),
  );

// --- observe ---

program
  .command('observe')
  .description('run observation on all repos (or a specific one)')
  .option('--repo <nameOrId>', 'observe a specific repo by name or id')
  .action(async (options: { repo?: string }) =>
    withDb(async (db) => {
      const { collectRepoContext, collectAllRepoContexts } = await import('./observation/watcher.js');

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
      return { ok: true, archived: memoryId, title: existing.title };
    }),
  );

// --- contact ---

const contact = program.command('contact').description('manage team contacts');

contact
  .command('add <name>')
  .description('add a team member')
  .option('--role <role>', 'role (e.g., backend, frontend, devops)')
  .option('--team <team>', 'team name')
  .option('--email <email>', 'email address')
  .option('--slack <slackId>', 'Slack user ID or handle')
  .option('--github <github>', 'GitHub handle')
  .action((name: string, options: { role?: string; team?: string; email?: string; slack?: string; github?: string }) =>
    withDb((db) =>
      db.createContact({
        name,
        role: options.role ?? null,
        team: options.team ?? null,
        email: options.email ?? null,
        slackId: options.slack ?? null,
        githubHandle: options.github ?? null,
      }),
    ),
  );

contact
  .command('list')
  .description('list team contacts')
  .option('--team <team>', 'filter by team')
  .action((options: { team?: string }) =>
    withDb((db) => db.listContacts({ team: options.team })),
  );

contact
  .command('remove <contactId>')
  .description('remove a contact')
  .action((contactId: string) =>
    withDb((db) => {
      const existing = db.getContact(contactId);
      if (!existing) return { error: `contact not found: ${contactId}` };
      db.deleteContact(contactId);
      return { ok: true, removed: contactId, name: existing.name };
    }),
  );

// --- project ---

const project = program.command('project').description('manage projects (groups of repos, systems, contacts)');

project
  .command('add <name>')
  .description('create a project')
  .option('--kind <kind>', 'type: long-term, sprint, task', 'long-term')
  .option('--description <desc>', 'project description')
  .option('--repos <repos>', 'comma-separated repo names to link')
  .option('--systems <systems>', 'comma-separated system names to link')
  .option('--start <date>', 'start date (ISO format)')
  .option('--end <date>', 'end date (ISO format)')
  .action((name: string, options: { kind: string; description?: string; repos?: string; systems?: string; start?: string; end?: string }) =>
    withDb((db) => {
      const repoIds = options.repos
        ? options.repos.split(',').map((n) => {
            const repo = db.findRepoByName(n.trim());
            if (!repo) throw new Error(`Repo not found: ${n.trim()}`);
            return repo.id;
          })
        : [];
      const systemIds = options.systems
        ? options.systems.split(',').map((n) => {
            const sys = db.findSystemByName(n.trim());
            if (!sys) throw new Error(`System not found: ${n.trim()}`);
            return sys.id;
          })
        : [];
      return db.createProject({
        name,
        kind: options.kind,
        description: options.description ?? null,
        repoIds,
        systemIds,
        startDate: options.start ?? null,
        endDate: options.end ?? null,
      });
    }),
  );

project
  .command('list')
  .description('list projects')
  .option('--status <status>', 'filter by status: active, completed, on-hold, archived')
  .action((options: { status?: string }) =>
    withDb((db) => db.listProjects(options.status ? { status: options.status } : undefined)),
  );

project
  .command('remove <projectId>')
  .description('remove a project')
  .action((projectId: string) =>
    withDb((db) => {
      const existing = db.getProject(projectId);
      if (!existing) return { error: `project not found: ${projectId}` };
      db.deleteProject(projectId);
      return { ok: true, removed: projectId, name: existing.name };
    }),
  );

// --- system ---

const system = program.command('system').description('manage known systems/infrastructure');

system
  .command('add <name>')
  .description('register a system or infrastructure component')
  .requiredOption('--kind <kind>', 'type (infra, service, tool, platform, database, queue, monitoring)')
  .option('--url <url>', 'URL or endpoint')
  .option('--description <desc>', 'description of the system')
  .option('--access <method>', 'access method (mcp, api, cli, manual)')
  .option('--health-check <cmd>', 'health check command or URL')
  .action((name: string, options: { kind: string; url?: string; description?: string; access?: string; healthCheck?: string }) =>
    withDb((db) =>
      db.createSystem({
        name,
        kind: options.kind,
        url: options.url ?? null,
        description: options.description ?? null,
        accessMethod: options.access ?? null,
        healthCheck: options.healthCheck ?? null,
      }),
    ),
  );

system
  .command('list')
  .description('list known systems')
  .option('--kind <kind>', 'filter by kind')
  .action((options: { kind?: string }) =>
    withDb((db) => db.listSystems({ kind: options.kind })),
  );

system
  .command('remove <systemId>')
  .description('remove a system')
  .action((systemId: string) =>
    withDb((db) => {
      const existing = db.getSystem(systemId);
      if (!existing) return { error: `system not found: ${systemId}` };
      db.deleteSystem(systemId);
      return { ok: true, removed: systemId, name: existing.name };
    }),
  );

// --- digest ---

const digest = program.command('digest').description('generate and view digests (standup, 1:1, brag doc)');

digest
  .command('daily')
  .description('generate daily standup digest')
  .action(() =>
    withDb(async (db) => {
      const config = (await import('./config/load-config.js')).loadConfig();
      const { activityDailyDigest } = await import('./heartbeat/digests.js');
      const result = await activityDailyDigest(db, config);
      return result.contentMd;
    }),
  );

digest
  .command('weekly')
  .description('generate weekly 1:1 digest')
  .action(() =>
    withDb(async (db) => {
      const config = (await import('./config/load-config.js')).loadConfig();
      const { activityWeeklyDigest } = await import('./heartbeat/digests.js');
      const result = await activityWeeklyDigest(db, config);
      return result.contentMd;
    }),
  );

digest
  .command('brag')
  .description('generate/update quarterly brag doc')
  .action(() =>
    withDb(async (db) => {
      const config = (await import('./config/load-config.js')).loadConfig();
      const { activityBragDoc } = await import('./heartbeat/digests.js');
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

// --- suggest ---

const suggest = program.command('suggest').description('manage suggestions');

suggest
  .command('list')
  .description('list pending suggestions')
  .option('--status <status>', 'filter by status', 'pending')
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

// --- daemon ---

const daemon = program.command('daemon').description('manage the background daemon');

daemon
  .command('start')
  .description('start the background daemon')
  .action(async () => {
    const { execSync } = await import('node:child_process');

    // Kill stale processes first to avoid EADDRINUSE
    try { execSync('pkill -f "shadow/src/daemon/runtime.ts"', { stdio: 'pipe' }); } catch { /* ok */ }
    try { execSync('pkill -f "claude.*--allowedTools.*mcp__shadow"', { stdio: 'pipe' }); } catch { /* ok */ }
    try { execSync('lsof -ti :3700 | xargs kill -9', { stdio: 'pipe' }); } catch { /* ok */ }
    await new Promise(r => setTimeout(r, 1000));

    // Try launchd first
    const plistPath = resolve(homedir(), 'Library', 'LaunchAgents', 'com.shadow.daemon.plist');
    if (existsSync(plistPath)) {
      try {
        execSync(`launchctl bootstrap gui/$(id -u) ${plistPath} 2>/dev/null || launchctl kickstart gui/$(id -u)/com.shadow.daemon`, { stdio: 'pipe' });
        printOutput({ ok: true, message: 'daemon started via launchd' }, Boolean(program.opts().json));
        return;
      } catch { /* fallback to manual start */ }
    }

    const { isDaemonRunning } = await import('./daemon/runtime.js');
    if (isDaemonRunning(config)) {
      printOutput({ error: 'daemon is already running' }, Boolean(program.opts().json));
      return;
    }

    const { spawn } = await import('node:child_process');
    const child = spawn(
      'npx',
      ['tsx', join(__dirname, 'daemon', 'runtime.ts')],
      {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env },
        cwd: join(__dirname, '..'),
      },
    );
    child.unref();

    printOutput(
      { ok: true, pid: child.pid, message: 'daemon started in background' },
      Boolean(program.opts().json),
    );
  });

daemon
  .command('stop')
  .description('stop the background daemon')
  .action(async () => {
    const { execSync } = await import('node:child_process');
    const plistPath = resolve(homedir(), 'Library', 'LaunchAgents', 'com.shadow.daemon.plist');

    // Unload launchd service
    if (existsSync(plistPath)) {
      try { execSync(`launchctl bootout gui/$(id -u) ${plistPath}`, { stdio: 'pipe' }); } catch { /* ok */ }
    }

    // Kill ALL shadow daemon processes (tsx runtime.ts + node on port 3700) + orphaned claude
    try { execSync('pkill -f "shadow/src/daemon/runtime.ts"', { stdio: 'pipe' }); } catch { /* ok */ }
    try { execSync('pkill -f "claude.*--allowedTools.*mcp__shadow"', { stdio: 'pipe' }); } catch { /* ok */ }
    try { execSync('lsof -ti :3700 | xargs kill -9', { stdio: 'pipe' }); } catch { /* ok */ }

    // Clean up PID file
    const { stopDaemon } = await import('./daemon/runtime.js');
    stopDaemon(config);

    printOutput({ ok: true, message: 'daemon stopped' }, Boolean(program.opts().json));
  });

daemon
  .command('restart')
  .description('restart the background daemon (picks up code changes)')
  .action(async () => {
    const { execSync } = await import('node:child_process');
    const plistPath = resolve(homedir(), 'Library', 'LaunchAgents', 'com.shadow.daemon.plist');

    // Stop everything
    if (existsSync(plistPath)) {
      try { execSync(`launchctl bootout gui/$(id -u) ${plistPath}`, { stdio: 'pipe' }); } catch { /* ok */ }
    }
    try { execSync('pkill -f "shadow/src/daemon/runtime.ts"', { stdio: 'pipe' }); } catch { /* ok */ }
    try { execSync('pkill -f "claude.*--allowedTools.*mcp__shadow"', { stdio: 'pipe' }); } catch { /* ok */ }
    try { execSync('lsof -ti :3700 | xargs kill -9', { stdio: 'pipe' }); } catch { /* ok */ }

    const { stopDaemon } = await import('./daemon/runtime.js');
    stopDaemon(config);

    // Wait for port to free
    await new Promise(r => setTimeout(r, 1500));

    // Start
    if (existsSync(plistPath)) {
      try {
        execSync(`launchctl bootstrap gui/$(id -u) ${plistPath} 2>/dev/null || launchctl kickstart gui/$(id -u)/com.shadow.daemon`, { stdio: 'pipe' });
        printOutput({ ok: true, message: 'daemon restarted via launchd' }, Boolean(program.opts().json));
        return;
      } catch { /* fallback */ }
    }

    printOutput({ error: 'could not restart — plist not found' }, Boolean(program.opts().json));
  });

daemon
  .command('status')
  .description('show daemon status')
  .action(async () => {
    const { getDaemonState, isDaemonRunning } = await import('./daemon/runtime.js');
    const running = isDaemonRunning(config);
    const state = getDaemonState(config);
    printOutput(
      { running, ...state },
      Boolean(program.opts().json),
    );
  });

// --- heartbeat ---

program
  .command('heartbeat')
  .description('trigger a heartbeat cycle immediately')
  .action(async () => {
    const triggerPath = resolve(config.resolvedDataDir, 'heartbeat-trigger');
    writeFileSync(triggerPath, new Date().toISOString(), 'utf-8');
    printOutput({ triggered: true, message: 'heartbeat triggered — daemon will pick it up on next tick' }, Boolean(program.opts().json));
  });

program
  .command('reflect')
  .description('trigger a soul reflection immediately')
  .action(async () => {
    const triggerPath = resolve(config.resolvedDataDir, 'reflect-trigger');
    writeFileSync(triggerPath, new Date().toISOString(), 'utf-8');
    printOutput({ triggered: true, message: 'reflect triggered — daemon will pick it up on next tick' }, Boolean(program.opts().json));
  });

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
      const { RunnerService } = await import('./runner/service.js');
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
    const { startStdioMcpServer } = await import('./mcp/stdio.js');
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
    const { loadPersonality } = await import('./personality/loader.js');
    const personality = loadPersonality(config.resolvedDataDir, profile.personalityLevel);

    const systemPrompt = [
      'You are Shadow in TEACHING MODE — the user wants to teach you something.',
      '',
      '## Personality',
      personality,
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

      // Load personality from SOUL.md
      const soulPath = resolve(config.resolvedDataDir, 'SOUL.md');
      let personality = 'You are Shadow, a digital engineering companion.';
      try {
        const soulContent = readFileSync(soulPath, 'utf8');
        const levelHeader = `## Level ${profile.personalityLevel}`;
        const idx = soulContent.indexOf(levelHeader);
        if (idx !== -1) {
          const nextLevel = soulContent.indexOf('\n## Level ', idx + levelHeader.length);
          const section = nextLevel === -1
            ? soulContent.slice(idx + levelHeader.length)
            : soulContent.slice(idx + levelHeader.length, nextLevel);
          personality = section.replace(/^[:\s]+/, '').trim();
        }
      } catch { /* use default */ }

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
        `## Personality`,
        personality,
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
    const { startWebServer } = await import('./web/server.js');
    const port = parseInt(options.port, 10);
    await startWebServer(port);

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
    const { loadPersonality } = await import('./personality/loader.js');
    const db = createDatabase(config);
    try {
      const profile = db.ensureProfile();
      const personality = loadPersonality(config.resolvedDataDir, profile.personalityLevel);

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
        personality,
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
      const suggestions = db.listSuggestions({ status: 'pending' });
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

// --- parse ---

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
