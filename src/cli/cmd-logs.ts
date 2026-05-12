import type { Command } from 'commander';
import type { ShadowConfig } from '../config/load-config.js';
import { openSync, readSync, closeSync, statSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// `shadow tail` — print the latest daemon log lines with optional filter and
// follow mode. No external deps; ANSI escapes inline. Polls via fs.statSync
// every 500ms (more portable than fs.watch on macOS).

const LEVEL_RE = /\s(ERROR|WARN|INFO)\s/;
const COMPONENT_RE = /\[([^\]]+)\]/;

const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  gray: '\x1b[90m',
};

type Options = {
  lines?: number;
  type?: string;
  follow: boolean;
  color: boolean;
};

export function colorize(line: string, useColor: boolean): string {
  if (!useColor) return line;
  const m = LEVEL_RE.exec(line);
  if (!m) return ANSI.dim + line + ANSI.reset;
  const level = m[1];
  switch (level) {
    case 'ERROR': return ANSI.red + line + ANSI.reset;
    case 'WARN':  return ANSI.yellow + line + ANSI.reset;
    case 'INFO':  return line; // sin tinte para no saturar — INFO es el caso común
    default:      return line;
  }
}

export function matchesFilter(line: string, filter: string | undefined): boolean {
  if (!filter) return true;
  const m = COMPONENT_RE.exec(line);
  if (!m) return false;
  return m[1].includes(filter);
}

export function readLastLines(path: string, n: number): string[] {
  const content = readFileSync(path, 'utf-8');
  const allLines = content.split('\n');
  // Drop trailing empty line that comes from final newline
  if (allLines.length > 0 && allLines[allLines.length - 1] === '') allLines.pop();
  return allLines.slice(-n);
}

async function followLoop(path: string, options: Options): Promise<void> {
  let lastSize = statSync(path).size;
  // Tail loop: every 500ms check if file size grew; read the delta.
  // Note: handles `tail -f`-style follow for the common case; does NOT
  // handle log rotation (rename + truncate). Good enough for daemon.log.
  for (;;) {
    await new Promise((r) => setTimeout(r, 500));
    let stat;
    try { stat = statSync(path); }
    catch { continue; /* file briefly gone during rotation */ }

    if (stat.size === lastSize) continue;
    if (stat.size < lastSize) {
      // truncated — reset
      lastSize = 0;
    }
    const fd = openSync(path, 'r');
    const buf = Buffer.alloc(stat.size - lastSize);
    readSync(fd, buf, 0, buf.length, lastSize);
    closeSync(fd);
    lastSize = stat.size;
    const lines = buf.toString('utf-8').split('\n').filter((l) => l.length > 0);
    for (const line of lines) {
      if (!matchesFilter(line, options.type)) continue;
      process.stdout.write(colorize(line, options.color) + '\n');
    }
  }
}

export function registerLogsCommand(program: Command, config: ShadowConfig): void {
  program
    .command('tail')
    .description('tail the Shadow daemon log with optional filter and coloring')
    .option('--lines <n>', 'number of recent lines to print before following (default 50)', (v) => parseInt(v, 10))
    .option('--type <component>', 'filter to lines whose [component] tag contains this substring')
    .option('--no-follow', 'print last N lines and exit (do not stream new lines)')
    .option('--no-color', 'disable ANSI coloring')
    .action(async (options: { lines?: number; type?: string; follow?: boolean; color?: boolean }) => {
      const path = join(config.resolvedDataDir, 'daemon.log');
      if (!existsSync(path)) {
        process.stderr.write(`error: daemon log not found at ${path}\n`);
        process.stderr.write(`hint: start the daemon with \`shadow daemon start\`\n`);
        process.exit(2);
      }

      const opts: Options = {
        lines: options.lines ?? 50,
        type: options.type,
        follow: options.follow !== false,
        color: options.color !== false && process.stdout.isTTY,
      };

      // Initial dump of last N lines (filtered)
      const initial = readLastLines(path, opts.lines!);
      for (const line of initial) {
        if (!matchesFilter(line, opts.type)) continue;
        process.stdout.write(colorize(line, opts.color) + '\n');
      }

      if (!opts.follow) return;

      // Graceful shutdown on SIGINT/SIGTERM
      const shutdown = () => process.exit(0);
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);

      await followLoop(path, opts);
    });
}
