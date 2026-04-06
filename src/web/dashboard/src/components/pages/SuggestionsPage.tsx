import { timeAgo } from '../../utils/format';
import { useState, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApi } from '../../hooks/useApi';
import { useFilterParams } from '../../hooks/useFilterParams';
import { fetchSuggestions, fetchRepos, fetchRuns, acceptSuggestion, dismissSuggestion, snoozeSuggestion, bulkSuggestionAction } from '../../api/client';
import { ThumbsFeedback, thumbsFromAction } from '../common/ThumbsFeedback';
import { FilterTabs } from '../common/FilterTabs';
import { Pagination } from '../common/Pagination';
import { Badge } from '../common/Badge';
import { Markdown } from '../common/Markdown';
import { EmptyState } from '../common/EmptyState';
import { ScoreBar } from '../common/ScoreBar';
import type { Repo } from '../../api/types';

// --- Visual config ---

const SUG_KIND_COLORS: Record<string, string> = {
  refactor: 'text-purple bg-purple/15',
  bug: 'text-red bg-red/15',
  improvement: 'text-blue bg-blue/15',
  feature: 'text-green bg-green/15',
};

const STATUS_BORDER: Record<string, string> = {
  pending: 'border-l-orange',
  backlog: 'border-l-purple',
  snoozed: 'border-l-blue',
  accepted: 'border-l-green',
  dismissed: 'border-l-text-muted',
  expired: 'border-l-text-muted',
};

const STATUSES = [
  { label: 'Pending', value: 'pending', dotColor: 'bg-orange', activeClass: 'bg-orange/15 text-orange' },
  { label: 'Backlog', value: 'backlog', dotColor: 'bg-purple', activeClass: 'bg-purple/15 text-purple' },
  { label: 'Snoozed', value: 'snoozed', dotColor: 'bg-blue', activeClass: 'bg-blue/15 text-blue' },
  { label: 'Accepted', value: 'accepted', dotColor: 'bg-green', activeClass: 'bg-green/15 text-green' },
  { label: 'Dismissed', value: 'dismissed', dotColor: 'bg-text-muted', activeClass: 'bg-text-muted/15 text-text-muted' },
  { label: 'All', value: '' },
];

const TERMINAL_STATUSES = new Set(['dismissed', 'expired']);

const SNOOZE_OPTIONS = [
  { label: '3h', hours: 3 },
  { label: '6h', hours: 6 },
  { label: '1d', hours: 24 },
  { label: '3d', hours: 72 },
  { label: '7d', hours: 168 },
];

