import { Badge } from '../../common/Badge';
import { OBS_KIND_COLORS, OBS_KIND_COLOR_DEFAULT, OBS_SEVERITY_BORDER, OBS_SEVERITY_ICON, OBS_SEVERITY_ICON_COLOR } from '../../../utils/observation-colors';
import type { Observation } from '../../../api/types';

export function MorningObservations({ observations }: { observations: Observation[] }) {
  if (observations.length === 0) return null;

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">👀 Open observations</h2>
        <a href="/observations" className="text-xs text-accent hover:underline">View all</a>
      </div>
      <div className="flex flex-col gap-1.5">
        {observations.map((obs) => (
          <a
            key={obs.id}
            href={`/observations?highlight=${obs.id}`}
            className={`bg-card border border-l-[3px] ${OBS_SEVERITY_BORDER[obs.severity] ?? 'border-l-border'} border-border rounded-lg px-4 py-2.5 flex items-center gap-2.5 hover:border-accent/50 transition-colors no-underline`}
          >
            <span className={`text-sm w-4 text-center ${OBS_SEVERITY_ICON_COLOR[obs.severity] ?? 'text-text-muted'}`}>{OBS_SEVERITY_ICON[obs.severity] ?? '○'}</span>
            <Badge className={OBS_KIND_COLORS[obs.kind] ?? OBS_KIND_COLOR_DEFAULT}>{obs.kind}</Badge>
            <span className="text-[13px] text-text flex-1 truncate">{obs.title}</span>
          </a>
        ))}
      </div>
    </section>
  );
}
