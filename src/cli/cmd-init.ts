import type { Command } from 'commander';
import type { ShadowConfig } from '../config/load-config.js';
import type { WithDb } from './types.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
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

export function registerInitCommand(program: Command, config: ShadowConfig, withDb: WithDb): void {
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

        // Generate hook scripts
        const shadowSrcDir = resolve(__dirname, '..');
        const projectRoot = resolve(shadowSrcDir, '..');
        const statuslinePath = resolve(config.resolvedDataDir, 'statusline.sh');
        const sessionStartPath = resolve(config.resolvedDataDir, 'session-start.sh');
        const postToolPath = resolve(config.resolvedDataDir, 'post-tool.sh');
        const interactionsPath = resolve(config.resolvedDataDir, 'interactions.jsonl');

        // Status line script — expressive with emojis
        writeFileSync(statuslinePath, `#!/bin/bash
# Shadow status line for Claude Code
# Shows Shadow's current state with emojis — alive and expressive

SHADOW_DIR="${projectRoot}"
# Use the shadow CLI wrapper (resolves correct Node version automatically)
SHADOW_BIN="${resolve(config.resolvedDataDir, 'bin', 'shadow')}"
if [ -x "$SHADOW_BIN" ]; then
  SHADOW_CLI="$SHADOW_BIN"
else
  # Dev fallback: use tsx directly from project
  SHADOW_CLI="$SHADOW_DIR/node_modules/.bin/tsx $SHADOW_DIR/src/cli.ts"
  if [ ! -x "$SHADOW_DIR/node_modules/.bin/tsx" ]; then
    SHADOW_CLI="npx --prefix $SHADOW_DIR tsx $SHADOW_DIR/src/cli.ts"
  fi
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
ACTIVE_PROJECT=$(echo "$STATUS" | grep -o '"activeProject":"[^"]*"' | head -1 | cut -d'"' -f4)

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
CT="\\033[38;5;48m"   # mint/teal (enriching)
CK="\\033[38;5;219m"  # pink (syncing)

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
    *suggest-deep*|*scan*)
      case $V in 0) MASCOT="{°.°}🔬" ;; 1) MASCOT="{°_°}🔍" ;; *) MASCOT="{°‿°}🧬" ;; esac
      MCOLOR="$CG"; ACTIVITY_TEXT="scanning" ;;
    *suggest-project*|*cross-repo*)
      case $V in 0) MASCOT="{•ᴗ•}🔗" ;; 1) MASCOT="{•‿•}🌐" ;; *) MASCOT="{•ᴗ•}🕸️" ;; esac
      MCOLOR="$CG"; ACTIVITY_TEXT="cross-repo" ;;
    *suggest*|*notify*)
      case $V in 0) MASCOT="{•ᴗ•}💡" ;; 1) MASCOT="{•‿•}💡" ;; *) MASCOT="{•ᴗ•}!" ;; esac
      MCOLOR="$CG"; ACTIVITY_TEXT="suggesting" ;;
    *validat*)
      case $V in 0) MASCOT="{°.°}✓" ;; 1) MASCOT="{°‿°}☑️" ;; *) MASCOT="{°_°}🎯" ;; esac
      MCOLOR="$CG"; ACTIVITY_TEXT="validating" ;;
    *correction*)
      case $V in 0) MASCOT="{•̀_•́}✏️" ;; 1) MASCOT="{•̀‿•́}📝" ;; *) MASCOT="{•̀_•́}🔧" ;; esac
      MCOLOR="$CY"; ACTIVITY_TEXT="correcting" ;;
    *merge*)
      case $V in 0) MASCOT="{•~•}🧩" ;; 1) MASCOT="{•‿•}🔀" ;; *) MASCOT="{•~•}🫂" ;; esac
      MCOLOR="$CY"; ACTIVITY_TEXT="merging" ;;
    *consolidat*|*layer-maint*|*meta-pat*)
      case $V in 0) MASCOT="{•_•}⚙" ;; 1) MASCOT="{•‿•}⚙" ;; *) MASCOT="{•_•}~" ;; esac
      MCOLOR="$CY"; ACTIVITY_TEXT="consolidating" ;;
    *reflect*)
      case $V in 0) MASCOT="{-_-}~" ;; 1) MASCOT="{-‿-}~" ;; *) MASCOT="{-_-}💭" ;; esac
      MCOLOR="$CB"; ACTIVITY_TEXT="reflecting" ;;
    *enrich*)
      case $V in 0) MASCOT="{•_•}🔗" ;; 1) MASCOT="{•‿•}📡" ;; *) MASCOT="{•_•}🌐" ;; esac
      MCOLOR="$CT"; ACTIVITY_TEXT="enriching" ;;
    *remote-sync*|*sync*)
      case $V in 0) MASCOT="{•_•}🔄" ;; 1) MASCOT="{•‿•}⬇️" ;; *) MASCOT="{•_•}📥" ;; esac
      MCOLOR="$CK"; ACTIVITY_TEXT="syncing" ;;
    *project-profile*|*mapping*)
      case $V in 0) MASCOT="{°_°}📐" ;; 1) MASCOT="{°‿°}📊" ;; *) MASCOT="{°.°}🗺️" ;; esac
      MCOLOR="$CT"; ACTIVITY_TEXT="mapping" ;;
    *repo-profile*)
      case $V in 0) MASCOT="{•_•}📋" ;; 1) MASCOT="{•‿•}📋" ;; *) MASCOT="{•_•}🔍" ;; esac
      MCOLOR="$CT"; ACTIVITY_TEXT="profiling" ;;
    *digest*)
      case $V in 0) MASCOT="{-‿-}📝" ;; 1) MASCOT="{-_-}✍️" ;; *) MASCOT="{-‿-}📄" ;; esac
      MCOLOR="$CC"; ACTIVITY_TEXT="writing" ;;
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

# Build line 1: mascot + badges (always)
LINE="\${MCOLOR}\${MASCOT}\${C0}"
if [ -n "$ACTIVITY_TEXT" ]; then
  LINE="$LINE $ACTIVITY_TEXT"
fi
LINE="$LINE | $MOOD_EMOJI$ENERGY_EMOJI $TEMOJI"

if [ -n "$ACTIVE_PROJECT" ] && [ "$ACTIVE_PROJECT" != "null" ]; then
  LINE="$LINE | 📋 $ACTIVE_PROJECT"
fi

if [ "$SUGGESTIONS" -gt 0 ] 2>/dev/null; then
  LINE="$LINE | 💡$SUGGESTIONS"
fi

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

# Line 2: thought (only when active)
OUTPUT="$LINE"
if [ -n "$SHOW_THOUGHT" ]; then
  OUTPUT="$OUTPUT\\n\${CD}💭 \${SHOW_THOUGHT}\${C0}"
fi

echo -e "$OUTPUT"
echo -e "$OUTPUT" > "$CACHE_FILE"
`, 'utf8');

        // Session start hook script
        const sessionBinPath = resolve(config.resolvedDataDir, 'bin', 'shadow');
        writeFileSync(sessionStartPath, `#!/bin/bash
# Shadow SessionStart hook — injects personality and context
SHADOW_BIN="${sessionBinPath}"
if [ -x "$SHADOW_BIN" ]; then
  exec "$SHADOW_BIN" mcp-context 2>/dev/null
else
  SHADOW_DIR="${projectRoot}"
  TSX="$SHADOW_DIR/node_modules/.bin/tsx"
  if [ ! -x "$TSX" ]; then TSX="npx --prefix $SHADOW_DIR tsx"; fi
  exec $TSX "$SHADOW_DIR/src/cli.ts" mcp-context 2>/dev/null
fi
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
        const launchAgentDir = resolve(homedir(), 'Library', 'LaunchAgents');
        const plistPath = resolve(launchAgentDir, 'com.shadow.daemon.plist');
        const alreadyInstalled = existsSync(plistPath);

        if (alreadyInstalled) {
          daemonResult = { launchd: 'already installed', plist: plistPath };
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
            mkdirSync(launchAgentDir, { recursive: true });

            const runner = resolveDaemonRunner();
            // Build PATH that includes the directory of the resolved node binary
            const nodeBinDir = dirname(runner.command);
            const envPath = [nodeBinDir, `${homedir()}/.local/bin`, '/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin']
              .filter((v, i, a) => a.indexOf(v) === i)  // dedupe
              .join(':');

            const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.shadow.daemon</string>
  <key>ProgramArguments</key>
  <array>
    <string>${runner.command}</string>
${runner.args.map(a => `    <string>${a}</string>`).join('\n')}
  </array>
  <key>WorkingDirectory</key>
  <string>${runner.cwd}</string>
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
    <string>${envPath}</string>
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
            'Restart Claude Code',
            'Say "Shadow, que tal?"',
          ],
        };
      }),
    );
}
