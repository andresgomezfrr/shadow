/**
 * Pure helpers for `shadow uninstall`. Kept I/O-free so the filter logic
 * can be unit-tested with fixtures — a regression here silently nukes
 * unrelated hooks/statusLine entries from a user's settings.json.
 */

import { HOOK_SCRIPTS } from './hooks.js';

const SHADOW_HOOK_SUFFIXES = HOOK_SCRIPTS.filter(s => s !== 'statusline.sh');

type HookEntry = { command?: string };
type HookGroup = { hooks?: HookEntry[] };
type SettingsLike = Record<string, unknown> & {
  statusLine?: { command?: string } | unknown;
  hooks?: Record<string, HookGroup[]> | unknown;
  mcpServers?: Record<string, unknown> | unknown;
};

function isShadowHookCommand(command: unknown): boolean {
  if (typeof command !== 'string') return false;
  if (!command.includes('/.shadow/')) return false;
  return SHADOW_HOOK_SUFFIXES.some(s => command.endsWith(s));
}

function isShadowStatusLineCommand(command: unknown): boolean {
  return typeof command === 'string'
    && command.includes('/.shadow/')
    && command.endsWith('statusline.sh');
}

/**
 * Remove Shadow's statusLine, hook entries, and mcpServers.shadow from a
 * settings.json object — leaving any third-party entries untouched.
 *
 * Pure function: receives and returns a fresh object, never mutates the input.
 */
export function stripShadowFromSettings(input: SettingsLike): {
  settings: SettingsLike;
  touched: boolean;
  removed: string[];
} {
  const settings: SettingsLike = JSON.parse(JSON.stringify(input));
  const removed: string[] = [];
  let touched = false;

  // statusLine — only delete if it points at Shadow's script
  const statusLine = settings.statusLine as { command?: string } | undefined;
  if (statusLine && typeof statusLine === 'object' && isShadowStatusLineCommand(statusLine.command)) {
    delete settings.statusLine;
    removed.push('statusLine');
    touched = true;
  }

  // hooks — filter out Shadow's hook entries from each event, preserving
  // third-party entries. Drop the event key if it becomes empty; drop the
  // top-level `hooks` object if all events become empty.
  const hooks = settings.hooks;
  if (hooks && typeof hooks === 'object' && !Array.isArray(hooks)) {
    const hooksMap = hooks as Record<string, HookGroup[]>;
    for (const eventName of Object.keys(hooksMap)) {
      const groups = Array.isArray(hooksMap[eventName]) ? hooksMap[eventName] : [];
      const before = groups.length;
      const filtered = groups.filter(group => {
        const inner = Array.isArray(group?.hooks) ? group.hooks : [];
        return !inner.some(h => isShadowHookCommand(h?.command));
      });
      if (filtered.length === 0 && before > 0) {
        delete hooksMap[eventName];
        removed.push(`hooks.${eventName}`);
        touched = true;
      } else if (filtered.length !== before) {
        hooksMap[eventName] = filtered;
        removed.push(`hooks.${eventName} (partial)`);
        touched = true;
      }
    }
    if (Object.keys(hooksMap).length === 0) delete settings.hooks;
  }

  // mcpServers.shadow — legacy entry; newer installs use `claude mcp add`,
  // but older settings.json files may still have it.
  const mcpServers = settings.mcpServers;
  if (mcpServers && typeof mcpServers === 'object' && !Array.isArray(mcpServers)) {
    const mcpMap = mcpServers as Record<string, unknown>;
    if ('shadow' in mcpMap) {
      delete mcpMap.shadow;
      removed.push('mcpServers.shadow');
      touched = true;
      if (Object.keys(mcpMap).length === 0) delete settings.mcpServers;
    }
  }

  return { settings, touched, removed };
}

const SHADOW_SECTION_START = '<!-- SHADOW:START -->';
const SHADOW_SECTION_END = '<!-- SHADOW:END -->';

/**
 * Strip the `<!-- SHADOW:START --> … <!-- SHADOW:END -->` block from a
 * CLAUDE.md content string. Returns the cleaned content (with collapsed
 * blank lines + trailing newline) and whether anything was removed.
 */
export function stripShadowSectionFromClaudeMd(content: string): {
  content: string;
  removed: boolean;
} {
  const startIdx = content.indexOf(SHADOW_SECTION_START);
  const endIdx = content.indexOf(SHADOW_SECTION_END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    return { content, removed: false };
  }
  const cleaned = (content.slice(0, startIdx) + content.slice(endIdx + SHADOW_SECTION_END.length))
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd() + '\n';
  return { content: cleaned, removed: true };
}
