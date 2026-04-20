import { useWorkspace } from './WorkspaceContext';
import { useApi } from '../../../hooks/useApi';
import { fetchStatus, fetchRepos } from '../../../api/client';

export function WorkspaceHeader() {
  const { state, setFilter, setRepo } = useWorkspace();
  const { data: status } = useApi(fetchStatus, [], 15_000);
  const { data: repos } = useApi(fetchRepos, [], 60_000);

  const counts = status?.counts;

  const metrics: Array<{ label: string; value: number; filter: 'run' | 'suggestion' | 'observation'; color: string }> = [
    { label: 'Runs', value: counts?.runsToReview ?? 0, filter: 'run', color: 'text-green' },
    { label: 'Suggestions', value: counts?.pendingSuggestions ?? 0, filter: 'suggestion', color: 'text-blue' },
    { label: 'Observations', value: counts?.activeObservations ?? 0, filter: 'observation', color: 'text-orange' },
  ];

  return (
    <div className="flex items-center gap-3 mb-3 flex-wrap">
      <img src="/ghost/workspace.webp" alt="" className="w-12 h-12 rounded-full object-cover" />
      <h1 className="text-xl font-semibold">Workspace</h1>
      <div className="flex items-center gap-2 ml-4">
        {metrics.map(m => (
          <button
            key={m.filter}
            onClick={() => setFilter(state.activeFilter === m.filter ? 'all' : m.filter)}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
              state.activeFilter === m.filter
                ? `${m.color} bg-current/10 border-current/30`
                : 'text-text-dim bg-card border-border hover:border-accent/50'
            }`}
          >
            {m.label} <span className="font-mono ml-1">{m.value}</span>
          </button>
        ))}
      </div>
      {repos && repos.length > 1 && (
        <select
          value={state.selectedRepoId ?? ''}
          onChange={e => setRepo(e.target.value || null)}
          className="ml-auto px-2 py-1 rounded-md text-xs bg-card border border-border text-text outline-none focus:border-accent cursor-pointer"
        >
          <option value="">All repos</option>
          {repos.map(r => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
      )}
    </div>
  );
}
