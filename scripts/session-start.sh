#!/bin/bash
# Shadow SessionStart hook — injects personality and context
# Portable version for plugin distribution
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SHADOW_ROOT="$(dirname "$SCRIPT_DIR")"
exec npx tsx "$SHADOW_ROOT/src/cli.ts" mcp-context 2>/dev/null
