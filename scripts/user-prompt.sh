#!/bin/bash
# Shadow UserPromptSubmit hook — captures what the user says (full text, no truncation)
INPUT=$(cat)
TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
SHADOW_DATA="${SHADOW_DATA_DIR:-$HOME/.shadow}"

LINE=$(echo "$INPUT" | jq -c --arg ts "$TS" '
  select(.prompt != null and .prompt != "") |
  { ts: $ts, role: "user", text: .prompt, session: .session_id, cwd: .cwd }
' 2>/dev/null)

if [ -n "$LINE" ] && [ "$LINE" != "null" ]; then
  echo "$LINE" >> "$SHADOW_DATA/conversations.jsonl"
fi
