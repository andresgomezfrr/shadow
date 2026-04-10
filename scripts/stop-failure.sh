#!/bin/bash
# Shadow StopFailure hook — captures API errors
INPUT=$(cat)
TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
SHADOW_DATA="${SHADOW_DATA_DIR:-$HOME/.shadow}"

LINE=$(echo "$INPUT" | jq -c --arg ts "$TS" '
  { ts: $ts, event: "stop_failure", session: .session_id, error_type: (.error_type // "unknown"), cwd: .cwd }
' 2>/dev/null)

if [ -n "$LINE" ] && [ "$LINE" != "null" ]; then
  echo "$LINE" >> "$SHADOW_DATA/events.jsonl"
fi
