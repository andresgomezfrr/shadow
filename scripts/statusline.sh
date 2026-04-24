#!/bin/bash
# shadow-hook-version: __SHADOW_VERSION__
# Shadow status line for Claude Code
# Shows Shadow's current state with emojis — alive and expressive

SHADOW_DIR="${SHADOW_DEV_DIR:-$HOME/workspace/shadow}"
# Use the shadow CLI wrapper (resolves correct Node version automatically)
SHADOW_BIN="$(command -v shadow 2>/dev/null || echo "$HOME/.shadow/bin/shadow")"
if [ -x "$SHADOW_BIN" ]; then
  SHADOW_CLI="$SHADOW_BIN"
else
  # Dev fallback: use tsx directly from project
  SHADOW_CLI="$SHADOW_DIR/node_modules/.bin/tsx $SHADOW_DIR/src/cli.ts"
  if [ ! -x "$SHADOW_DIR/node_modules/.bin/tsx" ]; then
    SHADOW_CLI="npx --prefix $SHADOW_DIR tsx $SHADOW_DIR/src/cli.ts"
  fi
fi
CACHE_FILE="$HOME/.shadow/statusline-cache.txt"
CACHE_TTL=15

# Check cache freshness
if [ -f "$CACHE_FILE" ]; then
  CACHE_AGE=$(( $(date +%s) - $(stat -f %m "$CACHE_FILE" 2>/dev/null || stat -c %Y "$CACHE_FILE" 2>/dev/null || echo 0) ))
  if [ "$CACHE_AGE" -lt "$CACHE_TTL" ]; then
    cat "$CACHE_FILE"
    exit 0
  fi
fi

# Claude Code passes {session_id, model, cwd, ...} as JSON on stdin. Capture
# the cwd so 'shadow status --cwd' can resolve the active repo + branch of
# the current shell. Fallback to the script's own PWD if stdin is empty
# (e.g. when invoked manually for a smoke test).
STATUSLINE_INPUT=""
if [ ! -t 0 ]; then
  STATUSLINE_INPUT=$(cat)
fi
CWD=$(echo "$STATUSLINE_INPUT" | grep -o '"cwd":"[^"]*"' | head -1 | cut -d'"' -f4)
[ -z "$CWD" ] && CWD="$PWD"

# Get Shadow status (--json) and flatten for grep
RAW_STATUS=$($SHADOW_CLI --json status --cwd "$CWD" 2>/dev/null)
STATUS=$(echo "$RAW_STATUS" | tr -d '\n ')
if [ $? -ne 0 ] || [ -z "$STATUS" ]; then
  echo "{•_•} offline"
  exit 0
fi

# Parse fields
BOND=$(echo "$STATUS" | grep -o '"bondTier":[0-9]*' | head -1 | cut -d: -f2)
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
ACTIVE_PROJECT_ID=$(echo "$STATUS" | grep -o '"activeProjectId":"[^"]*"' | head -1 | cut -d'"' -f4)
UNREAD_NOTIFS=$(echo "$STATUS" | grep -o '"unreadNotifications":[0-9]*' | head -1 | cut -d: -f2)
TOP_NOTIF_KIND=$(echo "$STATUS" | grep -o '"topNotification":{[^}]*}' | head -1 | grep -o '"kind":"[^"]*"' | cut -d'"' -f4)
TOP_NOTIF_MSG=$(echo "$RAW_STATUS" | grep -o '"topNotification": *{[^}]*}' | head -1 | grep -o '"message": *"[^"]*"' | sed 's/"message": *"//;s/"$//')
TOP_NOTIF_PATH=$(echo "$STATUS" | grep -o '"topNotification":{[^}]*}' | head -1 | grep -o '"targetPath":"[^"]*"' | cut -d'"' -f4)

