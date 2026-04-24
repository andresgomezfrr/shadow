#!/usr/bin/env node

import { Command } from 'commander';
import { spawnSync } from 'node:child_process';
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
import { registerStatuslineCommand } from './cli/cmd-statusline.js';
import { registerTaskCommands } from './cli/cmd-tasks.js';
import { registerDocsCommands } from './cli/cmd-docs.js';
import { log } from './log.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJsonPath = join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version: string; description: string };

const program = new Command();
const config = loadConfig();

program
  .name('shadow')
  .description(
    `${packageJson.description}\n\n` +
    `Bare "shadow" spawns an interactive Claude session with Shadow's soul\n` +
    `pre-loaded as the append-system-prompt. Use "shadow -- <args>" to pass\n` +
    `flags through to claude (e.g. "shadow -- --resume <id>").`,
  )
  .version(packageJson.version, '-v, --version', 'print version')
  .option('--json', 'output structured json where supported', false);

// Bare `shadow` → spawn Claude interactive with soul in --append-system-prompt.
// Audit P-12 + user-facing complement: all Shadow-initiated Claude sessions
// (daemon runner + user interactive) carry persona via system prompt rather
// than user-prompt concatenation. Zero interference with `claude` bare (which
// keeps using the SessionStart hook to inject soul). Scripts detect the
// wrapper via SHADOW_INTERACTIVE=1 env and skip duplicate injection.
//
// Passthrough to claude: anything after `--` in argv goes to the child
// unparsed. Shadow never touches those tokens — opaque-by-design so this
// wrapper stays immune to Claude CLI flag renames. Variadic argument
// declaration + allowUnknownOption + allowExcessArguments so Commander
// accepts arbitrary trailing tokens without erroring.
//
// Unknown subcommand handling: Commander would otherwise route any unknown
// first token (e.g. `shadow noexiste`) into this bare action and silently
// open Claude with the typo as a Claude argument. We guard against that by
// rejecting any positional token that arrives before `--` — if you wanted
// passthrough, you would have used `shadow -- <args>` explicitly.
program
  .argument('[claudeArgs...]', 'arguments passed to claude after --')
  .allowUnknownOption()
  .allowExcessArguments()
  .action((claudeArgsBefore: string[]) => {
    const dashIdx = process.argv.indexOf('--');
    const hasDashSeparator = dashIdx >= 0;
    const claudeArgs = hasDashSeparator ? process.argv.slice(dashIdx + 1) : [];

    // Tokens collected before `--` are a typo / unknown subcommand. Reject
    // with help so users discover the real surface instead of accidentally
    // launching Claude with garbage.
    if (!hasDashSeparator && claudeArgsBefore.length > 0) {
      const unknown = claudeArgsBefore[0];
      log.error(`Unknown command: ${unknown}\n`);
      program.outputHelp();
      process.exit(1);
    }

    const db = createDatabase(config);
    let soul: string;
    try {
      const soulMem = db.listMemories({ archived: false }).find((m) => m.kind === 'soul_reflection');
      soul = soulMem?.bodyMd
        ? `You are Shadow.\n\n${soulMem.bodyMd}`
        : 'You are Shadow — a digital engineering companion. Warm, informal, like a teammate.';
    } finally {
      db.close();
    }

    const args = ['--append-system-prompt', soul, ...claudeArgs];
    const result = spawnSync(config.claudeBin, args, {
      stdio: 'inherit',
      env: { ...process.env, SHADOW_INTERACTIVE: '1' },
    });
    process.exit(result.status ?? (result.signal ? 1 : 0));
  });

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
registerStatuslineCommand(program, config);
registerTaskCommands(program, config, withDb);
registerDocsCommands(program);

program.parseAsync(process.argv).catch((error: unknown) => {
  log.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
