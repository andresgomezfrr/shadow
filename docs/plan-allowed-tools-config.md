# Plan: Configurable allowedTools for Shadow CLI invocations

## Context

Shadow spawns `claude --print` for jobs (heartbeat, suggest, reflect, runner). Each spawn needs `--allowedTools` to use MCP tools without permission prompts.

## Immediate

All Shadow CLI spawns include `--allowedTools "mcp__shadow__*"` by default. Shadow always has access to its own MCP tools.

## Future: user-configurable allowedTools

Add a config field (editable from dashboard /profile or via env var) that lists additional MCP tool patterns to allow:

```
SHADOW_ALLOWED_TOOLS=mcp__shadow__*,mcp__github__*,mcp__linear__*
```

Or in the dashboard profile page, a text field where the user adds patterns.

The CLI adapter reads this config and appends all patterns to `--allowedTools`.

This enables:
- Shadow creating PRs via GitHub MCP
- Shadow reading issues from Linear
- Shadow sending notifications via Slack MCP
- Any future MCP integration — user controls what Shadow can access

## Trust-gated access

At L2: only `mcp__shadow__*` (own tools)
At L3+: user-configured additional MCPs
At L4+: full allowedTools list

This aligns with the trust philosophy — Shadow earns access to external systems progressively.
