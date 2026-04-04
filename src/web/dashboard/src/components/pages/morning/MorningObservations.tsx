import { Badge } from '../../common/Badge';
import type { Observation } from '../../../api/types';

const SEVERITY_BORDER: Record<string, string> = {
  high: 'border-l-red',
  warning: 'border-l-orange',
  info: 'border-l-blue',
};

const SEVERITY_ICON: Record<string, string> = { high: '●', warning: '▲', info: '○' };
const SEVERITY_ICON_COLOR: Record<string, string> = { high: 'text-red', warning: 'text-orange', info: 'text-blue' };

export function MorningObservations({ observations }: { observations: Observation[] }) {
  if (observations.length === 0) return null;

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">👀 Active observations</h2>
        <a href="/observations" className="text-xs text-accent hover:underline">View all</a>
      </div>
      <div className="flex flex-col gap-1.5">
        {observations.map((obs) => (
          <a
            key={obs.id}
            href={`/observations?highlight=${obs.id}`}
            className={`bg-card border border-l-[3px] ${SEVERITY_BORDER[obs.severity] ?? 'border-l-border'} border-border rounded-lg px-4 py-2.5 flex items-center gap-2.5 hover:border-accent/50 transition-colors no-underline`}
          >
            <span className={`text-sm w-4 text-center ${SEVERITY_ICON_COLOR[obs.severity] ?? 'text-text-muted'}`}>{SEVERITY_ICON[obs.severity] ?? '○'}</span>
            <Badge className="text-text-dim bg-border">{obs.kind}</Badge>
            <span className="text-[13px] text-text flex-1 truncate">{obs.title}</span>
          </a>
        ))}
      </div>
    </section>
  );
}
