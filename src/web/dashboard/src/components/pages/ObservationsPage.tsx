import { useApi } from '../../hooks/useApi';
import { useFilterParams } from '../../hooks/useFilterParams';
import { fetchObservations, acknowledgeObservation, resolveObservation, reopenObservation } from '../../api/client';
import { ThumbsFeedback, thumbsFromAction } from '../common/ThumbsFeedback';
import { Pagination } from '../common/Pagination';
import { Badge } from '../common/Badge';
import { EmptyState } from '../common/EmptyState';
import { FilterTabs } from '../common/FilterTabs';
import { useState, useCallback } from 'react';
import { useHighlight } from '../../hooks/useHighlight';
import { timeAgo } from '../../utils/format';

// --- Severity visual config ---

const SEVERITY_BORDER: Record<string, string> = {
  high: 'border-l-red',
  warning: 'border-l-orange',
  info: 'border-l-blue',
};

const SEVERITY_ICON: Record<string, string> = {
  high: '●',
  warning: '▲',
  info: '○',
};

const SEVERITY_ICON_COLOR: Record<string, string> = {
  high: 'text-red',
  warning: 'text-orange',
  info: 'text-blue',
};

const STATUS_OPTIONS = [
  { label: 'Active', value: 'active', dotColor: 'bg-green', activeClass: 'bg-green/15 text-green' },
  { label: 'Acknowledged', value: 'acknowledged', dotColor: 'bg-blue', activeClass: 'bg-blue/15 text-blue' },
  { label: 'Resolved', value: 'resolved', dotColor: 'bg-text-muted', activeClass: 'bg-text-muted/15 text-text-muted' },
  { label: 'All', value: 'all' },
];

const SEVERITY_OPTIONS = [
  { label: 'All', value: '' },
  { label: 'High', value: 'high', dotColor: 'bg-red', activeClass: 'bg-red/15 text-red' },
  { label: 'Warning', value: 'warning', dotColor: 'bg-orange', activeClass: 'bg-orange/15 text-orange' },
  { label: 'Info', value: 'info', dotColor: 'bg-blue', activeClass: 'bg-blue/15 text-blue' },
];

const TERMINAL_STATUSES = new Set(['resolved']);
const PAGE_SIZE = 20;

