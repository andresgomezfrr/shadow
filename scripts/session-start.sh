#!/bin/bash
# shadow-hook-version: __SHADOW_VERSION__
# Shadow SessionStart hook — injects personality and context.
# Skipped when Shadow spawned Claude itself (SHADOW_INTERACTIVE=1 set by the
# `shadow` bare wrapper, SHADOW_JOB=1 set by daemon spawns): those paths
# already carry the soul via --append-system-prompt, so re-injecting here
# would duplicate context and burn tokens (audit P-12).
if [ "$SHADOW_INTERACTIVE" = "1" ] || [ "$SHADOW_JOB" = "1" ]; then
  exit 0
fi
SHADOW_BIN="$(command -v shadow 2>/dev/null || echo "$HOME/.shadow/bin/shadow")"
if [ -x "$SHADOW_BIN" ]; then
  exec "$SHADOW_BIN" mcp-context 2>/dev/null
else
  SHADOW_DIR="${SHADOW_DEV_DIR:-$HOME/workspace/shadow}"
  TSX="$SHADOW_DIR/node_modules/.bin/tsx"
  if [ ! -x "$TSX" ]; then TSX="npx --prefix $SHADOW_DIR tsx"; fi
  exec $TSX "$SHADOW_DIR/src/cli.ts" mcp-context 2>/dev/null
fi
