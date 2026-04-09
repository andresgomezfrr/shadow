import { useApi } from '../../../hooks/useApi';
import { fetchSuggestionContext, acceptSuggestion, dismissSuggestion, snoozeSuggestion, revalidateSuggestion, getActiveRevalidations } from '../../../api/client';
import { Markdown } from '../../common/Markdown';
import { ScoreBar } from '../../common/ScoreBar';
import { Badge } from '../../common/Badge';
import { SUG_KIND_COLORS, SUG_KIND_COLOR_DEFAULT } from '../../../utils/suggestion-colors';
import { timeAgo } from '../../../utils/format';
import { useState, useCallback, useEffect, useRef } from 'react';
import { useWorkspace } from './WorkspaceContext';

function useRevalidationPolling(suggestionId: string, baseline: number, onComplete: () => void) {
  const [active, setActive] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const start = useCallback(() => {
    setActive(true);
    pollRef.current = setInterval(async () => {
      const fresh = await fetchSuggestionContext(suggestionId);
      if (fresh && fresh.suggestion.revalidationCount > baseline) {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
        setActive(false);
        onComplete();
      }
    }, 3000);
    setTimeout(() => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; setActive(false); } }, 5 * 60 * 1000);
  }, [suggestionId, baseline, onComplete]);

  // On mount: check if there's already a running job for this suggestion
  useEffect(() => {
    let cancelled = false;
    getActiveRevalidations([suggestionId]).then(activeSet => {
      if (!cancelled && activeSet.has(suggestionId)) start();
    });
    return () => { cancelled = true; if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [suggestionId]); // eslint-disable-line react-hooks/exhaustive-deps

  return { revalidating: active, startPolling: start };
}

export function SuggestionDetail({ suggestionId, onRefresh }: { suggestionId: string; onRefresh?: () => void }) {
  const { data: ctx, refresh } = useApi(() => fetchSuggestionContext(suggestionId), [suggestionId], 30_000);
  const { drillToItem } = useWorkspace();
  const [summaryOpen, setSummaryOpen] = useState(true);
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [dismissDraft, setDismissDraft] = useState<string | null>(null);

  const doRefresh = useCallback(() => { refresh(); onRefresh?.(); }, [refresh, onRefresh]);

  const { revalidating, startPolling } = useRevalidationPolling(
    suggestionId,
    ctx?.suggestion.revalidationCount ?? 0,
    doRefresh,
  );

  const [acceptMenuOpen, setAcceptMenuOpen] = useState(false);
  const acceptMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!acceptMenuOpen) return;
    const close = (e: MouseEvent) => { if (acceptMenuRef.current && !acceptMenuRef.current.contains(e.target as Node)) setAcceptMenuOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [acceptMenuOpen]);

  const handleAccept = useCallback(async (category?: string) => {
    setLoading('accept');
    setAcceptMenuOpen(false);
    try { await acceptSuggestion(suggestionId, category); doRefresh(); } finally { setLoading(null); }
  }, [suggestionId, doRefresh]);

  const handleDismiss = useCallback(async (note?: string) => {
    await dismissSuggestion(suggestionId, note || undefined);
    setDismissDraft(null);
    doRefresh();
  }, [suggestionId, doRefresh]);

  const handleSnooze = useCallback(async () => {
    await snoozeSuggestion(suggestionId, 24);
    doRefresh();
  }, [suggestionId, doRefresh]);

  const handleRevalidate = useCallback(async () => {
    await revalidateSuggestion(suggestionId);
    startPolling();
  }, [suggestionId, startPolling]);

  if (!ctx) return <div className="text-text-dim text-sm p-4">Loading...</div>;

  const { suggestion: s, sourceObservation, linkedRuns, rankScore, warning } = ctx;

  const verdictColors: Record<string, string> = {
    valid: 'text-green bg-green/10 border-green/20',
    partial: 'text-orange bg-orange/10 border-orange/20',
    outdated: 'text-red bg-red/10 border-red/20',
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-lg">💡</span>
        <Badge className={SUG_KIND_COLORS[s.kind] ?? SUG_KIND_COLOR_DEFAULT}>{s.kind}</Badge>
        <Badge className="text-text-dim bg-border">{s.status}</Badge>
        {s.revalidationCount > 0 && (
          <Badge className="text-cyan-300 bg-cyan-500/15" title={`Last revalidated ${s.lastRevalidatedAt ? timeAgo(s.lastRevalidatedAt) : 'unknown'}`}>
            🔍 {s.revalidationCount}x
          </Badge>
        )}
      </div>
      <div className="font-medium text-sm">{s.title}</div>

      {/* Revalidation verdict banner */}
      {s.revalidationVerdict && (
        <div className={`text-xs rounded-lg p-2.5 border ${verdictColors[s.revalidationVerdict] ?? 'text-text-dim bg-card border-border'}`}>
          <div className="font-medium mb-0.5">
            {s.revalidationVerdict === 'valid' && '✓ Still valid'}
            {s.revalidationVerdict === 'partial' && '◐ Partially valid'}
            {s.revalidationVerdict === 'outdated' && '✕ Outdated'}
            {s.lastRevalidatedAt && <span className="font-normal text-text-muted ml-2">{timeAgo(s.lastRevalidatedAt)}</span>}
          </div>
          {s.revalidationNote && <div className="text-text-dim">{s.revalidationNote}</div>}
        </div>
      )}

      {/* Pre-filled dismiss for outdated suggestions */}
      {s.revalidationVerdict === 'outdated' && (s.status === 'pending' || s.status === 'backlog') && (
        <div className="bg-red/5 border border-red/20 rounded-lg p-3 space-y-2">
          <div className="text-xs text-red font-medium">Ready to dismiss</div>
          <textarea
            value={dismissDraft ?? s.revalidationNote ?? ''}
            onChange={e => setDismissDraft(e.target.value)}
            className="w-full text-xs bg-bg border border-border rounded p-2 text-text resize-none outline-none focus:border-accent"
            rows={2}
          />
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleDismiss(dismissDraft ?? s.revalidationNote ?? undefined)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red text-bg border-none cursor-pointer hover:brightness-110"
            >Dismiss</button>
            <button
              onClick={() => setDismissDraft(null)}
              className="text-xs text-text-muted hover:text-text bg-transparent border-none cursor-pointer"
            >Edit note</button>
          </div>
        </div>
      )}

      {/* Warning */}
      {warning && (
        <div className="text-xs text-orange bg-orange/5 border border-orange/20 rounded-lg p-2">
          ⚠ {warning}
        </div>
      )}

      {/* Source observation */}
      {sourceObservation && (
        <div className="text-xs bg-bg rounded-lg p-2">
          <span className="text-text-muted">From observation: </span>
          <span className="text-text-dim">{sourceObservation.title}</span>
          <button
            onClick={() => drillToItem(sourceObservation.id, 'observation')}
            className="text-accent hover:underline ml-2 bg-transparent border-none cursor-pointer text-xs"
          >View</button>
        </div>
      )}

      {/* Scores */}
      <div className="flex items-center gap-4 text-xs">
        <ScoreBar impact={s.impactScore} confidence={s.confidenceScore} risk={s.riskScore} />
        {rankScore != null && <span className="font-mono text-accent">Score: {rankScore}</span>}
      </div>

      {/* Summary */}
      <div>
        <button onClick={() => setSummaryOpen(!summaryOpen)} className="text-xs text-accent hover:underline bg-transparent border-none cursor-pointer">
          {summaryOpen ? '▾ Summary' : '▸ Summary'}
        </button>
        {summaryOpen && s.summaryMd && (
          <div className="mt-1 bg-bg rounded-lg p-2 max-h-48 overflow-y-auto">
            <Markdown>{s.summaryMd}</Markdown>
          </div>
        )}
      </div>

      {/* Reasoning */}
      {s.reasoningMd && (
        <div>
          <button onClick={() => setReasoningOpen(!reasoningOpen)} className="text-xs text-text-muted hover:underline bg-transparent border-none cursor-pointer">
            {reasoningOpen ? '▾ Reasoning' : '▸ Reasoning'}
          </button>
          {reasoningOpen && (
            <div className="mt-1 bg-bg rounded-lg p-2 max-h-48 overflow-y-auto text-text-dim">
              <Markdown>{s.reasoningMd}</Markdown>
            </div>
          )}
        </div>
      )}

      {/* Linked runs */}
      {linkedRuns.length > 0 && (
        <div className="text-xs bg-bg rounded-lg p-2 space-y-1">
          <span className="text-text-muted">Linked runs:</span>
          {linkedRuns.map(r => (
            <div key={r.id} className="flex items-center gap-2">
              <Badge className="text-text-dim bg-border">{r.status}</Badge>
              <span className="truncate flex-1">{r.prompt.slice(0, 60)}</span>
              <button
                onClick={() => drillToItem(r.id, 'run')}
                className="text-accent hover:underline shrink-0 bg-transparent border-none cursor-pointer text-xs"
              >View</button>
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3 border-t border-border pt-3 flex-wrap">
        {(s.status === 'pending' || s.status === 'backlog') && (
          <>
            <div className="relative" ref={acceptMenuRef}>
              <button
                onClick={() => setAcceptMenuOpen(!acceptMenuOpen)}
                disabled={loading === 'accept'}
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-green text-bg border-none cursor-pointer hover:brightness-110 disabled:opacity-50"
              >
                {s.status === 'backlog' ? 'Move' : '✓ Accept'}
              </button>
              {acceptMenuOpen && (
                <div className="absolute bottom-full left-0 mb-1 bg-card border border-border rounded-lg shadow-lg z-10 overflow-hidden min-w-36">
                  {(s.status === 'backlog'
                    ? [{ label: 'Execute', category: 'execute' }, { label: 'Already done', category: 'manual' }]
                    : [{ label: 'Execute', category: 'execute' }, { label: 'Already done', category: 'manual' }, { label: 'Backlog', category: 'planned' }]
                  ).map(opt => (
                    <button
                      key={opt.category}
                      onClick={() => handleAccept(opt.category)}
                      className="block w-full px-4 py-1.5 text-xs text-left hover:bg-accent-soft cursor-pointer border-none bg-transparent"
                    >{opt.label}</button>
                  ))}
                </div>
              )}
            </div>
            {s.status === 'pending' && (
              <button onClick={handleSnooze} className="text-xs text-blue hover:underline bg-transparent border-none cursor-pointer">Snooze</button>
            )}
            <button onClick={() => handleDismiss()} className="text-xs text-text-muted hover:text-red bg-transparent border-none cursor-pointer">Dismiss</button>
          </>
        )}
        <button
          onClick={handleRevalidate}
          disabled={revalidating}
          className={`text-xs border-none cursor-pointer disabled:cursor-wait ml-auto px-2.5 py-1 rounded-md transition-colors ${
            revalidating
              ? 'bg-sky-400/15 text-sky-300 animate-pulse'
              : 'bg-transparent text-cyan-300 hover:bg-sky-400/10'
          }`}
        >
          {revalidating ? '🔍 Revalidating...' : '🔍 Re-evaluate'}
        </button>
      </div>
    </div>
  );
}
