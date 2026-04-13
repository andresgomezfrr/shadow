import { useApi } from '../../hooks/useApi';
import { useFilterParams } from '../../hooks/useFilterParams';
import { fetchObservations, fetchRepos, fetchProjects, acknowledgeObservation, resolveObservation, reopenObservation, lookupEntity } from '../../api/client';
import { ThumbsFeedback, thumbsFromAction } from '../common/ThumbsFeedback';
import { CorrectionPanel } from '../common/CorrectionPanel';
import { Pagination } from '../common/Pagination';
import { Badge } from '../common/Badge';
import { EmptyState } from '../common/EmptyState';
import { FilterTabs } from '../common/FilterTabs';
import { OBS_KIND_COLORS, OBS_KIND_COLOR_DEFAULT, OBS_KIND_OPTIONS, OBS_SEVERITY_BORDER, OBS_SEVERITY_ICON, OBS_SEVERITY_ICON_COLOR } from '../../utils/observation-colors';
import { useState, useCallback, useEffect, useMemo } from 'react';
import { useHighlight } from '../../hooks/useHighlight';
import { timeAgo } from '../../utils/format';
import type { Observation } from '../../api/types';

const STATUS_OPTIONS = [
  { label: 'Open', value: 'open', dotColor: 'bg-green', activeClass: 'bg-green/15 text-green' },
  { label: 'Acknowledged', value: 'acknowledged', dotColor: 'bg-blue', activeClass: 'bg-blue/15 text-blue' },
  { label: 'Done', value: 'done', dotColor: 'bg-text-muted', activeClass: 'bg-text-muted/15 text-text-muted' },
  { label: 'All', value: 'all' },
];

const SEVERITY_OPTIONS = [
  { label: 'All', value: '' },
  { label: 'High', value: 'high', dotColor: 'bg-red', activeClass: 'bg-red/15 text-red' },
  { label: 'Warning', value: 'warning', dotColor: 'bg-orange', activeClass: 'bg-orange/15 text-orange' },
  { label: 'Info', value: 'info', dotColor: 'bg-blue', activeClass: 'bg-blue/15 text-blue' },
];


const TERMINAL_STATUSES = new Set(['done']);
const PAGE_SIZE = 20;