# Context repo (cwd resolved against registered repos) — {id, name, branch}.
# Object may be null if cwd isn't inside any registered repo.
CTX_REPO_ID=$(echo "$STATUS" | grep -o '"contextRepo":{[^}]*}' | head -1 | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
CTX_REPO_NAME=$(echo "$STATUS" | grep -o '"contextRepo":{[^}]*}' | head -1 | grep -o '"name":"[^"]*"' | cut -d'"' -f4)
CTX_REPO_BRANCH=$(echo "$STATUS" | grep -o '"contextRepo":{[^}]*}' | head -1 | grep -o '"branch":"[^"]*"' | cut -d'"' -f4)

# Extract alerts: each alert has message + severity + since + acked
ALERT_MESSAGES=()
ALERT_SEVERITIES=()
ALERT_SINCES=()
ALERT_ACKED=()
while IFS= read -r msg; do
  [ -n "$msg" ] && ALERT_MESSAGES+=("$msg")
done < <(echo "$RAW_STATUS" | grep -o '"message": *"[^"]*"' | sed 's/"message": *"//;s/"$//')
while IFS= read -r sev; do
  [ -n "$sev" ] && ALERT_SEVERITIES+=("$sev")
done < <(echo "$RAW_STATUS" | grep -o '"severity": *"[^"]*"' | sed 's/"severity": *"//;s/"$//')
while IFS= read -r since; do
  [ -n "$since" ] && ALERT_SINCES+=("$since")
done < <(echo "$RAW_STATUS" | grep -o '"since": *"[^"]*"' | sed 's/"since": *"//;s/"$//')
while IFS= read -r acked; do
  [ -n "$acked" ] && ALERT_ACKED+=("$acked")
done < <(echo "$STATUS" | grep -o '"acked":[a-z]*' | cut -d: -f2)

# Bond tier name + emoji (8 tiers post-v49)
case "$BOND" in
  1) TNAME="observer"; TEMOJI="🔍" ;;
  2) TNAME="echo";     TEMOJI="💭" ;;
  3) TNAME="whisper";  TEMOJI="🤫" ;;
  4) TNAME="shade";    TEMOJI="🌫" ;;
  5) TNAME="shadow";   TEMOJI="👾" ;;
  6) TNAME="wraith";   TEMOJI="👻" ;;
  7) TNAME="herald";   TEMOJI="📯" ;;
  8) TNAME="kindred";  TEMOJI="🌌" ;;
  *) TNAME="observer"; TEMOJI="🔍" ;;
esac

# Ghost mascot — reacts to state with micro-variations
V=$(( RANDOM % 3 ))
MASCOT=""
ACTIVITY_TEXT=""
C0="\033[0m"   # reset
CP="\033[35m"  # purple (idle)
CC="\033[36m"  # cyan (active)
CY="\033[33m"  # yellow (analyzing)
CG="\033[32m"  # green (positive)
CB="\033[34m"  # blue (reflecting)
CR="\033[31m"  # red (alert)
CD="\033[2m"   # dim (sleeping)
CT="\033[38;5;48m"   # mint/teal (enriching)
CK="\033[38;5;219m"  # pink (syncing)

# Priority 1: Focus mode
if [ "$FOCUS" = "focus" ]; then
  case $V in 0) MASCOT="{•̀_•́}" ;; 1) MASCOT="{•̀‿•́}" ;; *) MASCOT="{•̀_•́}▸" ;; esac
  MCOLOR="$CP"
  if [ -n "$FOCUS_UNTIL" ]; then
    FOCUS_TS=$(date -j -f "%Y-%m-%dT%H:%M:%S" "${FOCUS_UNTIL%%.*}" "+%s" 2>/dev/null || date -d "$FOCUS_UNTIL" "+%s" 2>/dev/null || echo 0)
    NOW_TS=$(date +%s)
    REMAINING=$(( (FOCUS_TS - NOW_TS) / 60 ))
    if [ "$REMAINING" -gt 0 ] 2>/dev/null; then
      ACTIVITY_TEXT="focus ${REMAINING}m"
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
  TE_TS=$(TZ=UTC date -j -f "%Y-%m-%dT%H:%M:%S" "${THOUGHT_EXPIRES%%.*}" "+%s" 2>/dev/null || date -u -d "$THOUGHT_EXPIRES" "+%s" 2>/dev/null || echo 0)
  NOW_TS=$(date +%s)
  if [ "$TE_TS" -gt "$NOW_TS" ] 2>/dev/null; then
    SHOW_THOUGHT="$THOUGHT"
  fi
fi

