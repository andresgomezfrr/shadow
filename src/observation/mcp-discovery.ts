import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

export type McpServerInfo = {
  name: string;
  command?: string;
  args?: string[];
  url?: string;
  type?: 'stdio' | 'http' | 'sse' | 'managed';
};

/**
 * Discover available MCP servers from Claude's config files.
 * Reads both ~/.claude/settings.json and ~/.claude.json (managed servers).
 * Excludes 'shadow' (our own server) from the list.
 */
function discoverMcpServers(): McpServerInfo[] {
  const servers = new Map<string, McpServerInfo>();

  // Source 1: ~/.claude/settings.json (local/stdio servers)
  const settingsPath = resolve(homedir(), '.claude', 'settings.json');
  try {
    const raw = readFileSync(settingsPath, 'utf8');
    const settings = JSON.parse(raw) as { mcpServers?: Record<string, { command?: string; args?: string[] }> };
    if (settings.mcpServers && typeof settings.mcpServers === 'object') {
      for (const [name, config] of Object.entries(settings.mcpServers)) {
        if (name.toLowerCase() !== 'shadow') {
          servers.set(name, { name, command: config.command, args: config.args, type: 'stdio' });
        }
      }
    }
  } catch { /* ignore */ }

  // Source 2: ~/.claude.json (user HTTP servers + claude.ai managed servers)
  const claudeJsonPath = resolve(homedir(), '.claude.json');
  try {
    const raw = readFileSync(claudeJsonPath, 'utf8');
    const config = JSON.parse(raw) as {
      mcpServers?: Record<string, { type?: string; url?: string; command?: string; args?: string[] }>;
      claudeAiMcpEverConnected?: string[];
    };
    // User-configured HTTP servers
    if (config.mcpServers && typeof config.mcpServers === 'object') {
      for (const [name, srv] of Object.entries(config.mcpServers)) {
        if (name.toLowerCase() !== 'shadow' && !servers.has(name)) {
          servers.set(name, {
            name, command: srv.command, args: srv.args, url: srv.url,
            type: srv.type === 'sse' ? 'sse' : srv.url ? 'http' : srv.command ? 'stdio' : undefined,
          });
        }
      }
    }
    // Claude.ai managed servers (no command/args — they're platform-hosted)
    if (Array.isArray(config.claudeAiMcpEverConnected)) {
      for (const name of config.claudeAiMcpEverConnected) {
        if (typeof name === 'string' && !servers.has(name)) {
          servers.set(name, { name, type: 'managed' });
        }
      }
    }
  } catch { /* ignore */ }

  return Array.from(servers.values());
}

/**
 * Get full details of available MCP servers (excluding shadow).
 */
export function discoverMcpServersDetailed(): McpServerInfo[] {
  return discoverMcpServers();
}

/**
 * Get just the names of available MCP servers (excluding shadow).
 */
export function discoverMcpServerNames(): string[] {
  return discoverMcpServers().map(s => s.name);
}
