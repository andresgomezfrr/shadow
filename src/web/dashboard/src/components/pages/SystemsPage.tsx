import { Link } from 'react-router-dom';
import { useApi } from '../../hooks/useApi';
import { fetchSystems } from '../../api/client';
import { Badge } from '../common/Badge';
import { EmptyState } from '../common/EmptyState';

export function SystemsPage() {
  const { data } = useApi(fetchSystems, [], 30_000);

  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Systems</h1>

      {!data ? (
        <div className="text-text-dim">Loading...</div>
      ) : data.length === 0 ? (
        <EmptyState icon="🔧" title="No systems" description="Register systems with: shadow system add <name>" />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {data.map((s) => (
            <Link
              key={s.id}
              to={`/systems/${s.id}`}
              className="bg-card border border-border rounded-lg p-4 transition-colors hover:border-accent block"
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="font-medium text-sm">{s.name}</span>
                <Badge className="text-purple bg-purple/15">{s.kind}</Badge>
              </div>
              {s.description && (
                <div className="text-xs text-text-dim mb-2">{s.description}</div>
              )}
              {s.url && (
                <div className="text-xs text-blue truncate">{s.url}</div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
