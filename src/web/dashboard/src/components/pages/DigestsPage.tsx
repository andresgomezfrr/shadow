import { useState } from 'react';
import { useApi } from '../../hooks/useApi';
import { fetchDigests } from '../../api/client';
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
  daily: 'text-green bg-green/15',
  weekly: 'text-blue bg-blue/15',
  brag: 'text-purple bg-purple/15',
};

export function DigestsPage() {
  const [kindFilter, setKindFilter] = useState('');
  const { data } = useApi(() => fetchDigests(kindFilter || undefined), [kindFilter], 30_000);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) => setExpanded(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <h1 className="text-xl font-semibold">Digests</h1>
        <FilterTabs options={KIND_FILTERS} active={kindFilter} onChange={setKindFilter} />
      </div>

      {!data ? (
        <div className="text-text-dim">Loading...</div>
      ) : data.length === 0 ? (
        <EmptyState
          icon="📝"
          title="No digests yet"
          description="Generate one with: shadow digest daily"
        />
      ) : (
        <div className="flex flex-col gap-3">
          {data.map((d) => {
            const isOpen = expanded.has(d.id);
            return (
              <div
                key={d.id}
                onClick={() => toggle(d.id)}
                className="bg-card border border-border rounded-lg px-4 py-3 cursor-pointer transition-colors hover:border-accent"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge className={KIND_COLORS[d.kind] ?? 'text-text-dim bg-text-dim/15'}>
                    {d.kind}
                  </Badge>
                  <span className="text-sm font-medium">
                    {d.kind === 'brag' ? 'Brag Doc' : d.periodStart}
                    {d.kind === 'weekly' ? ` — ${d.periodEnd}` : ''}
                  </span>
                  <span className="text-xs text-text-muted ml-auto">{timeAgo(d.updatedAt)}</span>
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
