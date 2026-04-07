import { useApi } from '../../hooks/useApi';
import { fetchContacts } from '../../api/client';
import { Badge } from '../common/Badge';
import { EmptyState } from '../common/EmptyState';

export function TeamPage() {
  const { data } = useApi(fetchContacts, [], 30_000);

  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Team</h1>

      {!data ? (
        <div className="text-text-dim">Loading...</div>
      ) : data.length === 0 ? (
        <EmptyState title="No contacts" description="Add contacts with: shadow contact add <name>" />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {data.map((c) => (
            <div key={c.id} className="bg-card border border-border rounded-lg p-4 transition-colors hover:border-accent">
              <div className="font-medium text-sm mb-1">{c.name}</div>
              <div className="flex gap-1.5 flex-wrap mb-2">
                {c.role && <Badge className="text-accent bg-accent-soft">{c.role}</Badge>}
                {c.team && <Badge className="text-blue bg-blue/15">{c.team}</Badge>}
              </div>
              {c.email && <div className="text-xs text-text-dim">{c.email}</div>}
              {c.githubHandle && <div className="text-xs text-text-muted">@{c.githubHandle}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