# Dashboard base URL — resolved once so every OSC 8 link on the line can
# point at its own section. Terminals that don't render OSC 8 simply show
# the visible text with no escape-code leak (BEL-terminated).
DASHBOARD_URL="http://localhost:${SHADOW_DASHBOARD_PORT:-3700}"

# osc8 <url> <visible-text> — wrap text in an OSC 8 hyperlink
osc8() { printf '\033]8;;%s\a%s\033]8;;\a' "$1" "$2"; }

# Build line 1: mascot (linked to /morning — the "home" of Shadow) + badges
MASCOT_LINK=$(osc8 "$DASHBOARD_URL/morning" "$MASCOT")
LINE="${MCOLOR}${MASCOT_LINK}${C0}"
if [ -n "$ACTIVITY_TEXT" ]; then
  LINE="$LINE $ACTIVITY_TEXT"
fi
# Bond tier emoji → /chronicle
TEMOJI_LINK=$(osc8 "$DASHBOARD_URL/chronicle" "$TEMOJI")
LINE="$LINE | $MOOD_EMOJI$ENERGY_EMOJI $TEMOJI_LINK"

# Location badge — prefer the shell's concrete context (cwd's repo + branch)
# over the daemon-detected activeProject, because per-shell info beats a
# singleton. Fall back to activeProject when cwd isn't inside any
# registered repo, and to nothing when neither is available.
if [ -n "$CTX_REPO_ID" ] && [ "$CTX_REPO_ID" != "null" ]; then
  REPO_LABEL="📦 $CTX_REPO_NAME"
  if [ -n "$CTX_REPO_BRANCH" ] && [ "$CTX_REPO_BRANCH" != "null" ] && [ "$CTX_REPO_BRANCH" != "HEAD" ]; then
    REPO_LABEL="$REPO_LABEL · $CTX_REPO_BRANCH"
  fi
  REPO_LINK=$(osc8 "$DASHBOARD_URL/repos" "$REPO_LABEL")
  LINE="$LINE | $REPO_LINK"
elif [ -n "$ACTIVE_PROJECT" ] && [ "$ACTIVE_PROJECT" != "null" ]; then
  if [ -n "$ACTIVE_PROJECT_ID" ] && [ "$ACTIVE_PROJECT_ID" != "null" ]; then
    PROJECT_LINK=$(osc8 "$DASHBOARD_URL/projects/$ACTIVE_PROJECT_ID" "📋 $ACTIVE_PROJECT")
    LINE="$LINE | $PROJECT_LINK"
  else
    LINE="$LINE | 📋 $ACTIVE_PROJECT"
  fi
fi

# Suggestions count → /suggestions
if [ "$SUGGESTIONS" -gt 0 ] 2>/dev/null; then
  SUGGEST_LINK=$(osc8 "$DASHBOARD_URL/suggestions" "💡$SUGGESTIONS")
  LINE="$LINE | $SUGGEST_LINK"
fi

if [ "$UNREAD_NOTIFS" -gt 0 ] 2>/dev/null; then
  NOTIFS_LINK=$(osc8 "$DASHBOARD_URL/morning?notifications=open" "📬$UNREAD_NOTIFS")
  LINE="$LINE | $NOTIFS_LINK"
fi

# Heartbeat countdown (heart pulses between ♥︎ and ♡ each refresh)
if [ -n "$NEXT_HB" ] && [ "$NEXT_HB" != "null" ]; then
  HB_TS=$(TZ=UTC date -j -f "%Y-%m-%dT%H:%M:%S" "${NEXT_HB%%.*}" "+%s" 2>/dev/null || date -u -d "$NEXT_HB" "+%s" 2>/dev/null || echo 0)
  NOW_TS=$(date +%s)
  HB_REMAINING=$(( (HB_TS - NOW_TS) / 60 ))
  BEAT=$(( NOW_TS / 15 % 2 ))
  if [ "$BEAT" -eq 0 ]; then HB_ICON="♥︎"; else HB_ICON="♡"; fi
  if [ "$HB_REMAINING" -gt 0 ] 2>/dev/null; then
    LINE="$LINE | $HB_ICON ${HB_REMAINING}m"
  else
    LINE="$LINE | $HB_ICON now"
  fi
fi