export function ObservationsPage() {
  const { params, setParam } = useFilterParams({ status: 'open', severity: '', kind: '', repoId: '', projectId: '', offset: '0' });
  const { data: rawData, refresh } = useApi(
    () => fetchObservations({ limit: PAGE_SIZE, offset: Number(params.offset) || 0, status: params.status, severity: params.severity || undefined, kind: params.kind || undefined, repoId: params.repoId || undefined, projectId: params.projectId || undefined }),
    [params.status, params.severity, params.kind, params.repoId, params.projectId, params.offset],
    30_000,
  );
  const { data: repos } = useApi(fetchRepos, [], 60_000);
  const { data: projects } = useApi(() => fetchProjects(), [], 60_000);
  const rawItems = rawData?.items ?? null;
  const total = rawData?.total ?? 0;
  const fbState = rawData?.feedbackState ?? null;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [correctingId, setCorrectingId] = useState<string | null>(null);
  const [prefetched, setPrefetched] = useState<Observation | null>(null);
  const [headerVideoEnded, setHeaderVideoEnded] = useState(false);
  const { pulseId, scrollRef, highlightId } = useHighlight(expanded, setExpanded);

  // Prefetch highlighted observation if it's not in the current list
  useEffect(() => {
    if (!highlightId || !rawItems) return;
    if (rawItems.some(o => o.id === highlightId)) { setPrefetched(null); return; }
    if (prefetched?.id === highlightId) return;
    (async () => {
      const resp = await lookupEntity<Observation>('observation', highlightId);
      if (resp?.item) setPrefetched(resp.item);
    })();
  }, [highlightId, rawItems]);

  // Merge prefetched item with list, de-duplicated
  const data = useMemo(() => {
    if (!rawItems) return null;
    if (!prefetched || rawItems.some(o => o.id === prefetched.id)) return rawItems;
    return [prefetched, ...rawItems];
  }, [rawItems, prefetched]);

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
        {headerVideoEnded ? (
          <img src="/ghost/observations-header.png" alt="" className="w-[80px] h-[80px] rounded-full object-cover" />
        ) : (
          <video
            autoPlay
            muted
            playsInline
            poster="/ghost/observations-header.png"
            onEnded={() => setHeaderVideoEnded(true)}
            className="w-[80px] h-[80px] rounded-full object-cover"
            src="/ghost/observations-header.mp4"
          />
        )}
        <h1 className="text-xl font-semibold">Observations</h1>
        <FilterTabs options={STATUS_OPTIONS} active={params.status} onChange={(v) => setParam('status', v)} />
      </div>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs text-text-muted">Severity:</span>
        <FilterTabs options={SEVERITY_OPTIONS} active={params.severity} onChange={(v) => setParam('severity', v)} />
      </div>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <span className="text-xs text-text-muted">Kind:</span>
        <FilterTabs options={OBS_KIND_OPTIONS} active={params.kind} onChange={(v) => setParam('kind', v)} />
        {(repos && repos.length > 1 || projects && projects.length > 0) && <span className="text-border mx-1">|</span>}
        {repos && repos.length > 1 && (
          <select value={params.repoId} onChange={e => setParam('repoId', e.target.value)}
            className="text-xs bg-bg border border-border rounded px-2 py-1 text-text outline-none focus:border-accent">
            <option value="">All repos</option>
            {repos.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        )}
        {projects && projects.length > 0 && (
          <select value={params.projectId} onChange={e => setParam('projectId', e.target.value)}
            className="text-xs bg-bg border border-border rounded px-2 py-1 text-text outline-none focus:border-accent">
            <option value="">All projects</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
      </div>

      {!data ? (
        <div className="text-text-dim">Loading...</div>
      ) : data.length === 0 ? (
        <EmptyState
          title={params.status === 'open' ? 'All clear' : 'No observations'}
          description={params.status === 'open' ? 'No open observations' : `No ${params.status === 'all' ? '' : params.status + ' '}observations found`}
        />
      ) : (
        <div className="flex flex-col gap-2">
          {data.map((obs) => {
            const isOpen = expanded.has(obs.id);
            const isTerminal = TERMINAL_STATUSES.has(obs.status);
            const borderColor = OBS_SEVERITY_BORDER[obs.severity] ?? 'border-l-border';
            const icon = OBS_SEVERITY_ICON[obs.severity] ?? '○';
            const iconColor = OBS_SEVERITY_ICON_COLOR[obs.severity] ?? 'text-text-muted';

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
                  <Badge className={OBS_KIND_COLORS[obs.kind] ?? OBS_KIND_COLOR_DEFAULT}>{obs.kind}</Badge>
                  <span className="text-[13px] flex-1 min-w-0 truncate">{obs.title}</span>
                  {obs.votes > 1 && <Badge title="Times seen" className="text-orange bg-orange/15">{obs.votes}x</Badge>}

                  {/* Inline actions */}
                  {obs.status === 'open' && (
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
                  {obs.status === 'done' && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleReopen(obs.id); }}
                      className="text-xs text-text-muted hover:text-orange bg-transparent border-none cursor-pointer"
                    >Reopen</button>
                  )}

                  <button
                    onClick={(e) => { e.stopPropagation(); setCorrectingId(obs.id); }}
                    className="px-2 py-0.5 rounded text-xs bg-orange-400/15 text-orange-300 hover:bg-orange-400/25 border-none cursor-pointer"
                  >Correct</button>

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
                      <Badge className={OBS_KIND_COLORS[obs.kind] ?? OBS_KIND_COLOR_DEFAULT}>{obs.kind}</Badge>
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
      {(() => {
        const obs = data?.find(o => o.id === correctingId);
        const repoEntity = obs?.entities?.find((e: { type: string }) => e.type === 'repo');
        const repoName = repoEntity ? repos?.find(r => r.id === repoEntity.id)?.name : undefined;
        return (
          <CorrectionPanel
            open={correctingId !== null}
            onClose={() => setCorrectingId(null)}
            defaultTitle={obs ? `Re: ${obs.title}` : undefined}
            {...(repoEntity && repoName ? {
              defaultScope: 'repo',
              defaultEntityType: 'repo',
              defaultEntityId: repoEntity.id,
              defaultEntityName: repoName,
            } : {})}
          />
        );
      })()}
    </div>
  );
}
