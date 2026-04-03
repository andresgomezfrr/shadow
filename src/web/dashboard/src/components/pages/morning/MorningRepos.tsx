import { timeAgo } from '../../../utils/format';
import type { DailySummary } from '../../../api/types';

export function MorningRepos({ repos }: { repos: DailySummary['repos'] }) {
  if (repos.length === 0) return null;

  return (
    <section>
      <h2 className="text-lg font-semibold mb-4">📁 Active repos</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {repos.map((r) => (
          <div key={r.id} className="bg-card border border-border rounded-lg px-4 py-3">
            <div className="font-medium text-sm">{r.name}</div>
            <div className="text-xs text-text-muted truncate">{r.path}</div>
            {r.lastObservedAt && (
              <div className="text-xs text-text-dim mt-1">{timeAgo(r.lastObservedAt)}</div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
