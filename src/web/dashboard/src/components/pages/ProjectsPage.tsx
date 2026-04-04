import { Link } from 'react-router-dom';
import { useApi } from '../../hooks/useApi';
import { fetchProjects, fetchRepos, fetchSystems, fetchObservations, fetchSuggestions } from '../../api/client';
import { Badge } from '../common/Badge';
import { EmptyState } from '../common/EmptyState';

const KIND_COLORS: Record<string, string> = {
  'long-term': 'text-blue bg-blue/15',
  sprint: 'text-orange bg-orange/15',
  task: 'text-green bg-green/15',
};

const STATUS_COLORS: Record<string, string> = {
  active: 'text-green bg-green/15',
  completed: 'text-text-dim bg-text-dim/15',
  'on-hold': 'text-orange bg-orange/15',
  archived: 'text-text-dim bg-text-dim/10',
};

export function ProjectsPage() {
  const { data: projects } = useApi(fetchProjects, [], 30_000);
  const { data: repos } = useApi(fetchRepos, [], 60_000);
  const { data: systems } = useApi(fetchSystems, [], 60_000);
  const { data: obsData } = useApi(() => fetchObservations({ status: 'active', limit: 100 }), [], 60_000);
  const { data: sugData } = useApi(() => fetchSuggestions({ status: 'pending', limit: 100 }), [], 60_000);

  const repoName = (id: string) => repos?.find((r) => r.id === id)?.name ?? id.slice(0, 8);
  const systemName = (id: string) => systems?.find((s) => s.id === id)?.name ?? id.slice(0, 8);

  const obsForProject = (projectId: string) =>
    obsData?.items.filter(o => (o as unknown as { entities?: { type: string; id: string }[] }).entities?.some(e => e.type === 'project' && e.id === projectId)).length ?? 0;
  const sugsForProject = (projectId: string) =>
    sugData?.items.filter(s => (s as unknown as { entities?: { type: string; id: string }[] }).entities?.some(e => e.type === 'project' && e.id === projectId)).length ?? 0;

  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Projects</h1>

      {!projects ? (
        <div className="text-text-dim">Loading...</div>
      ) : projects.length === 0 ? (
        <EmptyState
          icon="📁"
          title="No projects"
          description="Create a project with: shadow project add <name> --repos repo1,repo2"
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {projects.map((p) => {
            const obsCount = obsForProject(p.id);
            const sugCount = sugsForProject(p.id);
            return (
              <Link
                key={p.id}
                to={`/projects/${p.id}`}
                className="bg-card border border-border rounded-lg p-4 transition-colors hover:border-accent block"
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-medium">{p.name}</span>
                  <Badge className={KIND_COLORS[p.kind] ?? 'text-text-dim bg-text-dim/15'}>
                    {p.kind}
                  </Badge>
                  <Badge className={STATUS_COLORS[p.status] ?? 'text-text-dim bg-text-dim/15'}>
                    {p.status}
                  </Badge>
                </div>

                {p.description && (
                  <div className="text-sm text-text-dim mb-3">{p.description}</div>
                )}

                {p.repoIds.length > 0 && (
                  <div className="mb-2">
                    <span className="text-xs text-text-dim mr-2">Repos:</span>
                    {p.repoIds.map((id) => (
                      <Badge key={id} className="text-blue bg-blue/10 mr-1">
                        {repoName(id)}
                      </Badge>
                    ))}
                  </div>
                )}

                {p.systemIds.length > 0 && (
                  <div className="mb-2">
                    <span className="text-xs text-text-dim mr-2">Systems:</span>
                    {p.systemIds.map((id) => (
                      <Badge key={id} className="text-purple bg-purple/10 mr-1">
                        {systemName(id)}
                      </Badge>
                    ))}
                  </div>
                )}

                <div className="flex items-center gap-3 mt-3 text-xs text-text-dim">
                  {obsCount > 0 && <span className="text-orange">{obsCount} obs</span>}
                  {sugCount > 0 && <span className="text-blue">{sugCount} suggestions</span>}
                  {p.startDate && <span>Start: {new Date(p.startDate).toLocaleDateString()}</span>}
                  <span className="ml-auto">Created: {new Date(p.createdAt).toLocaleDateString()}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
