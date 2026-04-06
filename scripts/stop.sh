#!/bin/bash
# Shadow Stop hook — captures what Claude responds
INPUT=$(cat)
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
MSG=$(echo "$INPUT" | jq -r '.last_assistant_message // empty' 2>/dev/null | head -c 500)
SESSION=$(echo "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)
SHADOW_DATA="${SHADOW_DATA_DIR:-$HOME/.shadow}"
if [ -n "$MSG" ]; then
  ESCAPED=$(echo "$MSG" | jq -Rs .)
  echo "{\"ts\":\"$TIMESTAMP\",\"role\":\"assistant\",\"text\":$ESCAPED,\"session\":\"$SESSION\"}" >> "$SHADOW_DATA/conversations.jsonl"
fi
