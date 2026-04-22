#!/bin/bash
# shadow-hook-version: __SHADOW_VERSION__
# Shadow SubagentStart hook — tracks subagent spawns.
# Extended per audit H-02 to capture subagent_type/description/model from the
# Agent tool call that triggered this hook. Fields missing in payload fall
# back to null gracefully (jq `//` + `// empty`).
INPUT=$(cat)
TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
SHADOW_DATA="${SHADOW_DATA_DIR:-$HOME/.shadow}"

LINE=$(echo "$INPUT" | jq -c --arg ts "$TS" '
  {
    ts: $ts,
    event: "subagent_start",
    session: .session_id,
    cwd: .cwd,
    subagent_type: (.tool_input.subagent_type // null),
    description: (.tool_input.description // null),
    model: (.tool_input.model // null),
    prompt_preview: ((.tool_input.prompt // "") | .[0:200])
  }
' 2>/dev/null)

if [ -n "$LINE" ] && [ "$LINE" != "null" ]; then
  echo "$LINE" >> "$SHADOW_DATA/events.jsonl"
fi
