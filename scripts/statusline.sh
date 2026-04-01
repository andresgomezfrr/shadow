#!/bin/bash
# Shadow status line for Claude Code — portable version
# Shows Shadow's current state with emojis

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SHADOW_ROOT="$(dirname "$SCRIPT_DIR")"
SHADOW_CLI="npx tsx $SHADOW_ROOT/src/cli.ts"
SHADOW_DATA="${SHADOW_DATA_DIR:-$HOME/.shadow}"
CACHE_FILE="$SHADOW_DATA/statusline-cache.txt"
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
STATUS=$($SHADOW_CLI --json status 2>/dev/null | tr -d '\n ')
if [ $? -ne 0 ] || [ -z "$STATUS" ]; then
  echo "Shadow"
  exit 0
fi

# Parse fields
TRUST=$(echo "$STATUS" | grep -o '"trustLevel":[0-9]*' | head -1 | cut -d: -f2)
SUGGESTIONS=$(echo "$STATUS" | grep -o '"pendingSuggestions":[0-9]*' | head -1 | cut -d: -f2)
EVENTS=$(echo "$STATUS" | grep -o '"pendingEvents":[0-9]*' | head -1 | cut -d: -f2)
FOCUS=$(echo "$STATUS" | grep -o '"focusMode":"[^"]*"' | head -1 | cut -d'"' -f4)
DAEMON_RUNNING=$(echo "$STATUS" | grep -o '"running":[a-z]*' | head -1 | cut -d: -f2)
HEARTBEAT_PHASE=$(echo "$STATUS" | grep -o '"lastHeartbeatPhase":"[^"]*"' | head -1 | cut -d'"' -f4)
RECENT_ACTIVITY=$(echo "$STATUS" | grep -o '"recentActivity":[0-9]*' | head -1 | cut -d: -f2)
TOKENS=$(echo "$STATUS" | grep -o '"todayTokens":[0-9]*' | head -1 | cut -d: -f2)

# Trust emoji
case "$TRUST" in
  1) TEMOJI="👀" ;;
  2) TEMOJI="💬" ;;
  3) TEMOJI="🤝" ;;
  4) TEMOJI="⚡️" ;;
  5) TEMOJI="🌑" ;;
  *) TEMOJI="👀" ;;
esac

# Activity emoji + text
ACTIVITY_EMOJI=""
ACTIVITY_TEXT=""

if [ "$FOCUS" = "focus" ]; then
  ACTIVITY_EMOJI="🎯"
  ACTIVITY_TEXT="focus"
elif [ -n "$HEARTBEAT_PHASE" ] && [ "$HEARTBEAT_PHASE" != "null" ] && [ "$HEARTBEAT_PHASE" != "idle" ]; then
  case "$HEARTBEAT_PHASE" in
    *observe*) ACTIVITY_EMOJI="👀"; ACTIVITY_TEXT="observing" ;;
    *analyze*) ACTIVITY_EMOJI="🧠"; ACTIVITY_TEXT="analyzing" ;;
    *suggest*) ACTIVITY_EMOJI="💡"; ACTIVITY_TEXT="thinking" ;;
    *consolidat*) ACTIVITY_EMOJI="📦"; ACTIVITY_TEXT="consolidating" ;;
    *notify*) ACTIVITY_EMOJI="📢"; ACTIVITY_TEXT="notifying" ;;
    *) ACTIVITY_EMOJI="⚙️"; ACTIVITY_TEXT="working" ;;
  esac
elif [ "$RECENT_ACTIVITY" -gt 5 ] 2>/dev/null; then
  ACTIVITY_EMOJI="📝"; ACTIVITY_TEXT="learning"
elif [ "$RECENT_ACTIVITY" -gt 0 ] 2>/dev/null; then
  ACTIVITY_EMOJI="👀"; ACTIVITY_TEXT="watching"
elif [ "$DAEMON_RUNNING" = "true" ]; then
  ACTIVITY_EMOJI="😊"; ACTIVITY_TEXT="ready"
else
  ACTIVITY_EMOJI="😴"; ACTIVITY_TEXT="sleeping"
fi

# Build line
LINE="$ACTIVITY_EMOJI Shadow $ACTIVITY_TEXT $TEMOJI"

if [ "$SUGGESTIONS" -gt 0 ] 2>/dev/null; then
  LINE="$LINE | 💡$SUGGESTIONS"
fi
if [ "$EVENTS" -gt 0 ] 2>/dev/null; then
  LINE="$LINE | 📬$EVENTS"
fi
if [ "$TOKENS" -gt 1000 ] 2>/dev/null; then
  KTOKENS=$(( TOKENS / 1000 ))
  LINE="$LINE | ${KTOKENS}k tok"
fi

echo "$LINE"
echo "$LINE" > "$CACHE_FILE"
