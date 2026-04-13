#!/bin/bash
# Shadow SessionStart hook — injects personality and context
SHADOW_BIN="$(command -v shadow 2>/dev/null || echo "$HOME/.shadow/bin/shadow")"
if [ -x "$SHADOW_BIN" ]; then
  exec "$SHADOW_BIN" mcp-context 2>/dev/null
else
  SHADOW_DIR="${SHADOW_DEV_DIR:-$HOME/workspace/shadow}"
  TSX="$SHADOW_DIR/node_modules/.bin/tsx"
  if [ ! -x "$TSX" ]; then TSX="npx --prefix $SHADOW_DIR tsx"; fi
  exec $TSX "$SHADOW_DIR/src/cli.ts" mcp-context 2>/dev/null
fi
