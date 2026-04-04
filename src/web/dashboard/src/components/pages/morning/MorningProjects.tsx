import { Badge } from '../../common/Badge';
import type { ActiveProjectSummary } from '../../../api/types';

const KIND_COLORS: Record<string, string> = {
  'long-term': 'text-blue bg-blue/15',
  sprint: 'text-orange bg-orange/15',
  task: 'text-green bg-green/15',
};

export function MorningProjects({ projects }: { projects: ActiveProjectSummary[] }) {
  if (projects.length === 0) return null;

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">📋 Active projects</h2>
        <a href="/projects" className="text-xs text-accent hover:underline">View all</a>
      </div>
      <div className="flex flex-col gap-2">
        {projects.map((p) => (
          <a
            key={p.id}
            href={`/projects/${p.id}`}
            className="bg-card border border-border rounded-lg px-4 py-3 hover:border-accent/50 transition-colors no-underline block"
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="font-medium text-sm">{p.name}</span>
              <Badge className={KIND_COLORS[p.kind] ?? 'text-text-dim bg-text-dim/15'}>{p.kind}</Badge>
            </div>
            <div className="flex items-center gap-4 text-xs text-text-dim">
              <span>{p.repoCount} repos</span>
              <span>{p.systemCount} systems</span>
              {p.observationCount > 0 && <span className="text-orange">{p.observationCount} observations</span>}
              {p.suggestionCount > 0 && <span className="text-blue">{p.suggestionCount} suggestions</span>}
            </div>
            {p.topObservation && (
              <div className="text-xs text-text-muted mt-1 truncate">Top: {p.topObservation}</div>
            )}
          </a>
        ))}
      </div>
    </section>
  );
}
