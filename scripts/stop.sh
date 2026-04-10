#!/bin/bash
# Shadow Stop hook — captures what Claude responds (full text, no truncation)
INPUT=$(cat)
TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
SHADOW_DATA="${SHADOW_DATA_DIR:-$HOME/.shadow}"

LINE=$(echo "$INPUT" | jq -c --arg ts "$TS" '
  select(.last_assistant_message != null and .last_assistant_message != "") |
  { ts: $ts, role: "assistant", text: .last_assistant_message, session: .session_id, cwd: .cwd }
' 2>/dev/null)

if [ -n "$LINE" ] && [ "$LINE" != "null" ]; then
  echo "$LINE" >> "$SHADOW_DATA/conversations.jsonl"
fi
