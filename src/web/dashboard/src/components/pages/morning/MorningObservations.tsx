import { Badge } from '../../common/Badge';
import { SEVERITY_COLORS } from '../../../api/types';
import type { Observation } from '../../../api/types';

export function MorningObservations({ observations }: { observations: Observation[] }) {
  if (observations.length === 0) return null;

  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold mb-4">👀 Active observations</h2>
      <div className="flex flex-col gap-2">
        {observations.map((obs) => {
          const sevClass = SEVERITY_COLORS[obs.severity] ?? SEVERITY_COLORS.info;
          return (
            <a key={obs.id} href={`/observations?highlight=${obs.id}`} className="bg-card border border-border rounded-lg px-4 py-3 flex items-center gap-3 hover:border-accent transition-colors no-underline">
              <Badge className={sevClass}>{obs.severity}</Badge>
              <Badge className="text-text-dim bg-border">{obs.kind}</Badge>
              {obs.votes > 1 && <Badge className="text-orange bg-orange/15">{obs.votes}x</Badge>}
              <span className="text-[13px] text-text flex-1 truncate">{obs.title}</span>
            </a>
          );
        })}
      </div>
    </section>
  );
}
