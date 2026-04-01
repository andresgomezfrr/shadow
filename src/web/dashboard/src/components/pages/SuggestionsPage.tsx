import { useState, useCallback } from 'react';
import { useApi } from '../../hooks/useApi';
import { fetchSuggestions, acceptSuggestion, dismissSuggestion } from '../../api/client';
import { FilterTabs } from '../common/FilterTabs';
import { Badge } from '../common/Badge';
import { EmptyState } from '../common/EmptyState';

const STATUSES = [
  { label: 'All', value: '' },
  { label: 'Pending', value: 'pending' },
  { label: 'Accepted', value: 'accepted' },
  { label: 'Dismissed', value: 'dismissed' },
];

const STATUS_DOTS: Record<string, string> = {
  pending: 'bg-orange',
  accepted: 'bg-green',
  dismissed: 'bg-text-muted',
};

export function SuggestionsPage() {
  const [status, setStatus] = useState('');
  const { data, refresh } = useApi(
    () => fetchSuggestions({ status: status || undefined }),
    [status],
    30_000,
  );

  const handleAccept = useCallback(async (id: string) => {
    await acceptSuggestion(id);
    refresh();
  }, [refresh]);

  const handleDismiss = useCallback(async (id: string) => {
    await dismissSuggestion(id);
    refresh();
  }, [refresh]);

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <h1 className="text-xl font-semibold">Suggestions</h1>
        <FilterTabs options={STATUSES} active={status} onChange={setStatus} />
      </div>

      {!data ? (
        <div className="text-text-dim">Loading...</div>
      ) : data.length === 0 ? (
        <EmptyState icon="💡" title="No suggestions" description="Shadow has no suggestions in this category" />
      ) : (
        <div className="flex flex-col gap-3">
          {data.map((s) => (
            <div key={s.id} className="bg-card border border-border rounded-lg p-4 transition-colors hover:border-accent">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOTS[s.status] ?? STATUS_DOTS.pending}`} />
                    <span className="font-medium text-sm truncate">{s.title}</span>
                  </div>
                  <div className="text-xs text-text-dim mb-2">{s.kind}</div>
                  <div className="text-[13px] text-text-dim leading-relaxed">{s.summaryMd}</div>
                </div>
                <div className="flex gap-1.5 shrink-0 flex-wrap justify-end">
                  <Badge className="text-green bg-green/15">↑{s.impactScore}</Badge>
                  <Badge className="text-blue bg-blue/15">{Math.round(s.confidenceScore * 100)}%</Badge>
                  {s.riskScore > 0.3 && <Badge className="text-orange bg-orange/15">⚠ {s.riskScore.toFixed(1)}</Badge>}
                </div>
              </div>
              {s.status === 'pending' && (
                <div className="flex gap-2 mt-3 pt-3 border-t border-border">
                  <button
                    onClick={() => handleAccept(s.id)}
                    className="px-3 py-1 rounded-lg text-xs font-medium bg-green/15 text-green border border-green/30 cursor-pointer transition-all hover:bg-green/25"
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => handleDismiss(s.id)}
                    className="px-3 py-1 rounded-lg text-xs font-medium bg-border text-text-dim border border-border cursor-pointer transition-all hover:bg-red/15 hover:text-red"
                  >
                    Dismiss
                  </button>
                </div>
              )}
              {s.resolvedAt && (
                <div className="text-xs text-text-muted mt-2">
                  Resolved: {new Date(s.resolvedAt).toLocaleString('en-US')}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
