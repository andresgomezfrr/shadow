#!/usr/bin/env node

import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDatabase } from './storage/index.js';
import { printOutput } from './cli/output.js';
import { loadConfig } from './config/load-config.js';
import type { ShadowDatabase } from './storage/index.js';

import { registerInitCommand } from './cli/cmd-init.js';
import { registerEntityCommands } from './cli/cmd-entities.js';
import { registerKnowledgeCommands } from './cli/cmd-knowledge.js';
import { registerDaemonCommands } from './cli/cmd-daemon.js';
import { registerProfileCommands } from './cli/cmd-profile.js';
import { registerMiscCommands } from './cli/cmd-misc.js';
import { registerTaskCommands } from './cli/cmd-tasks.js';
import { registerDocsCommands } from './cli/cmd-docs.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJsonPath = join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version: string; description: string };

const program = new Command();
const config = loadConfig();

program
  .name('shadow')
  .description(packageJson.description)
  .version(packageJson.version, '-v, --version', 'print version')
  .option('--json', 'output structured json where supported', false);

const withDb = async <T>(handler: (db: ShadowDatabase, json: boolean) => Promise<T> | T) => {
  const db = createDatabase(config);
  try {
    const json = Boolean(program.opts().json);
    const result = await handler(db, json);
    if (result !== undefined) {
      printOutput(result, json);
    }
  } finally {
    db.close();
  }
};

registerInitCommand(program, config, withDb);
registerProfileCommands(program, config, withDb);
registerEntityCommands(program, config, withDb);
registerKnowledgeCommands(program, config, withDb);
registerDaemonCommands(program, config, withDb);
registerMiscCommands(program, config, withDb);
registerTaskCommands(program, config, withDb);
registerDocsCommands(program);

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
