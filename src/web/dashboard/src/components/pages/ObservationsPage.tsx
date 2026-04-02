import { useApi } from '../../hooks/useApi';
import { fetchObservations, acknowledgeObservation, resolveObservation, reopenObservation, sendFeedback } from '../../api/client';
import { SEVERITY_COLORS, STATUS_COLORS } from '../../api/types';
import { Badge } from '../common/Badge';
import { EmptyState } from '../common/EmptyState';
import { FilterTabs } from '../common/FilterTabs';
import { useState, useCallback } from 'react';
import { useHighlight } from '../../hooks/useHighlight';

const STATUS_OPTIONS = [
  { label: 'Active', value: 'active' },
  { label: 'Acknowledged', value: 'acknowledged' },
  { label: 'Resolved', value: 'resolved' },
  { label: 'All', value: 'all' },
];

export function ObservationsPage() {
  const [status, setStatus] = useState('active');
  const { data, refresh } = useApi(() => fetchObservations(50, status), [status], 30_000);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const { pulseId, scrollRef } = useHighlight(expanded, setExpanded);

  const toggle = (id: string) => {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAck = useCallback(async (id: string) => {
    await acknowledgeObservation(id);
    refresh();
  }, [refresh]);

  const handleResolve = useCallback(async (id: string) => {
    const note = window.prompt('Reason for resolving (optional):');
    await resolveObservation(id, note || undefined);
    refresh();
  }, [refresh]);

  const handleReopen = useCallback(async (id: string) => {
    await reopenObservation(id);
    refresh();
  }, [refresh]);

  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Observations</h1>

      <div className="mb-4">
        <FilterTabs options={STATUS_OPTIONS} active={status} onChange={setStatus} />
      </div>

      {!data ? (
        <div className="text-text-dim">Loading...</div>
      ) : data.length === 0 ? (
        <EmptyState icon="👀" title="No observations" description={`No ${status === 'all' ? '' : status + ' '}observations found`} />
      ) : (
        <div className="flex flex-col gap-2">
          {data.map((obs) => {
            const sevClass = SEVERITY_COLORS[obs.severity] ?? SEVERITY_COLORS.info;
            const statusClass = STATUS_COLORS[obs.status] ?? STATUS_COLORS.active;
            const isOpen = expanded.has(obs.id);
            return (
              <div
                key={obs.id}
                ref={scrollRef(obs.id)}
                onClick={() => toggle(obs.id)}
                className={`bg-card border rounded-lg px-4 py-3 cursor-pointer transition-colors hover:border-accent ${pulseId === obs.id ? 'border-accent ring-2 ring-accent/30' : 'border-border'}`}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge title="Severity" className={sevClass}>{obs.severity}</Badge>
                  <Badge title="Observation kind" className="text-text-dim bg-border">{obs.kind}</Badge>
                  {obs.votes > 1 && (
                    <Badge title="Times seen" className="text-orange bg-orange/15">{obs.votes}x</Badge>
                  )}
                  <Badge title="Lifecycle status" className={statusClass}>{obs.status}</Badge>
                  <span className="text-[13px] flex-1 truncate">{obs.title}</span>
                  {obs.status === 'active' && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleAck(obs.id); }}
                      className="text-xs text-blue hover:underline bg-transparent border-none cursor-pointer"
                    >ack</button>
                  )}
                  {(obs.status === 'active' || obs.status === 'acknowledged') && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleResolve(obs.id); }}
                      className="text-xs text-green hover:underline bg-transparent border-none cursor-pointer"
                    >resolve</button>
                  )}
                  {(obs.status === 'acknowledged' || obs.status === 'resolved') && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleReopen(obs.id); }}
                      className="text-xs text-orange hover:underline bg-transparent border-none cursor-pointer"
                    >reopen</button>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); sendFeedback('observation', obs.id, 'thumbs_up'); }}
                    className="text-xs bg-transparent border-none cursor-pointer opacity-40 hover:opacity-100 transition-opacity"
                    title="More like this"
                  >👍</button>
                  <button
                    onClick={(e) => { e.stopPropagation(); sendFeedback('observation', obs.id, 'thumbs_down'); }}
                    className="text-xs bg-transparent border-none cursor-pointer opacity-40 hover:opacity-100 transition-opacity"
                    title="Less like this"
                  >👎</button>
                  <span className="text-xs text-text-muted shrink-0">
                    {new Date(obs.lastSeenAt).toLocaleString('en-US', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}
                  </span>
                </div>
                {isOpen && (
                  <div className="mt-3 animate-fade-in space-y-2">
                    {typeof obs.detail?.description === 'string' && obs.detail.description && (
                      <p className="text-[13px] text-text-dim leading-relaxed m-0">{obs.detail.description}</p>
                    )}

                    {obs.context && Object.keys(obs.context).length > 0 && (
                      <div className="bg-bg rounded p-3 text-xs space-y-1">
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

                    {Object.entries(obs.detail ?? {})
                      .filter(([k]) => k !== 'description')
                      .map(([k, v]) => (
                        <div key={k} className="text-xs text-text-muted">
                          <span className="text-accent">{k}:</span>{' '}
                          <span>{typeof v === 'string' ? v : JSON.stringify(v, null, 2)}</span>
                        </div>
                      ))}

                    <div className="text-xs text-text-muted pt-1">
                      First seen: {new Date(obs.firstSeenAt).toLocaleString('en-US', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}
                      {obs.votes > 1 && <> &middot; Seen {obs.votes} times</>}
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
