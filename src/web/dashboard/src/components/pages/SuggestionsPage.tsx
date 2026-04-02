import { timeAgo } from '../../utils/format';
import { useState, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApi } from '../../hooks/useApi';
import { fetchSuggestions, fetchRepos, fetchRuns, fetchFeedbackState, acceptSuggestion, dismissSuggestion, snoozeSuggestion } from '../../api/client';
import { ThumbsFeedback, thumbsFromAction } from '../common/ThumbsFeedback';
import { FilterTabs } from '../common/FilterTabs';
import { Badge } from '../common/Badge';
import { Markdown } from '../common/Markdown';
import { EmptyState } from '../common/EmptyState';
import type { Repo } from '../../api/types';

const STATUSES = [
  { label: 'Pending', value: 'pending' },
  { label: 'Snoozed', value: 'snoozed' },
  { label: 'Accepted', value: 'accepted' },
  { label: 'Dismissed', value: 'dismissed' },
  { label: 'All', value: '' },
];

const STATUS_DOTS: Record<string, string> = {
  pending: 'bg-orange',
  snoozed: 'bg-blue',
  accepted: 'bg-green',
  dismissed: 'bg-text-muted',
};

const SNOOZE_OPTIONS = [
  { label: '3h', hours: 3 },
  { label: '6h', hours: 6 },
  { label: '1d', hours: 24 },
  { label: '3d', hours: 72 },
  { label: '7d', hours: 168 },
];


function repoName(repos: Repo[] | null, repoId: string | null): string | null {
  if (!repoId || !repos) return null;
  return repos.find((r) => r.id === repoId)?.name ?? null;
}

