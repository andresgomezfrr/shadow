import { timeAgo } from '../../../utils/format';
import { Badge } from '../../common/Badge';
import type { Run } from '../../../api/types';

export function MorningRuns({ runs }: { runs: Run[] }) {
  if (runs.length === 0) return null;

  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold mb-3">▶ Runs to review</h2>
      <div className="flex flex-col gap-1.5">
        {runs.map((r) => (
          <a key={r.id} href={`/runs?highlight=${r.id}`} className="bg-card border border-border rounded-lg px-4 py-2.5 flex items-center gap-2 hover:border-accent transition-colors no-underline">
            <Badge className="text-green bg-green/15">completed</Badge>
            <Badge className="text-text-dim bg-border">{r.kind}</Badge>
            <span className="text-[13px] text-text flex-1 truncate">{r.prompt.slice(0, 80)}</span>
            <span className="text-xs text-text-muted shrink-0">{timeAgo(r.createdAt)}</span>
          </a>
        ))}
      </div>
    </section>
  );
}
