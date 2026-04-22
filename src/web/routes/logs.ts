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
 * Parse `[component:phase] rest of line` → { component, message }. Lines that
 * don't start with a bracketed prefix return { component: null, message: raw }.
 * Keeps the raw line around for the UI too (some users prefer raw over parsed).
 */
const PREFIX_RE = /^\[([^\]]+)\]\s*(.*)$/;

type LogLine = {
  lineNo: number;
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
    const q = params.get('q')?.trim().toLowerCase() ?? '';

    const { lines: raw, truncated, totalBytes } = tailLog(logPath, lines);

    // Parse + filter server-side so the wire payload is already narrowed and
    // the client doesn't do regex work on every render.
    const parsed: LogLine[] = [];
    const componentsSeen = new Set<string>();

    for (let i = 0; i < raw.length; i++) {
      const line = raw[i];
      const m = line.match(PREFIX_RE);
      const component = m ? m[1] : null;
      const message = m ? m[2] : line;
      if (component) componentsSeen.add(component);

      if (componentFilter && component !== componentFilter) continue;
      if (q && !line.toLowerCase().includes(q)) continue;

      parsed.push({
        lineNo: i,
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
      lines: parsed,
    }), true;
  }

  return false;
}
