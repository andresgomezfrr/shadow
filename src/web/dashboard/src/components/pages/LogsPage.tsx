import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchLogs } from '../../api/client';
import type { LogLine, LogLevel, LogsResponse } from '../../api/client';

/**
 * Tail view of the daemon stderr log (audit F-07). Polls /api/logs every
 * 2s when follow mode is on; one-shot otherwise. Component filter and text
 * search narrow server-side, so the wire payload stays small even for 5000
 * lines. Auto-scroll sticks to the bottom while follow mode is active; any
 * manual scroll-up pauses it until the user toggles back.
 */
export function LogsPage() {
  const [data, setData] = useState<LogsResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const [component, setComponent] = useState<string>('');
  const [level, setLevel] = useState<'' | 'ERROR' | 'WARN' | 'INFO'>('');
  const [q, setQ] = useState<string>('');
  const [linesRequested, setLinesRequested] = useState<number>(500);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetchLogs({
        lines: linesRequested,
        component: component || undefined,
        level: level || undefined,
        q: q || undefined,
      });
      setData(r);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [linesRequested, component, level, q]);

  // Initial load + reload when filters change.
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Poll when follow is on. 2s is a reasonable default for a local daemon
  // whose log emits handfuls of lines per minute; any noisier and we'd want SSE.
  useEffect(() => {
    if (!follow) return;
    const t = setInterval(refresh, 2_000);
    return () => clearInterval(t);
  }, [follow, refresh]);

  // Auto-scroll to bottom whenever new lines arrive AND follow is on.
  useEffect(() => {
    if (!follow) return;
    const el = viewportRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [data, follow]);

  const total = data?.lines.length ?? 0;
  const components = data?.components ?? [];
  const levelCounts = data?.levelCounts ?? { ERROR: 0, WARN: 0, INFO: 0, unknown: 0 };
  const activeFilters = Boolean(component || level || q);

  return (
    <div className="h-full flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold">Logs</h1>
          <p className="text-text-muted text-xs">
            {data
              ? <>tail of <code className="text-text-dim">{data.logPath}</code> · {formatBytes(data.totalBytes)}{data.truncated ? ' (head truncated — showing tail 8MB)' : ''}</>
              : 'loading…'}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={follow}
              onChange={(e) => setFollow(e.target.checked)}
              className="accent-accent"
            />
            <span className={follow ? 'text-accent' : 'text-text-muted'}>follow (2s)</span>
          </label>
          <button
            type="button"
            onClick={refresh}
            className="rounded border border-border/60 bg-border/20 hover:bg-border/40 px-2 py-1 text-text-dim"
            title="Refresh now"
          >refresh</button>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap text-xs">
        <div className="inline-flex items-center gap-1 rounded border border-border/60 bg-border/10 p-0.5">
          <LevelPill active={level === ''} onClick={() => setLevel('')}>
            all ({levelCounts.ERROR + levelCounts.WARN + levelCounts.INFO + levelCounts.unknown})
          </LevelPill>
          <LevelPill active={level === 'ERROR'} onClick={() => setLevel('ERROR')} className="text-red">
            error ({levelCounts.ERROR})
          </LevelPill>
          <LevelPill active={level === 'WARN'} onClick={() => setLevel('WARN')} className="text-amber-300">
            warn ({levelCounts.WARN})
          </LevelPill>
          <LevelPill active={level === 'INFO'} onClick={() => setLevel('INFO')} className="text-accent">
            info ({levelCounts.INFO})
          </LevelPill>
        </div>
        <select
          value={component}
          onChange={(e) => setComponent(e.target.value)}
          className="rounded border border-border/60 bg-border/10 px-2 py-1 text-text-dim"
          title="Filter by [component] prefix"
        >
          <option value="">all components ({components.length})</option>
          {components.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="search text…"
          className="rounded border border-border/60 bg-border/10 px-2 py-1 text-text-dim flex-1 min-w-[12rem]"
        />
        <select
          value={linesRequested}
          onChange={(e) => setLinesRequested(parseInt(e.target.value, 10))}
          className="rounded border border-border/60 bg-border/10 px-2 py-1 text-text-dim"
          title="Max lines to tail"
        >
          <option value={200}>200 lines</option>
          <option value={500}>500 lines</option>
          <option value={1000}>1000 lines</option>
          <option value={2000}>2000 lines</option>
          <option value={5000}>5000 lines</option>
        </select>
        {activeFilters && (
          <button
            type="button"
            onClick={() => { setComponent(''); setLevel(''); setQ(''); }}
            className="text-text-muted hover:text-accent underline"
          >clear filters</button>
        )}
        <span className="text-text-muted ml-auto">{total} shown / {data?.linesScanned ?? 0} scanned</span>
      </div>

      {err && (
        <div className="rounded border border-red/40 bg-red/10 p-2 text-xs text-red">
          failed to load logs — {err}
        </div>
      )}

      <div
        ref={viewportRef}
        className="flex-1 min-h-0 overflow-y-auto rounded border border-border/40 bg-black/30 font-mono text-[11px] leading-[1.55]"
      >
        {data && data.lines.length === 0 && (
          <div className="p-4 text-text-muted">
            {activeFilters ? 'no lines match filters' : 'log is empty'}
          </div>
        )}
        <div className="py-1">
          {data?.lines.map((line) => (
            <LogRow key={line.lineNo} line={line} />
          ))}
        </div>
      </div>
    </div>
  );
}

function LogRow({ line }: { line: LogLine }) {
  // Color-code the component prefix so lines from the same subsystem cluster
  // visually. Level gets its own fixed-width badge so the eye can scan down
  // the left column and catch ERROR rows at a glance. Timestamp rendered in
  // the user's local timezone for readability, ISO kept as tooltip.
  const color = componentColor(line.component);
  const rowBg = line.level === 'ERROR'
    ? 'bg-red/5 hover:bg-red/10'
    : line.level === 'WARN'
    ? 'bg-amber-500/5 hover:bg-amber-500/10'
    : 'hover:bg-border/10';
  return (
    <div className={`flex gap-2 px-3 ${rowBg}`}>
      <span className="text-text-muted/50 select-none shrink-0 w-10 text-right tabular-nums">{line.lineNo}</span>
      <TimestampCell iso={line.timestamp} />
      <LevelBadge level={line.level} />
      {line.component ? (
        <>
          <span className={`shrink-0 ${color}`}>[{line.component}]</span>
          <span className="text-text-dim whitespace-pre-wrap break-all">{line.message}</span>
        </>
      ) : (
        <span className="text-text-muted whitespace-pre-wrap break-all">{line.message || line.raw}</span>
      )}
    </div>
  );
}

function TimestampCell({ iso }: { iso: string | null }) {
  // Fixed-width column showing local MM-DD HH:MM:SS.mmm. The date prefix
  // disambiguates when the tail crosses day boundaries (which it does for
  // any non-trivial log retention). Full ISO with timezone in the tooltip
  // for unambiguous correlation with audit_events/db rows.
  if (!iso) {
    return <span className="shrink-0 w-[10.5rem] text-text-muted/40 tabular-nums">················</span>;
  }
  const d = new Date(iso);
  const MM = String(d.getMonth() + 1).padStart(2, '0');
  const DD = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return (
    <span
      className="shrink-0 w-[10.5rem] text-text-muted/70 tabular-nums"
      title={iso}
    >{MM}-{DD} {hh}:{mm}:{ss}.{ms}</span>
  );
}

function LevelBadge({ level }: { level: LogLevel }) {
  // Fixed-width 4-char badge so the [component] column after it aligns
  // across all rows regardless of level.
  const cls = level === 'ERROR'
    ? 'text-red'
    : level === 'WARN'
    ? 'text-amber-300'
    : level === 'INFO'
    ? 'text-accent'
    : 'text-text-muted/40';
  const text = level ?? '····';
  return (
    <span className={`shrink-0 w-12 font-semibold tabular-nums ${cls}`}>{text}</span>
  );
}

function LevelPill({ active, onClick, className, children }: { active: boolean; onClick: () => void; className?: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded px-1.5 py-0.5 text-[11px] transition-colors ${active ? 'bg-border/50 text-text-bright' : 'text-text-muted hover:bg-border/30'} ${className ?? ''}`}
    >{children}</button>
  );
}

/**
 * Deterministic per-component color. We keep this client-side so new
 * components added to the daemon don't need a backend change. Hash-based
 * so the same component always gets the same hue; limited palette to stay
 * on theme (cyan/purple/amber/green/pink/sky).
 */
function componentColor(component: string | null): string {
  if (!component) return 'text-text-muted';
  let hash = 0;
  for (let i = 0; i < component.length; i++) hash = (hash * 31 + component.charCodeAt(i)) | 0;
  return COMPONENT_PALETTE[Math.abs(hash) % COMPONENT_PALETTE.length];
}

const COMPONENT_PALETTE = [
  'text-accent',        // cyan
  'text-purple-300',
  'text-amber-300',
  'text-emerald-300',
  'text-pink-300',
  'text-sky-300',
  'text-rose-300',
  'text-violet-300',
  'text-teal-300',
];

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
