#!/bin/bash
# shadow-hook-version: __SHADOW_VERSION__
# Shadow PostToolUse hook — logs tool usage with rich detail
# Portable version for plugin distribution
[ "$SHADOW_JOB" = "1" ] && exit 0
INPUT=$(cat)
TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
SHADOW_DATA="${SHADOW_DATA_DIR:-$HOME/.shadow}"

LINE=$(echo "$INPUT" | jq -c --arg ts "$TS" '
  .tool_name as $tool |
  .tool_input as $ti |
  (.tool_response // "") as $tr |
  ($ti.file_path // $ti.path // "") as $file |
  ($ti.command // "" | .[0:200]) as $cmd |
  (if $tool == "Edit" then
    { old_len: ($ti.old_string // "" | length), new_len: ($ti.new_string // "" | length) }
  elif $tool == "Write" then
    { content_len: ($ti.content // "" | length) }
  elif $tool == "Read" then
    { lines: ($ti.limit // "full") }
  elif $tool == "Bash" then
    { output: (if ($tr | type) == "string" then ($tr | .[0:800]) else ($tr | tojson | .[0:800]) end) }
  elif $tool == "Grep" then
    { pattern: ($ti.pattern // ""), matches: (if ($tr | type) == "string" then ($tr | split("\n") | map(select(. != "")) | length) else 0 end) }
  elif $tool == "Glob" then
    { pattern: ($ti.pattern // ""), matches: (if ($tr | type) == "string" then ($tr | split("\n") | map(select(. != "")) | length) else 0 end) }
  elif $tool == "Agent" then
    { desc: ($ti.description // "" | .[0:200]) }
  elif $tool == "ToolSearch" then
    { query: ($ti.query // "") }
  else {} end) as $detail |
  { ts: $ts, tool: $tool, file: $file, cmd: $cmd, session: .session_id, cwd: .cwd }
  + (if ($detail | length) > 0 then { detail: $detail } else {} end)
' 2>/dev/null)

if [ -n "$LINE" ] && [ "$LINE" != "null" ]; then
  echo "$LINE" >> "$SHADOW_DATA/interactions.jsonl"
fi
