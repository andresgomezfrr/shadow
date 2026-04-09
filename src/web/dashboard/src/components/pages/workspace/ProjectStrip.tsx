import { useApi } from '../../../hooks/useApi';
import { fetchDailySummary } from '../../../api/client';
import { useWorkspace } from './WorkspaceContext';

export function ProjectStrip() {
  const { state, setProject } = useWorkspace();
  const { data } = useApi(fetchDailySummary, [], 60_000);

  const projects = (data?.activeProjects ?? [])
    .sort((a, b) => (b.suggestionCount + b.observationCount) - (a.suggestionCount + a.observationCount))
    .slice(0, 3);
  if (projects.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5 mb-3 overflow-x-auto">
      <button
        onClick={() => setProject(null)}
        className={`shrink-0 px-2.5 py-1 rounded-md text-xs font-medium border transition-colors cursor-pointer ${
          !state.selectedProjectId
            ? 'bg-accent/10 border-accent/30 text-accent'
            : 'bg-transparent border-transparent text-text-muted hover:text-text hover:bg-card'
        }`}
      >All</button>
      {projects.map(p => {
        const isSelected = state.selectedProjectId === p.id;
        const total = p.suggestionCount + p.observationCount;
        return (
          <button
            key={p.id}
            onClick={() => setProject(isSelected ? null : p.id)}
            className={`shrink-0 px-2.5 py-1 rounded-md text-xs font-medium border transition-colors cursor-pointer ${
              isSelected
                ? 'bg-accent/10 border-accent/30 text-accent'
                : 'bg-transparent border-transparent text-text-dim hover:text-text hover:bg-card'
            }`}
          >
            {p.name}
            {total > 0 && <span className="ml-1.5 text-text-muted font-mono">{total}</span>}
          </button>
        );
      })}
    </div>
  );
}
