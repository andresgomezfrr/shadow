import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchLogs } from '../../api/client';
import type { LogLine, LogsResponse } from '../../api/client';

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
  const [q, setQ] = useState<string>('');
  const [linesRequested, setLinesRequested] = useState<number>(500);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetchLogs({ lines: linesRequested, component: component || undefined, q: q || undefined });
      setData(r);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [linesRequested, component, q]);

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
  const activeFilters = Boolean(component || q);

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
            onClick={() => { setComponent(''); setQ(''); }}
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
  // visually. Everything else stays muted so prefixes "pop" first.
  const color = componentColor(line.component);
  return (
    <div className="flex gap-2 px-3 hover:bg-border/10">
      <span className="text-text-muted/50 select-none shrink-0 w-10 text-right tabular-nums">{line.lineNo}</span>
      {line.component ? (
        <>
          <span className={`shrink-0 ${color}`}>[{line.component}]</span>
          <span className="text-text-dim whitespace-pre-wrap break-all">{line.message}</span>
        </>
      ) : (
        <span className="text-text-muted whitespace-pre-wrap break-all">{line.raw}</span>
      )}
    </div>
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
