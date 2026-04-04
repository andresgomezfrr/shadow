import { useParams, Link } from 'react-router-dom';
import { useApi } from '../../hooks/useApi';
import { fetchSystemDetail } from '../../api/client';
import { Badge } from '../common/Badge';
import { SEVERITY_COLORS, LAYER_COLORS } from '../../api/types';

export function SystemDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data } = useApi(() => fetchSystemDetail(id!), [id], 30_000);

  if (!data) return <div className="text-text-dim">Loading...</div>;
  if ('error' in data) return <div className="text-red">System not found</div>;

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <Link to="/systems" className="text-text-dim text-xs hover:text-accent mb-2 inline-block">&larr; Systems</Link>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">{data.name}</h1>
          <Badge className="text-purple bg-purple/15">{data.kind}</Badge>
        </div>
        {data.description && <p className="text-text-dim mt-1">{data.description}</p>}
      </div>

      {/* Operational info */}
      <div className="bg-card border border-border rounded-lg p-4 mb-6">
        <h2 className="text-sm font-medium mb-2">Operational Info</h2>
        <div className="grid grid-cols-2 gap-2 text-sm">
          {data.url && (
            <div><span className="text-text-dim">URL:</span> <span className="text-blue">{data.url}</span></div>
          )}
          {data.accessMethod && (
            <div><span className="text-text-dim">Access:</span> {data.accessMethod}</div>
          )}
          {data.healthCheck && (
            <div><span className="text-text-dim">Health check:</span> <code className="text-xs">{data.healthCheck}</code></div>
          )}
          {data.lastCheckedAt && (
            <div><span className="text-text-dim">Last checked:</span> {new Date(data.lastCheckedAt).toLocaleString()}</div>
          )}
        </div>
      </div>

      {/* Counts */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-card border border-border rounded-lg p-3 text-center">
          <div className="text-2xl font-bold">{data.counts.observations}</div>
          <div className="text-xs text-text-dim">Observations</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-3 text-center">
          <div className="text-2xl font-bold">{data.counts.memories}</div>
          <div className="text-xs text-text-dim">Memories</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-3 text-center">
          <div className="text-2xl font-bold">{data.counts.projects}</div>
          <div className="text-xs text-text-dim">Projects</div>
        </div>
      </div>

      {/* Related projects */}
      {data.projects.length > 0 && (
        <div className="mb-6">
          <h2 className="text-lg font-medium mb-3">Projects</h2>
          <div className="flex flex-wrap gap-2">
            {data.projects.map((p) => (
              <Link key={p.id} to={`/projects/${p.id}`}>
                <Badge className="text-blue bg-blue/10 hover:bg-blue/20 cursor-pointer">
                  {p.name} ({p.kind})
                </Badge>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Observations */}
      <div className="mb-6">
        <h2 className="text-lg font-medium mb-3">Observations ({data.counts.observations})</h2>
        {data.observations.length === 0 ? (
          <div className="text-text-dim text-sm">No active observations</div>
        ) : (
          <div className="space-y-2">
            {data.observations.map((o) => (
              <div key={o.id} className="bg-card border border-border rounded p-3">
                <div className="flex items-center gap-2">
                  <Badge className={SEVERITY_COLORS[o.severity] ?? ''}>{o.severity}</Badge>
                  <Badge className="text-text-dim bg-text-dim/10">{o.kind}</Badge>
                </div>
                <div className="text-sm mt-1">{o.title}</div>
                <div className="text-xs text-text-dim mt-1">{new Date(o.createdAt).toLocaleDateString()}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Memories */}
      {data.memories.length > 0 && (
        <div className="mb-6">
          <h2 className="text-lg font-medium mb-3">Memories ({data.counts.memories})</h2>
          <div className="space-y-2">
            {data.memories.map((m) => (
              <div key={m.id} className="bg-card border border-border rounded p-3 flex items-center gap-2">
                <Badge className={LAYER_COLORS[m.layer] ?? ''}>{m.layer}</Badge>
                <Badge className="text-text-dim bg-text-dim/10">{m.kind}</Badge>
                <span className="text-sm">{m.title}</span>
                <span className="text-xs text-text-dim ml-auto">{new Date(m.createdAt).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="text-xs text-text-dim border-t border-border pt-3">
        Created: {new Date(data.createdAt).toLocaleDateString()}
      </div>
    </div>
  );
}