export function ObservationsPage() {
  const { params, setParam } = useFilterParams({ status: 'active', severity: '', offset: '0' });
  const { data: rawData, refresh } = useApi(
    () => fetchObservations({ limit: PAGE_SIZE, offset: Number(params.offset) || 0, status: params.status, severity: params.severity || undefined }),
    [params.status, params.severity, params.offset],
    30_000,
  );
  const data = rawData?.items ?? null;
  const total = rawData?.total ?? 0;
  const fbState = rawData?.feedbackState ?? null;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const { pulseId, scrollRef } = useHighlight(expanded, setExpanded);

  const toggle = (id: string) => {
    setExpanded((s) => { const next = new Set(s); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };

  const handleAck = useCallback(async (id: string) => { await acknowledgeObservation(id); refresh(); }, [refresh]);
  const handleResolve = useCallback(async (id: string) => {
    const note = window.prompt('Reason for resolving (optional):');
    await resolveObservation(id, note || undefined);
    refresh();
  }, [refresh]);
  const handleReopen = useCallback(async (id: string) => { await reopenObservation(id); refresh(); }, [refresh]);

  return (
    <div>
      <div className="flex items-center gap-3 mb-2 flex-wrap">
        <img src="/ghost/observations-header.png" alt="" className="w-[80px] h-[80px] rounded-full object-cover" />
        <h1 className="text-xl font-semibold">Observations</h1>
        <FilterTabs options={STATUS_OPTIONS} active={params.status} onChange={(v) => setParam('status', v)} />
      </div>
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs text-text-muted">Severity:</span>
        <FilterTabs options={SEVERITY_OPTIONS} active={params.severity} onChange={(v) => setParam('severity', v)} />
      </div>

      {!data ? (
        <div className="text-text-dim">Loading...</div>
      ) : data.length === 0 ? (
        <EmptyState
          title={params.status === 'active' ? 'All clear' : 'No observations'}
          description={params.status === 'active' ? 'No active observations' : `No ${params.status === 'all' ? '' : params.status + ' '}observations found`}
        />
      ) : (
        <div className="flex flex-col gap-2">
          {data.map((obs) => {
            const isOpen = expanded.has(obs.id);
            const isTerminal = TERMINAL_STATUSES.has(obs.status);
            const borderColor = SEVERITY_BORDER[obs.severity] ?? 'border-l-border';
            const icon = SEVERITY_ICON[obs.severity] ?? '○';
            const iconColor = SEVERITY_ICON_COLOR[obs.severity] ?? 'text-text-muted';

            return (
              <div
                key={obs.id}
                ref={scrollRef(obs.id)}
                onClick={() => toggle(obs.id)}
                className={`bg-card border border-l-[3px] ${borderColor} rounded-lg px-4 py-3 cursor-pointer transition-colors hover:border-accent/50 ${isTerminal ? 'opacity-60' : ''} ${pulseId === obs.id ? 'border-accent ring-2 ring-accent/30' : 'border-border'}`}
              >
                {/* Collapsed row */}
                <div className="flex items-center gap-2.5 flex-wrap">
                  <span className={`text-sm w-4 text-center ${iconColor}`} title={obs.severity}>{icon}</span>
                  <span className="text-[13px] flex-1 min-w-0 truncate">{obs.title}</span>
                  {obs.votes > 1 && <Badge title="Times seen" className="text-orange bg-orange/15">{obs.votes}x</Badge>}

                  {/* Inline actions */}
                  {obs.status === 'active' && (
                    <>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleResolve(obs.id); }}
                        className="px-3 py-1 rounded-lg text-xs font-semibold bg-green text-bg border-none cursor-pointer transition-all hover:brightness-110"
                      >Resolve</button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleAck(obs.id); }}
                        className="text-xs text-blue hover:underline bg-transparent border-none cursor-pointer"
                      >Acknowledge</button>
                    </>
                  )}
                  {obs.status === 'acknowledged' && (
                    <>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleResolve(obs.id); }}
                        className="px-3 py-1 rounded-lg text-xs font-semibold bg-green text-bg border-none cursor-pointer transition-all hover:brightness-110"
                      >Resolve</button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleReopen(obs.id); }}
                        className="text-xs text-orange hover:underline bg-transparent border-none cursor-pointer"
                      >Reopen</button>
                    </>
                  )}
                  {obs.status === 'resolved' && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleReopen(obs.id); }}
                      className="text-xs text-text-muted hover:text-orange bg-transparent border-none cursor-pointer"
                    >Reopen</button>
                  )}

                  <ThumbsFeedback targetKind="observation" targetId={obs.id} initial={thumbsFromAction(fbState?.[obs.id])} />
                  <span className="text-xs text-text-muted shrink-0">{timeAgo(obs.lastSeenAt)}</span>
                </div>

                {/* Expanded content */}
                {isOpen && (
                  <div className="mt-3 animate-fade-in space-y-2" onClick={(e) => e.stopPropagation()}>
                    {typeof obs.detail?.description === 'string' && obs.detail.description && (
                      <p className="text-[13px] text-text-dim leading-relaxed m-0">{obs.detail.description}</p>
                    )}

                    {/* Metadata */}
                    <div className="flex items-center gap-3 text-xs text-text-muted flex-wrap">
                      <Badge className="text-text-dim bg-border">{obs.kind}</Badge>
                      {obs.votes > 1 && <span>Seen {obs.votes} times</span>}
                      <span>First: {timeAgo(obs.firstSeenAt)}</span>
                      {obs.suggestionId && <a href={`/suggestions?highlight=${obs.suggestionId}`} className="text-accent hover:underline">linked suggestion</a>}
                    </div>

                    {/* Context */}
                    {obs.context && Object.keys(obs.context).length > 0 && (
                      <div className="bg-bg rounded-lg p-3 text-xs space-y-1">
                        {typeof obs.context.repoName === 'string' && (
                          <div><span className="text-accent">repo:</span> {obs.context.repoName}</div>
                        )}
                        {typeof obs.context.branch === 'string' && (
                          <div><span className="text-accent">branch:</span> {obs.context.branch}</div>
                        )}
                        {Array.isArray(obs.context.files) && (obs.context.files as string[]).length > 0 && (
                          <div>
                            <span className="text-accent">files:</span>
                            <ul className="ml-4 list-disc mt-1">
                              {(obs.context.files as string[]).map((f) => <li key={f}>{f}</li>)}
                            </ul>
                          </div>
                        )}
                        {Array.isArray(obs.context.sessionIds) && (
                          <div><span className="text-accent">sessions:</span> {(obs.context.sessionIds as string[]).length}</div>
                        )}
                      </div>
                    )}

                    {/* Extra detail fields */}
                    {Object.entries(obs.detail ?? {})
                      .filter(([k]) => k !== 'description')
                      .map(([k, v]) => (
                        <div key={k} className="text-xs text-text-muted">
                          <span className="text-accent">{k}:</span>{' '}
                          <span>{typeof v === 'string' ? v : JSON.stringify(v, null, 2)}</span>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <Pagination total={total} offset={Number(params.offset) || 0} limit={PAGE_SIZE} onChange={(o) => setParam('offset', String(o))} />
    </div>
  );
}
