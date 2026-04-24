import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import type { Command } from 'commander';
import type { ShadowConfig } from '../config/load-config.js';

// Claude Code reads this file and renders `statusLine.command` on every prompt.
const SETTINGS_PATH = resolve(homedir(), '.claude', 'settings.json');

type Settings = Record<string, unknown> & {
  statusLine?: { type?: string; command?: string };
};

function readSettings(): Settings {
  if (!existsSync(SETTINGS_PATH)) return {};
  try {
    return JSON.parse(readFileSync(SETTINGS_PATH, 'utf8')) as Settings;
  } catch {
    return {};
  }
}

function writeSettings(settings: Settings): void {
  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n', 'utf8');
}

export function registerStatuslineCommand(program: Command, config: ShadowConfig): void {
  const statusline = program
    .command('statusline')
    .description('enable, disable, or inspect the Claude Code status line')
    .action(() => {
      const settings = readSettings();
      const current = settings.statusLine?.command;
      if (current) {
        console.log(`statusline: enabled`);
        console.log(`  command: ${current}`);
      } else {
        console.log('statusline: disabled');
      }
      console.log(`  settings: ${SETTINGS_PATH}`);
    });

  statusline
    .command('enable')
    .description('register Shadow\'s status line in ~/.claude/settings.json')
    .action(() => {
      const scriptPath = resolve(config.resolvedDataDir, 'statusline.sh');
      if (!existsSync(scriptPath)) {
        console.error(`statusline script not found at ${scriptPath} — run 'shadow init' first`);
        process.exitCode = 1;
        return;
      }
      const settings = readSettings();
      settings.statusLine = { type: 'command', command: scriptPath };
      writeSettings(settings);
      console.log(`statusline: enabled → ${scriptPath}`);
    });

  statusline
    .command('disable')
    .description('remove the status line entry from ~/.claude/settings.json (hooks stay)')
    .action(() => {
      const settings = readSettings();
      if (!settings.statusLine) {
        console.log('statusline: already disabled');
        return;
      }
      delete settings.statusLine;
      writeSettings(settings);
      console.log('statusline: disabled');
    });
}
