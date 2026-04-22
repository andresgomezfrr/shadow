import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, statSync, readFileSync, openSync, readSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ShadowDatabase } from '../../storage/database.js';
import type { DaemonSharedState } from '../../daemon/job-handlers.js';
import { json } from '../helpers.js';
import { loadConfig } from '../../config/load-config.js';

const LINES_DEFAULT = 500;
const LINES_MAX = 5000;

function clampLines(raw: string | null): number {
  if (raw == null) return LINES_DEFAULT;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return LINES_DEFAULT;
  return Math.min(n, LINES_MAX);
}

/**
 * Parse `LEVEL [component] rest of line` → { level, component, message }.
 * Level is one of ERROR | WARN | INFO when emitted by src/log.ts. Lines that
 * lack a level prefix (legacy entries written before log.ts gained level
 * prefixes, or raw console.* not yet migrated) are still parsed for
 * [component] alone with level=null. Lines with neither return
 * { level: null, component: null, message: raw }.
 */
const TIMESTAMP_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)\s+(.*)$/;
const LEVEL_PREFIX_RE = /^(ERROR|WARN|INFO)\s+(.*)$/;
const COMPONENT_RE = /^\[([^\]]+)\]\s*(.*)$/;

type LogLevel = 'ERROR' | 'WARN' | 'INFO' | null;

type LogLine = {
  lineNo: number;
  timestamp: string | null;
  level: LogLevel;
  component: string | null;
  message: string;
  raw: string;
};

/**
 * Tail the last N lines of `~/.shadow/daemon.stderr.log`. Reads the whole file
 * into memory and slices — acceptable for current log sizes (~400KB / 6500
 * lines). If it ever reaches tens of MB, swap for seek-from-end chunk reading.
 * Hard cap at 8MB to keep memory bounded even if the log grows unexpectedly.
 */
function tailLog(logPath: string, lineCount: number): { lines: string[]; truncated: boolean; totalBytes: number } {
  if (!existsSync(logPath)) return { lines: [], truncated: false, totalBytes: 0 };
  const stat = statSync(logPath);
  const MAX_BYTES = 8 * 1024 * 1024;
  const truncated = stat.size > MAX_BYTES;
  // When truncated, still read just the tail 8MB via a raw buffer slice.
  const raw = truncated
    ? readLastBytes(logPath, MAX_BYTES)
    : readFileSync(logPath, 'utf8');
  const allLines = raw.split('\n');
  // Drop the final empty line that split yields when the file ends with \n.
  if (allLines.length > 0 && allLines[allLines.length - 1] === '') allLines.pop();
  const lines = allLines.slice(-lineCount);
  return { lines, truncated, totalBytes: stat.size };
}

function readLastBytes(path: string, bytes: number): string {
  const fd = openSync(path, 'r');
  try {
    const size = statSync(path).size;
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    return buf.toString('utf8');
  } finally {
    closeSync(fd);
  }
}

export async function handleLogsRoutes(
  req: IncomingMessage, res: ServerResponse,
  pathname: string, params: URLSearchParams,
  _db: ShadowDatabase,
  _daemonState?: DaemonSharedState,
): Promise<boolean> {

  if (req.method === 'GET' && pathname === '/api/logs') {
    const config = loadConfig();
    const logPath = resolve(config.resolvedDataDir, 'daemon.stderr.log');

    const lines = clampLines(params.get('lines'));
    const componentFilter = params.get('component')?.trim() ?? '';
    const levelFilterRaw = params.get('level')?.trim().toUpperCase() ?? '';
    const levelFilter: LogLevel = (levelFilterRaw === 'ERROR' || levelFilterRaw === 'WARN' || levelFilterRaw === 'INFO')
      ? levelFilterRaw
      : null;
    const q = params.get('q')?.trim().toLowerCase() ?? '';

    const { lines: raw, truncated, totalBytes } = tailLog(logPath, lines);

    // Parse + filter server-side so the wire payload is already narrowed and
    // the client doesn't do regex work on every render.
    const parsed: LogLine[] = [];
    const componentsSeen = new Set<string>();
    const levelCounts: Record<'ERROR' | 'WARN' | 'INFO' | 'unknown', number> = {
      ERROR: 0, WARN: 0, INFO: 0, unknown: 0,
    };

    for (let i = 0; i < raw.length; i++) {
      const line = raw[i];

      // Three independent prefixes applied in order: ISO timestamp (post-
      // log.ts v2), LEVEL (post-log.ts v1), and [component] (most call
      // sites). A line can carry any subset or none of them.
      let timestamp: string | null = null;
      let level: LogLevel = null;
      let component: string | null = null;
      let rest = line;
      const tsMatch = rest.match(TIMESTAMP_RE);
      if (tsMatch) {
        timestamp = tsMatch[1];
        rest = tsMatch[2];
      }
      const levelMatch = rest.match(LEVEL_PREFIX_RE);
      if (levelMatch) {
        level = levelMatch[1] as LogLevel;
        rest = levelMatch[2];
      }
      const compMatch = rest.match(COMPONENT_RE);
      if (compMatch) {
        component = compMatch[1];
        rest = compMatch[2];
      }
      const message = rest;

      if (component) componentsSeen.add(component);
      if (level) levelCounts[level]++;
      else levelCounts.unknown++;

      if (componentFilter && component !== componentFilter) continue;
      if (levelFilter && level !== levelFilter) continue;
      if (q && !line.toLowerCase().includes(q)) continue;

      parsed.push({
        lineNo: i,
        timestamp,
        level,
        component,
        message,
        raw: line,
      });
    }

    return json(res, {
      logPath,
      totalBytes,
      truncated,
      linesRequested: lines,
      linesReturned: parsed.length,
      linesScanned: raw.length,
      components: [...componentsSeen].sort(),
      levelCounts,
      lines: parsed,
    }), true;
  }

  return false;
}
