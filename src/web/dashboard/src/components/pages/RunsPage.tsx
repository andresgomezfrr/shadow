import { useApi } from '../../hooks/useApi';
import { fetchRuns } from '../../api/client';
import { Badge } from '../common/Badge';
import { EmptyState } from '../common/EmptyState';

const STATUS_STYLES: Record<string, string> = {
  pending: 'text-orange bg-orange/15',
  running: 'text-blue bg-blue/15',
  completed: 'text-green bg-green/15',
  failed: 'text-red bg-red/15',
};

export function RunsPage() {
  const { data } = useApi(fetchRuns, [], 30_000);

  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Runs</h1>

      {!data ? (
        <div className="text-text-dim">Loading...</div>
      ) : data.length === 0 ? (
        <EmptyState icon="▶" title="No runs" description="Shadow hasn't executed any tasks yet" />
      ) : (
        <div className="flex flex-col gap-2">
          {data.map((r) => {
            const statusClass = STATUS_STYLES[r.status] ?? STATUS_STYLES.pending;
            return (
              <div key={r.id} className="bg-card border border-border rounded-lg p-4 transition-colors hover:border-accent">
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <Badge className={statusClass}>{r.status}</Badge>
                  <Badge className="text-text-dim bg-border">{r.kind}</Badge>
                  <span className="text-xs text-text-muted ml-auto">
                    {r.createdAt ? new Date(r.createdAt).toLocaleString('en-US') : ''}
                  </span>
                </div>
                <div className="text-[13px] text-text-dim">{r.prompt}</div>
                {r.resultSummaryMd && (
                  <div className="mt-2 text-[13px] text-green">{r.resultSummaryMd}</div>
                )}
                {r.errorSummary && (
                  <div className="mt-2 text-[13px] text-red">{r.errorSummary}</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
