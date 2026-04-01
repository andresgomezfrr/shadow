import { useApi } from '../../hooks/useApi';
import { fetchObservations } from '../../api/client';
import { SEVERITY_COLORS } from '../../api/types';
import { Badge } from '../common/Badge';
import { EmptyState } from '../common/EmptyState';
import { useState } from 'react';

export function ObservationsPage() {
  const { data } = useApi(() => fetchObservations(50), [], 30_000);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Observations</h1>

      {!data ? (
        <div className="text-text-dim">Loading...</div>
      ) : data.length === 0 ? (
        <EmptyState icon="👀" title="No observations" description="Shadow hasn't generated any observations yet" />
      ) : (
        <div className="flex flex-col gap-2">
          {data.map((obs) => {
            const sevClass = SEVERITY_COLORS[obs.severity] ?? SEVERITY_COLORS.info;
            const isOpen = expanded.has(obs.id);
            return (
              <div
                key={obs.id}
                onClick={() => toggle(obs.id)}
                className="bg-card border border-border rounded-lg px-4 py-3 cursor-pointer transition-colors hover:border-accent"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge className={sevClass}>{obs.severity}</Badge>
                  <Badge className="text-text-dim bg-border">{obs.kind}</Badge>
                  <span className="text-[13px] flex-1 truncate">{obs.title}</span>
                  <span className="text-xs text-text-muted shrink-0">
                    {new Date(obs.createdAt).toLocaleString('en-US', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}
                  </span>
                </div>
                {isOpen && Object.keys(obs.detail).length > 0 && (
                  <div className="mt-3 animate-fade-in">
                    <div className="bg-bg rounded p-3 text-xs text-text-dim font-mono space-y-1">
                      {Object.entries(obs.detail).map(([k, v]) => (
                        <div key={k}>
                          <span className="text-accent">{k}:</span>{' '}
                          <span>{typeof v === 'string' ? v : JSON.stringify(v)}</span>
                        </div>
                      ))}
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
