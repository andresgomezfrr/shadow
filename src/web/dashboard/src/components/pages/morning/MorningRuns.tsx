import { timeAgo } from '../../../utils/format';
import { Badge } from '../../common/Badge';
import { ConfidenceIndicator } from '../../common/ConfidenceIndicator';
import type { Run } from '../../../api/types';

export function MorningRuns({ runs }: { runs: Run[] }) {
  if (runs.length === 0) return null;

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">▶ Runs to review</h2>
        <a href="/runs" className="text-xs text-accent hover:underline">View all</a>
      </div>
      <div className="flex flex-col gap-1.5">
        {runs.map((r) => (
          <a key={r.id} href={`/runs?highlight=${r.id}`} className="bg-card border border-l-[3px] border-l-green border-border rounded-lg px-4 py-2.5 flex items-center gap-2.5 hover:border-accent/50 transition-colors no-underline">
            <span className="text-sm font-mono text-green w-4 text-center">✓</span>
            <Badge className="text-text-dim bg-border">{r.kind}</Badge>
            {r.confidence && <ConfidenceIndicator confidence={r.confidence} doubts={r.doubts?.length} compact />}
            <span className="text-[13px] text-text flex-1 truncate">{r.prompt.slice(0, 80)}</span>
            <span className="text-xs text-text-muted shrink-0">{timeAgo(r.createdAt)}</span>
          </a>
        ))}
      </div>
    </section>
  );
}
