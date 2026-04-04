import { useState, useCallback, useEffect, useRef } from 'react';
import { useApi } from '../../hooks/useApi';
import { fetchDigests, fetchDigestStatus, triggerDigest } from '../../api/client';
import type { DigestKindStatus } from '../../api/client';
import { Badge } from '../common/Badge';
import { EmptyState } from '../common/EmptyState';
import { Markdown } from '../common/Markdown';
import { FilterTabs } from '../common/FilterTabs';
import { timeAgo } from '../../utils/format';

const KIND_FILTERS = [
  { label: 'All', value: '' },
  { label: 'Daily', value: 'daily' },
  { label: 'Weekly', value: 'weekly' },
  { label: 'Brag Doc', value: 'brag' },
];

const KIND_COLORS: Record<string, string> = {
  daily: 'text-cyan bg-cyan/15',
  weekly: 'text-cyan bg-cyan/15',
  brag: 'text-cyan bg-cyan/15',
};

const KIND_LABELS: Record<string, string> = {
  daily: 'Standup',
  weekly: '1:1',
  brag: 'Brag Doc',
};

const BUSY_STATUSES = new Set(['running', 'queued']);

function statusIsBusy(st?: DigestKindStatus): boolean {
  return !!st && BUSY_STATUSES.has(st.status);
}

export function DigestsPage() {
  const [kindFilter, setKindFilter] = useState('');
  const { data, refresh } = useApi(() => fetchDigests(kindFilter || undefined), [kindFilter], 30_000);
  const { data: status } = useApi(fetchDigestStatus, [], 5_000);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) => setExpanded(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  // Optimistic state keyed by "kind:periodStart" or "kind:current"
  const [triggered, setTriggered] = useState<Set<string>>(new Set());

  // Track previous status for transition detection
  const prevStatusRef = useRef<Record<string, DigestKindStatus> | null>(null);
  useEffect(() => {
    if (!status) return;
    const prev = prevStatusRef.current;

    // Clear optimistic flags once backend tracks the job
    setTriggered(current => {
      let changed = false;
      const next = new Set(current);
      for (const key of current) {
        const kind = key.split(':')[0];
        if (statusIsBusy(status[kind])) { next.delete(key); changed = true; }
      }
      return changed ? next : current;
    });

    // Auto-refresh digest list when any job transitions from busy → idle
    if (prev) {
      for (const kind of ['daily', 'weekly', 'brag']) {
        if (statusIsBusy(prev[kind]) && !statusIsBusy(status[kind])) {
          refresh();
          break;
        }
      }
    }
    prevStatusRef.current = status;
  }, [status, refresh]);

  const handleTrigger = useCallback(async (kind: 'daily' | 'weekly' | 'brag', periodStart?: string) => {
    const key = `${kind}:${periodStart ?? 'current'}`;
    setTriggered(prev => new Set(prev).add(key));
    try {
      await triggerDigest(kind, periodStart);
    } catch {
      setTriggered(prev => { const next = new Set(prev); next.delete(key); return next; });
    }
  }, []);

  // Per-item busy: only the specific period is busy, not all items of that kind
  const isBusy = (kind: string, periodStart?: string): boolean => {
    const key = `${kind}:${periodStart ?? 'current'}`;
    if (triggered.has(key)) return true;
    const st = status?.[kind];
    if (!st || !statusIsBusy(st)) return false;
    // Top-level button (no periodStart): busy if ANY job of this kind is running
    if (!periodStart) return true;
    // Per-item: busy only if the running job matches this period
    return st.periodStart === periodStart;
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <h1 className="text-xl font-semibold">Digests</h1>
        <FilterTabs options={KIND_FILTERS} active={kindFilter} onChange={setKindFilter} />
        <div className="ml-auto flex gap-2">
          {(['daily', 'weekly', 'brag'] as const).map((kind) => (
            <button
              key={kind}
              onClick={() => handleTrigger(kind)}
              disabled={isBusy(kind)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-cyan/15 text-cyan border border-cyan/30 cursor-pointer transition-all hover:bg-cyan/25 disabled:opacity-50 disabled:cursor-wait"
            >
              {isBusy(kind) ? `Generating ${KIND_LABELS[kind]}...` : `Generate ${KIND_LABELS[kind]}`}
            </button>
          ))}
        </div>
      </div>

      {!data ? (
        <div className="text-text-dim">Loading...</div>
      ) : data.length === 0 ? (
        <EmptyState
          icon="📝"
          title="No digests yet"
          description="Click a Generate button above or use: shadow digest daily"
        />
      ) : (
        <div className="flex flex-col gap-3">
          {data.map((d) => {
            const isOpen = expanded.has(d.id);
            const itemBusy = isBusy(d.kind, d.periodStart);
            return (
              <div
                key={d.id}
                onClick={() => toggle(d.id)}
                className="bg-card border border-border rounded-lg px-4 py-3 cursor-pointer transition-colors hover:border-accent"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge className={KIND_COLORS[d.kind] ?? 'text-text-dim bg-text-dim/15'}>
                    {KIND_LABELS[d.kind] ?? d.kind}
                  </Badge>
                  <span className="text-sm font-medium">
                    {d.kind === 'brag' ? 'Brag Doc' : d.periodStart}
                    {d.kind === 'weekly' ? ` — ${d.periodEnd}` : ''}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleTrigger(d.kind as 'daily' | 'weekly' | 'brag', d.periodStart); }}
                    disabled={itemBusy}
                    className="ml-auto px-1.5 py-0.5 rounded text-xs text-text-muted hover:text-cyan hover:bg-cyan/10 transition-colors disabled:opacity-40 disabled:cursor-wait cursor-pointer"
                    title={`Regenerate ${KIND_LABELS[d.kind] ?? d.kind}`}
                  >
                    {itemBusy ? '⏳' : '🔄'}
                  </button>
                  <span className="text-xs text-text-muted">{timeAgo(d.updatedAt)}</span>
                </div>

                {isOpen && (
                  <div className="mt-3 animate-fade-in">
                    <div className="bg-bg rounded p-4 max-h-[600px] overflow-y-auto">
                      <Markdown>{d.contentMd}</Markdown>
                    </div>
                    <div className="flex items-center gap-3 mt-2 text-xs text-text-muted">
                      <span>Model: {d.model}</span>
                      <span>Tokens: {d.tokensUsed}</span>
                      <span>Generated: {new Date(d.createdAt).toLocaleString()}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