# Dashboard hyperlink — icon-only OSC 8 (iTerm2, Alacritty, Kitty, WezTerm,
# Ghostty, gnome-terminal, Konsole, Windows Terminal). Terminals that don't
# render OSC 8 fall back to showing just the icon; the URL stays hidden
# behind the BEL-terminated sequence either way. Only shown when the daemon
# is up — otherwise clicking it would land on nothing.
if [ "$DAEMON_RUNNING" = "true" ]; then
  DASHBOARD_LINK=$(osc8 "$DASHBOARD_URL" "🌐")
  LINE="$LINE | $DASHBOARD_LINK"
fi

# Resolve top notification icon by event kind
TOP_NOTIF_ICON=""
if [ -n "$TOP_NOTIF_KIND" ]; then
  case "$TOP_NOTIF_KIND" in
    run_failed|job_failed) TOP_NOTIF_ICON="🔴" ;;
    auto_execute_complete|run_completed) TOP_NOTIF_ICON="✅" ;;
    version_available) TOP_NOTIF_ICON="🆕" ;;
    plan_needs_review) TOP_NOTIF_ICON="👀" ;;
    observation_notable) TOP_NOTIF_ICON="👁️" ;;
    *) TOP_NOTIF_ICON="🔔" ;;
  esac
fi

# Line 2: thought (priority) > top notification. The notification message
# is wrapped in an OSC 8 hyperlink pointing at the deep-link computed by the
# status CLI (run_failed → /runs?highlight=<id>, plan_needs_review →
# /workspace?tab=planned&highlight=<id>, etc.) so a click lands on the
# specific item, not a generic list.
OUTPUT="$LINE"
if [ -n "$SHOW_THOUGHT" ]; then
  OUTPUT="$OUTPUT\n${CD}💭 ${SHOW_THOUGHT}${C0}"
elif [ -n "$TOP_NOTIF_MSG" ]; then
  NOTIF_TEXT="📬 ${TOP_NOTIF_ICON} ${TOP_NOTIF_MSG}"
  if [ -n "$TOP_NOTIF_PATH" ] && [ "$TOP_NOTIF_PATH" != "null" ]; then
    NOTIF_TEXT=$(osc8 "$DASHBOARD_URL$TOP_NOTIF_PATH" "$NOTIF_TEXT")
  fi
  OUTPUT="$OUTPUT\n$NOTIF_TEXT"
fi

# Line 3+: alerts (persistent, one per line)
for i in "${!ALERT_MESSAGES[@]}"; do
  AMSG="${ALERT_MESSAGES[$i]}"
  ASEV="${ALERT_SEVERITIES[$i]:-warning}"
  ASINCE="${ALERT_SINCES[$i]}"
  if [ "$ASEV" = "critical" ]; then
    AICON="🚨"
    ACOLOR="$CR"
  elif [ "$ASEV" = "warning" ]; then
    AICON="⚠️"
    ACOLOR="$CY"
  else
    AICON="ℹ️"
    ACOLOR="$CC"
  fi
  # Compute time ago from since timestamp
  AAGO=""
  if [ -n "$ASINCE" ] && [ "$ASINCE" != "null" ]; then
    A_TS=$(TZ=UTC date -j -f "%Y-%m-%dT%H:%M:%S" "${ASINCE%%.*}" "+%s" 2>/dev/null || date -u -d "$ASINCE" "+%s" 2>/dev/null || echo 0)
    NOW_TS=$(date +%s)
    A_ELAPSED=$(( NOW_TS - A_TS ))
    if [ "$A_ELAPSED" -ge 3600 ] 2>/dev/null; then
      AAGO=" ($(( A_ELAPSED / 3600 ))h ago)"
    elif [ "$A_ELAPSED" -ge 60 ] 2>/dev/null; then
      AAGO=" ($(( A_ELAPSED / 60 ))m ago)"
    fi
  fi
  AACKED="${ALERT_ACKED[$i]:-false}"
  if [ "$AACKED" = "true" ]; then
    OUTPUT="$OUTPUT\n${CD}${AICON} ${AMSG}${AAGO}${C0}"
  else
    OUTPUT="$OUTPUT\n${ACOLOR}${AICON} ${AMSG}${AAGO}${C0}"
  fi
done

echo -e "$OUTPUT"
echo -e "$OUTPUT" > "$CACHE_FILE"