export function SuggestionsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const highlightId = searchParams.get('highlight');
  const [pulseId, setPulseId] = useState<string | null>(null);
  const scrolledRef = useRef(false);

  const [status, setStatus] = useState(() => {
    // If highlighting, show all so the item is visible regardless of status
    return highlightId ? '' : 'pending';
  });
  const [kindFilter, setKindFilter] = useState('');
  const { data: rawData, refresh } = useApi(
    () => fetchSuggestions({ status: status || undefined }),
    [status],
    30_000,
  );
  const { data: repos } = useApi(fetchRepos, [], 60_000);
  const { data: runs } = useApi(fetchRuns, [], 30_000);
  const { data: fbState } = useApi(() => fetchFeedbackState('suggestion'), [], 60_000);

  // Derive available kinds from data for filter tabs
  const kinds = rawData ? [...new Set(rawData.map((s) => s.kind))].sort() : [];
  const kindOptions = [{ label: 'All', value: '' }, ...kinds.map((k) => ({ label: k, value: k }))];
  const data = rawData && kindFilter ? rawData.filter((s) => s.kind === kindFilter) : rawData;

  // Handle highlight
  if (highlightId && !pulseId && data?.some((s) => s.id === highlightId)) {
    setPulseId(highlightId);
    const next = new URLSearchParams(searchParams);
    next.delete('highlight');
    setSearchParams(next, { replace: true });
    scrolledRef.current = false;
    setTimeout(() => setPulseId(null), 3000);
  }

  const suggestionScrollRef = (id: string) => (el: HTMLElement | null) => {
    if (el && id === highlightId && !scrolledRef.current) {
      scrolledRef.current = true;
      setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
    }
  };

  const [runCreated, setRunCreated] = useState<string | null>(null);

  const handleAccept = useCallback(async (id: string) => {
    const result = await acceptSuggestion(id);
    if (result && 'runId' in (result as Record<string, unknown>)) {
      setRunCreated((result as Record<string, unknown>).runId as string);
      setTimeout(() => setRunCreated(null), 8000);
    }
    refresh();
  }, [refresh]);

  const handleDismiss = useCallback(async (id: string) => {
    const note = window.prompt('Reason for dismissing (optional):');
    await dismissSuggestion(id, note || undefined);
    refresh();
  }, [refresh]);

  const handleSnooze = useCallback(async (id: string, hours: number) => {
    await snoozeSuggestion(id, hours);
    refresh();
  }, [refresh]);

  const [snoozeOpen, setSnoozeOpen] = useState<string | null>(null);

  return (
    <div>
      <div className="flex items-center gap-3 mb-2 flex-wrap">
        <h1 className="text-xl font-semibold">Suggestions</h1>
        <FilterTabs options={STATUSES} active={status} onChange={setStatus} />
      </div>
      {kinds.length > 1 && (
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xs text-text-muted">Kind:</span>
          <FilterTabs options={kindOptions} active={kindFilter} onChange={setKindFilter} />
        </div>
      )}

      {runCreated && (
        <div className="mb-4 p-3 rounded-lg bg-green/10 border border-green/30 text-sm text-green">
          Run created — Shadow is generating an implementation plan. <a href={`/runs?highlight=${runCreated}`} className="underline">View run</a>
        </div>
      )}

      {!data ? (
        <div className="text-text-dim">Loading...</div>
      ) : data.length === 0 ? (
        <EmptyState icon="💡" title="No suggestions" description="Shadow has no suggestions in this category" />
      ) : (
        <div className="flex flex-col gap-3">
          {data.map((s) => {
            const repo = repoName(repos, s.repoId);
            const linkedRun = runs?.find((r) => r.suggestionId === s.id);
            return (
              <div key={s.id} ref={suggestionScrollRef(s.id)} className={`bg-card border rounded-lg p-4 transition-colors hover:border-accent ${pulseId === s.id ? 'border-accent ring-2 ring-accent/30' : 'border-border'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOTS[s.status] ?? STATUS_DOTS.pending}`} />
                      <span className="font-medium text-sm">{s.title}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-text-muted mb-2 flex-wrap">
                      <span>{s.kind}</span>
                      {repo && <><span>·</span><span>{repo}</span></>}
                      <span>·</span>
                      <span>{timeAgo(s.createdAt)}</span>
                      {s.sourceObservationId && (
                        <><span>·</span><a href={`/observations?highlight=${s.sourceObservationId}`} className="text-accent hover:underline">from observation</a></>
                      )}
                    </div>
                    <Markdown>{s.summaryMd}</Markdown>
                  </div>
                  <div className="flex gap-1.5 shrink-0 flex-wrap justify-end items-center">
                    <Badge title="Impact: how much value this change would bring (1=low, 5=high)" className="text-green bg-green/15">↑{s.impactScore}</Badge>
                    <Badge title="Confidence: how sure Shadow is about this suggestion (0-100%)" className="text-blue bg-blue/15">{Math.round(s.confidenceScore)}%</Badge>
                    {s.riskScore > 1 && <Badge title="Risk: potential for breaking things (1=safe, 5=dangerous)" className="text-orange bg-orange/15">⚠ {s.riskScore}</Badge>}
                    <ThumbsFeedback targetKind="suggestion" targetId={s.id} initial={thumbsFromAction(fbState?.[s.id])} />
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
                    <div className="relative">
                      <button
                        onClick={() => setSnoozeOpen(snoozeOpen === s.id ? null : s.id)}
                        className="px-3 py-1 rounded-lg text-xs font-medium bg-blue/15 text-blue border border-blue/30 cursor-pointer transition-all hover:bg-blue/25"
                      >
                        Snooze
                      </button>
                      {snoozeOpen === s.id && (
                        <div className="absolute top-full left-0 mt-1 bg-card border border-border rounded-lg shadow-lg z-10 overflow-hidden">
                          {SNOOZE_OPTIONS.map((opt) => (
                            <button
                              key={opt.hours}
                              onClick={() => { handleSnooze(s.id, opt.hours); setSnoozeOpen(null); }}
                              className="block w-full px-4 py-1.5 text-xs text-left hover:bg-accent-soft cursor-pointer"
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => handleDismiss(s.id)}
                      className="px-3 py-1 rounded-lg text-xs font-medium bg-border text-text-dim border border-border cursor-pointer transition-all hover:bg-red/15 hover:text-red"
                    >
                      Dismiss
                    </button>
                  </div>
                )}
                {s.status === 'snoozed' && (
                  <div className="flex items-center gap-3 mt-3 pt-3 border-t border-border text-xs">
                    <span className="text-blue">Snoozed — wakes {s.expiresAt ? timeAgo(s.expiresAt) : 'soon'}</span>
                    <button
                      onClick={() => handleSnooze(s.id, 0)}
                      className="px-2 py-0.5 rounded text-xs text-text-dim hover:text-text cursor-pointer"
                    >
                      Wake now
                    </button>
                  </div>
                )}
                {s.status === 'accepted' && (
                  <div className="flex items-center gap-3 mt-3 pt-3 border-t border-border text-xs">
                    {linkedRun && <a href={`/runs?highlight=${linkedRun.id}`} className="text-accent hover:underline">View run</a>}
                    {s.resolvedAt && <span className="text-text-muted">Accepted {timeAgo(s.resolvedAt)}</span>}
                  </div>
                )}
                {s.status === 'dismissed' && (
                  <div className="text-xs text-text-muted mt-2 space-y-1">
                    {s.resolvedAt && <div>Dismissed {timeAgo(s.resolvedAt)}</div>}
                    {s.feedbackNote && <div className="text-text-dim italic">"{s.feedbackNote}"</div>}
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
