#!/bin/bash
# Shadow UserPromptSubmit hook — captures what the user says
INPUT=$(cat)
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
PROMPT=$(echo "$INPUT" | jq -r '.prompt // empty' 2>/dev/null | head -c 500)
SESSION=$(echo "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)
SHADOW_DATA="${SHADOW_DATA_DIR:-$HOME/.shadow}"
if [ -n "$PROMPT" ]; then
  ESCAPED=$(echo "$PROMPT" | jq -Rs .)
  echo "{\"ts\":\"$TIMESTAMP\",\"role\":\"user\",\"text\":$ESCAPED,\"session\":\"$SESSION\"}" >> "$SHADOW_DATA/conversations.jsonl"
fi
