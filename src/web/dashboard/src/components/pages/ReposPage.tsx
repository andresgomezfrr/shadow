import { timeAgo } from '../../utils/format';
import { useApi } from '../../hooks/useApi';
import { fetchRepos } from '../../api/client';
import { Badge } from '../common/Badge';
import { EmptyState } from '../common/EmptyState';


export function ReposPage() {
  const { data } = useApi(fetchRepos, [], 30_000);

  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Repos</h1>

      {!data ? (
        <div className="text-text-dim">Loading...</div>
      ) : data.length === 0 ? (
        <EmptyState icon="📁" title="No repos" description="Register repos with: shadow repo add <path>" />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {data.map((r) => (
            <div key={r.id} className="bg-card border border-border rounded-lg p-4 transition-colors hover:border-accent">
              <div className="flex items-center gap-2 mb-2">
                <span className="font-medium text-sm">{r.name}</span>
                {r.languageHint && (
                  <Badge className="text-blue bg-blue/15">{r.languageHint}</Badge>
                )}
              </div>
              <div className="text-xs text-text-muted truncate mb-2">{r.path}</div>
              <div className="text-xs text-text-dim">
                {r.defaultBranch}
                {r.lastObservedAt && ` · ${timeAgo(r.lastObservedAt)}`}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