const DISMISS_CATEGORIES: Array<{ label: string; category: string }> = [
  { label: 'Premature', category: 'premature' },
  { label: 'Over-engineering', category: 'over_engineering' },
  { label: 'Already handled', category: 'already_handled' },
  { label: 'Not relevant', category: 'not_relevant' },
  { label: 'Low value', category: 'low_value' },
  { label: 'Duplicate', category: 'duplicate' },
  { label: "Won't do", category: 'wont_do' },
];
const ACCEPT_OPTIONS: Array<{ label: string; category: string }> = [
  { label: 'Execute', category: 'execute' },
  { label: 'Already done', category: 'manual' },
  { label: 'Backlog', category: 'planned' },
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

  const PAGE_SIZE = 20;
  const { params, setParam } = useFilterParams({ status: highlightId ? '' : 'pending', kind: '', offset: '0' });
  const { data: rawData, refresh } = useApi(
    () => fetchSuggestions({ status: params.status || undefined, kind: params.kind || undefined, limit: PAGE_SIZE, offset: Number(params.offset) || 0 }),
    [params.status, params.kind, params.offset],
    30_000,
  );
  const { data: repos } = useApi(fetchRepos, [], 60_000);
  const { data: runs } = useApi(fetchRuns, [], 30_000);

  const fbState = rawData?.feedbackState ?? null;
  const data = rawData?.items ?? null;
  const total = rawData?.total ?? 0;

  // Derive available kinds
  const kindsRef = useRef<string[]>([]);
  const currentKinds = data ? [...new Set(data.map((s) => s.kind))].sort() : [];
  if (!params.kind && currentKinds.length > 0) kindsRef.current = currentKinds;
  const kinds = params.kind ? kindsRef.current : currentKinds;
  const kindOptions = [{ label: 'All', value: '' }, ...kinds.map((k) => ({ label: k, value: k }))];

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

  // State
  const [runCreated, setRunCreated] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [snoozeOpen, setSnoozeOpen] = useState<string | null>(null);
  const [dismissOpen, setDismissOpen] = useState<string | null>(null);
  const [dismissNote, setDismissNote] = useState('');
  const [acceptOpen, setAcceptOpen] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDismissOpen, setBulkDismissOpen] = useState(false);

  const toggle = (id: string) => {
    setExpanded((s) => { const next = new Set(s); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };

  const handleAccept = useCallback(async (id: string, category?: string) => {
    const result = await acceptSuggestion(id, category);
    if (result && 'runId' in (result as Record<string, unknown>)) {
      setRunCreated((result as Record<string, unknown>).runId as string);
      setTimeout(() => setRunCreated(null), 8000);
    }
    setAcceptOpen(null);
    refresh();
  }, [refresh]);

  const handleDismiss = useCallback(async (id: string, category?: string, note?: string) => {
    await dismissSuggestion(id, note || undefined, category);
    setDismissOpen(null);
    setDismissNote('');
    refresh();
  }, [refresh]);

  const handleSnooze = useCallback(async (id: string, hours: number) => {
    await snoozeSuggestion(id, hours);
    setSnoozeOpen(null);
    refresh();
  }, [refresh]);

  const handleBulkAccept = useCallback(async (category: string) => {
    await bulkSuggestionAction('accept', [...selected], { category });
    setSelected(new Set());
    refresh();
  }, [selected, refresh]);

  const handleBulkDismiss = useCallback(async (category: string) => {
    await bulkSuggestionAction('dismiss', [...selected], { category });
    setSelected(new Set());
    setBulkDismissOpen(false);
    refresh();
  }, [selected, refresh]);

  return (
    <div>
      <div className="flex items-center gap-3 mb-2 flex-wrap">
        <h1 className="text-xl font-semibold">Suggestions</h1>
        <FilterTabs options={STATUSES} active={params.status} onChange={(v) => { setParam('status', v); setSelected(new Set()); }} />
        {params.status === 'pending' && data && data.length > 0 && (
          <label className="flex items-center gap-1.5 text-xs text-text-dim cursor-pointer ml-auto">
            <input
              type="checkbox"
              checked={data.length > 0 && selected.size === data.length}
              onChange={() => setSelected(s => s.size === data.length ? new Set() : new Set(data.map(x => x.id)))}
              className="accent-accent"
            />
            Select all
          </label>
        )}
      </div>
      {kinds.length > 1 && (
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xs text-text-muted">Kind:</span>
          <FilterTabs options={kindOptions} active={params.kind} onChange={(v) => setParam('kind', v)} />
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
        <EmptyState
          icon={params.status === 'pending' ? '✓' : '💡'}
          title={params.status === 'pending' ? 'All caught up' : 'No suggestions'}
          description={params.status === 'pending' ? 'No pending suggestions to review' : 'Shadow has no suggestions in this category'}
        />
      ) : (
        <div className="flex flex-col gap-2">
          {data.map((s) => {
            const repo = repoName(repos, s.repoId);
            const linkedRun = runs?.items?.find((r) => r.suggestionId === s.id);
            const isOpen = expanded.has(s.id);
            const isTerminal = TERMINAL_STATUSES.has(s.status);
            const borderColor = STATUS_BORDER[s.status] ?? 'border-l-border';

            return (
              <div
                key={s.id}
                ref={suggestionScrollRef(s.id)}
                onClick={() => toggle(s.id)}
                className={`bg-card border border-l-[3px] ${borderColor} rounded-lg px-4 py-3 cursor-pointer transition-colors hover:border-accent/50 ${isTerminal ? 'opacity-60' : ''} ${pulseId === s.id ? 'border-accent ring-2 ring-accent/30' : 'border-border'}`}
              >
                {/* Collapsed row */}
                <div className="flex items-center gap-2.5 flex-wrap">
                  {params.status === 'pending' && (
                    <input
                      type="checkbox"
                      checked={selected.has(s.id)}
                      onChange={(e) => {
                        e.stopPropagation();
                        setSelected(prev => { const next = new Set(prev); next.has(s.id) ? next.delete(s.id) : next.add(s.id); return next; });
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="accent-accent shrink-0"
                    />
                  )}
                  <span className="font-medium text-sm flex-1 min-w-0 truncate">{s.title}</span>
                  <Badge className={SUG_KIND_COLORS[s.kind] ?? 'text-text-dim bg-border'}>{s.kind}</Badge>
                  {repo && <Badge className="text-text-dim bg-border">{repo}</Badge>}
                  <ScoreBar impact={s.impactScore} confidence={s.confidenceScore} risk={s.riskScore} compact />
                  <ThumbsFeedback targetKind="suggestion" targetId={s.id} initial={thumbsFromAction(fbState?.[s.id])} />
                  <span className="text-xs text-text-muted shrink-0">{timeAgo(s.createdAt)}</span>
                </div>

                {/* Expanded content */}
                {isOpen && (
                  <div className="mt-3 animate-fade-in space-y-3" onClick={(e) => e.stopPropagation()}>

                    {/* Actions */}
                    {s.status === 'pending' && (
                      <div className="flex items-center gap-3">
                        <div className="relative">
                          <button
                            onClick={() => setAcceptOpen(acceptOpen === s.id ? null : s.id)}
                            className="px-4 py-2 rounded-lg text-xs font-semibold bg-green text-bg border-none cursor-pointer transition-all hover:brightness-110"
                          >✓ Accept</button>
                          {acceptOpen === s.id && (
                            <div className="absolute top-full left-0 mt-1 bg-card border border-border rounded-lg shadow-lg z-10 overflow-hidden min-w-40">
                              {ACCEPT_OPTIONS.map((opt) => (
                                <button
                                  key={opt.category}
                                  onClick={() => handleAccept(s.id, opt.category)}
                                  className="block w-full px-4 py-1.5 text-xs text-left hover:bg-accent-soft cursor-pointer border-none bg-transparent"
                                >{opt.label}</button>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="relative">
                          <button
                            onClick={() => setSnoozeOpen(snoozeOpen === s.id ? null : s.id)}
                            className="text-xs text-blue hover:underline bg-transparent border-none cursor-pointer"
                          >Snooze</button>
                          {snoozeOpen === s.id && (
                            <div className="absolute top-full left-0 mt-1 bg-card border border-border rounded-lg shadow-lg z-10 overflow-hidden">
                              {SNOOZE_OPTIONS.map((opt) => (
                                <button
                                  key={opt.hours}
                                  onClick={() => handleSnooze(s.id, opt.hours)}
                                  className="block w-full px-4 py-1.5 text-xs text-left hover:bg-accent-soft cursor-pointer border-none bg-transparent"
                                >{opt.label}</button>
                              ))}
                            </div>
                          )}
                        </div>
                        <span className="text-text-muted">·</span>
                        <div className="relative">
                          <button
                            onClick={() => setDismissOpen(dismissOpen === s.id ? null : s.id)}
                            className="text-xs text-text-muted hover:text-red bg-transparent border-none cursor-pointer"
                          >Dismiss</button>
                          {dismissOpen === s.id && (
                            <div className="absolute top-full left-0 mt-1 bg-card border border-border rounded-lg shadow-lg z-10 p-2 space-y-1 min-w-48">
                              {DISMISS_CATEGORIES.map((dc) => (
                                <button
                                  key={dc.category}
                                  onClick={() => handleDismiss(s.id, dc.category)}
                                  className="block w-full px-3 py-1.5 text-xs text-left hover:bg-accent-soft cursor-pointer rounded border-none bg-transparent"
                                >{dc.label}</button>
                              ))}
                              <div className="pt-1 border-t border-border mt-1">
                                <input
                                  type="text"
                                  placeholder="Note (optional)..."
                                  value={dismissNote}
                                  onChange={(e) => setDismissNote(e.target.value)}
                                  onKeyDown={(e) => { if (e.key === 'Enter' && dismissNote) handleDismiss(s.id, 'wont_do', dismissNote); }}
                                  className="w-full px-2 py-1 text-xs bg-bg border border-border rounded outline-none focus:border-accent"
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {s.status === 'snoozed' && (
                      <div className="flex items-center gap-3 text-xs">
                        <span className="text-blue">Snoozed — wakes {s.expiresAt ? timeAgo(s.expiresAt) : 'soon'}</span>
                        <button onClick={() => handleSnooze(s.id, 0)} className="text-text-dim hover:text-text bg-transparent border-none cursor-pointer text-xs">Wake now</button>
                      </div>
                    )}

                    {s.status === 'accepted' && linkedRun && (
                      <div className="flex items-center gap-3 text-xs">
                        <a href={`/runs?highlight=${linkedRun.id}`} className="text-accent hover:underline">View run</a>
                        {s.resolvedAt && <span className="text-text-muted">Accepted {timeAgo(s.resolvedAt)}</span>}
                      </div>
                    )}

                    {s.status === 'dismissed' && s.feedbackNote && (
                      <div className="text-xs text-text-dim italic">"{s.feedbackNote}"</div>
                    )}

                    {/* Scores detail */}
                    <div className="flex items-center gap-4 text-xs">
                      <ScoreBar impact={s.impactScore} confidence={s.confidenceScore} risk={s.riskScore} />
                      {s.sourceObservationId && (
                        <a href={`/observations?highlight=${s.sourceObservationId}`} className="text-accent hover:underline">from observation</a>
                      )}
                    </div>

                    {/* Summary markdown */}
                    <div className="bg-bg rounded-lg p-3 max-h-64 overflow-y-auto">
                      <Markdown>{s.summaryMd}</Markdown>
                    </div>

                    {s.reasoningMd && (
                      <div className="bg-bg rounded-lg p-3 max-h-48 overflow-y-auto text-text-dim">
                        <div className="text-xs text-text-muted mb-1">Reasoning</div>
                        <Markdown>{s.reasoningMd}</Markdown>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <Pagination total={total} offset={Number(params.offset) || 0} limit={PAGE_SIZE} onChange={(o) => setParam('offset', String(o))} />

      {/* Bulk action toolbar */}
      {selected.size > 0 && (
        <div className="sticky bottom-4 mx-auto w-fit bg-card border border-accent/30 rounded-xl px-5 py-2.5 shadow-lg flex items-center gap-3 z-50 mt-4">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <span className="text-border">|</span>
          <button onClick={() => handleBulkAccept('manual')} className="text-xs text-green hover:underline bg-transparent border-none cursor-pointer">Accept (manual)</button>
          <button onClick={() => handleBulkAccept('planned')} className="text-xs text-purple hover:underline bg-transparent border-none cursor-pointer">Backlog</button>
          <div className="relative">
            <button onClick={() => setBulkDismissOpen(!bulkDismissOpen)} className="text-xs text-red hover:underline bg-transparent border-none cursor-pointer">Dismiss</button>
            {bulkDismissOpen && (
              <div className="absolute bottom-full left-0 mb-1 bg-card border border-border rounded-lg shadow-lg z-10 p-1 min-w-40">
                {DISMISS_CATEGORIES.map((dc) => (
                  <button
                    key={dc.category}
                    onClick={() => handleBulkDismiss(dc.category)}
                    className="block w-full px-3 py-1.5 text-xs text-left hover:bg-accent-soft cursor-pointer rounded border-none bg-transparent"
                  >{dc.label}</button>
                ))}
              </div>
            )}
          </div>
          <span className="text-border">|</span>
          <button onClick={() => setSelected(new Set())} className="text-xs text-text-muted hover:text-text bg-transparent border-none cursor-pointer">Cancel</button>
        </div>
      )}
    </div>
  );
}
