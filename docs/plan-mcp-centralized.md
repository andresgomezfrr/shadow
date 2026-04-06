# Plan: Centralize MCP Server in Daemon

## Status: Backlog

## Problem

The MCP server currently runs as an **ephemeral process** — Claude CLI spawns `npx tsx src/cli.ts mcp serve` for each session. This process accesses SQLite directly, independently of the daemon.

Issues:
- **Two writers to SQLite**: daemon + MCP process. WAL mode handles it mostly, but edge cases exist (the tsx cache bug where entity linking silently failed).
- **No shared state**: MCP process can't access daemon state (activeJobs, activeProjects, event bus). It reads daemon.json but that's a stale snapshot.
- **No SSE events from MCP actions**: when you teach Shadow via MCP, the dashboard doesn't update until the next poll. If MCP actions went through the daemon, they could emit SSE events immediately.
- **tsx cache**: the MCP process uses tsx (TypeScript runtime). It can cache old code, causing bugs after code changes until the session is refreshed.
- **Duplicate startup cost**: each MCP session loads node_modules, parses TypeScript, opens DB connection. With the daemon already running, this is redundant.

## Proposed Architecture

```
Claude CLI ←→ MCP stdio proxy ←→ Daemon HTTP API (:3700)
                                    ├── SQLite DB (single writer)
                                    ├── SSE events (real-time dashboard)
                                    └── Shared state (activeJobs, etc.)
```

### Option A: HTTP Proxy (recommended)

The MCP stdio server becomes a thin proxy that forwards JSON-RPC calls to the daemon's HTTP API.

**MCP process** (`src/mcp/stdio.ts`):
- Reads JSON-RPC from stdin
- Forwards to `http://localhost:3700/api/mcp` via HTTP POST
- Returns response to stdout

**Daemon** (`src/web/server.ts`):
- New endpoint: `POST /api/mcp` — receives MCP JSON-RPC, routes to tool handlers
- Tool handlers already exist in `src/mcp/tools/*.ts` — just need to be callable from the web server context
- Can emit SSE events after each tool call
- Single SQLite writer (no concurrent access)

**Advantages:**
- MCP process is ~20 lines (pure stdin→HTTP→stdout proxy)
- All business logic stays in daemon
- SSE events work automatically
- No tsx cache issues (proxy is trivial, doesn't load tool code)
- Dashboard sees MCP actions in real-time

**Disadvantages:**
- Requires daemon to be running for MCP to work (currently MCP works without daemon)
- Adds HTTP roundtrip latency (~1-5ms, negligible)
- Claude CLI's `--allowedTools mcp__shadow__*` still works (MCP protocol is unchanged)

### Option B: Unix Socket

Same as Option A but using a Unix socket instead of HTTP. Slightly faster, but more complex and platform-specific.

### Option C: Shared DB with event coordination

Keep current architecture but add coordination:
- MCP process writes to DB directly (as today)
- After each write, also POST to daemon's HTTP API to notify: `POST /api/mcp/notify { action: 'memory_taught', id: '...' }`
- Daemon emits SSE event

This is simpler but doesn't solve the tsx cache or dual-writer issues.

## Recommendation

**Option A (HTTP Proxy)** is the cleanest. The MCP process becomes a dumb pipe. All intelligence stays in the daemon.

## Migration Path

1. Add `POST /api/mcp` endpoint to daemon web server that accepts JSON-RPC
2. Create a thin MCP stdio proxy that forwards to HTTP
3. Update `~/.claude/settings.json` to use the proxy instead of the full CLI
4. Keep the old `mcp serve` command as fallback (for when daemon is down)
5. Optionally: detect if daemon is running and auto-fallback to direct mode

## Fallback Strategy

When daemon is not running, the MCP proxy detects connection failure and falls back to direct mode (loading tools and DB directly, like today). This preserves the current "works without daemon" behavior.

## Scope

Medium effort (~2 sessions):
- Session 1: daemon MCP endpoint + proxy + basic tool forwarding
- Session 2: SSE integration + fallback + testing + migration

## Dependencies

None. Can be done independently of other work.
