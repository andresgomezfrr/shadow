import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

export type McpServerInfo = {
  name: string;
  command?: string;
  args?: string[];
};

/**
 * Discover available MCP servers from Claude's settings.json.
 * Excludes 'shadow' (our own server) from the list.
 */
export function discoverMcpServers(): McpServerInfo[] {
  const settingsPath = resolve(homedir(), '.claude', 'settings.json');
  try {
    const raw = readFileSync(settingsPath, 'utf8');
    const settings = JSON.parse(raw) as { mcpServers?: Record<string, { command?: string; args?: string[] }> };
    if (!settings.mcpServers || typeof settings.mcpServers !== 'object') return [];

    return Object.entries(settings.mcpServers)
      .filter(([name]) => name.toLowerCase() !== 'shadow')
      .map(([name, config]) => ({
        name,
        command: config.command,
        args: config.args,
      }));
  } catch {
    return [];
  }
}

/**
 * Get just the names of available MCP servers (excluding shadow).
 */
export function discoverMcpServerNames(): string[] {
  return discoverMcpServers().map(s => s.name);
}
