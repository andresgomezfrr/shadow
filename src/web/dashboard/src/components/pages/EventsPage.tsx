import { useApi } from '../../hooks/useApi';
import { fetchEvents } from '../../api/client';
import { Badge } from '../common/Badge';
import { EmptyState } from '../common/EmptyState';

export function EventsPage() {
  const { data } = useApi(fetchEvents, [], 15_000);

  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Events</h1>

      {!data ? (
        <div className="text-text-dim">Loading...</div>
      ) : data.length === 0 ? (
        <EmptyState icon="📬" title="No pending events" description="Event queue is empty" />
      ) : (
        <div className="flex flex-col gap-2">
          {data.map((e) => (
            <div key={e.id} className="bg-card border border-border rounded-lg px-4 py-3">
              <div className="flex items-center gap-2 mb-1">
                <Badge className="text-accent bg-accent-soft">{e.kind}</Badge>
                <Badge className="text-text-dim bg-border">P{e.priority}</Badge>
                <span className="text-xs text-text-muted ml-auto">
                  {new Date(e.createdAt).toLocaleString('en-US')}
                </span>
              </div>
              {Object.keys(e.payload).length > 0 && (
                <div className="bg-bg rounded p-2 mt-2 text-xs text-text-dim font-mono">
                  {JSON.stringify(e.payload, null, 2)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
