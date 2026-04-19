#!/bin/bash
# Shadow StopFailure hook — captures API errors with heuristic triage
# shadow-stop-failure-version: 2
INPUT=$(cat)
TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
SHADOW_DATA="${SHADOW_DATA_DIR:-$HOME/.shadow}"

# Heuristic triage: scan recent daemon stderr for known error patterns.
# Ordered most-specific first — first match wins. Falls back to "unknown"
# when no pattern matches (preserves prior behavior as a baseline).
ERROR_TYPE="unknown"
STDERR_LOG="$SHADOW_DATA/daemon.stderr.log"
if [ -f "$STDERR_LOG" ]; then
  TAIL=$(tail -50 "$STDERR_LOG" 2>/dev/null)
  if echo "$TAIL" | grep -qiE '401|unauthorized|invalid.*api.?key'; then
    ERROR_TYPE="auth"
  elif echo "$TAIL" | grep -qiE '429|rate.?limit|quota.*exceeded'; then
    ERROR_TYPE="rate_limit"
  elif echo "$TAIL" | grep -qiE 'timeout|deadline.?exceeded|ETIMEDOUT'; then
    ERROR_TYPE="timeout"
  elif echo "$TAIL" | grep -qiE 'ECONNREFUSED|ENOTFOUND|network.*error|EHOSTUNREACH'; then
    ERROR_TYPE="network"
  elif echo "$TAIL" | grep -qiE '50[0-9]|gateway|overloaded'; then
    ERROR_TYPE="server"
  elif echo "$TAIL" | grep -qiE 'out of memory|heap.*out|OOM'; then
    ERROR_TYPE="oom"
  fi
fi

LINE=$(echo "$INPUT" | jq -c --arg ts "$TS" --arg et "$ERROR_TYPE" '
  { ts: $ts, event: "stop_failure", session: .session_id, error_type: $et, cwd: .cwd }
' 2>/dev/null)

if [ -n "$LINE" ] && [ "$LINE" != "null" ]; then
  echo "$LINE" >> "$SHADOW_DATA/events.jsonl"
fi
