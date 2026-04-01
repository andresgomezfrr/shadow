import { useApi } from '../../hooks/useApi';
import { fetchHeartbeats } from '../../api/client';
import { Badge } from '../common/Badge';
import { EmptyState } from '../common/EmptyState';

const PHASE_STYLES: Record<string, string> = {
  init: 'text-blue bg-blue/15',
  active: 'text-green bg-green/15',
  idle: 'text-orange bg-orange/15',
  end: 'text-red bg-red/15',
  observe: 'text-blue bg-blue/15',
  analyze: 'text-purple bg-purple/15',
  suggest: 'text-accent bg-accent-soft',
  consolidate: 'text-orange bg-orange/15',
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function HeartbeatsPage() {
  const { data } = useApi(fetchHeartbeats, [], 30_000);

  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Heartbeats</h1>

      {!data ? (
        <div className="text-text-dim">Loading...</div>
      ) : data.length === 0 ? (
        <EmptyState icon="💜" title="No heartbeats" description="Shadow hasn't executed any cycles yet" />
      ) : (
        <div className="flex flex-col gap-2">
          {data.map((hb) => {
            const phaseClass = PHASE_STYLES[hb.phase] ?? PHASE_STYLES.init;
            const duration = hb.durationMs != null ? `${(hb.durationMs / 1000).toFixed(1)}s` : '—';
            return (
              <div key={hb.id} className="bg-card border border-border rounded-lg px-4 py-3 flex items-center gap-3 flex-wrap">
                <Badge className={phaseClass}>{hb.phase}</Badge>
                {hb.activity && (
                  <span className="text-xs text-text-dim">{hb.activity}</span>
                )}
                <span className="text-xs text-text-muted ml-auto shrink-0">
                  {duration} &middot; {hb.observationsCreated} obs &middot; {hb.suggestionsCreated} sug
                </span>
                <span className="text-xs text-text-muted shrink-0">{timeAgo(hb.startedAt)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
