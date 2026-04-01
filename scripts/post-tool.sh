#!/bin/bash
# Shadow PostToolUse hook — logs tool usage for auto-learning
# Portable version for plugin distribution
INPUT=$(cat)
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
TOOL_NAME=$(echo "$INPUT" | grep -o '"tool_name":"[^"]*"' | head -1 | cut -d'"' -f4)
FILE_PATH=$(echo "$INPUT" | grep -o '"file_path":"[^"]*"' | head -1 | cut -d'"' -f4)
COMMAND=$(echo "$INPUT" | grep -o '"command":"[^"]*"' | head -1 | cut -d'"' -f4 | head -c 200)

SHADOW_DATA="${SHADOW_DATA_DIR:-$HOME/.shadow}"

if [ -n "$TOOL_NAME" ]; then
  echo "{\"ts\":\"$TIMESTAMP\",\"tool\":\"$TOOL_NAME\",\"file\":\"$FILE_PATH\",\"cmd\":\"$COMMAND\"}" >> "$SHADOW_DATA/interactions.jsonl"
fi
