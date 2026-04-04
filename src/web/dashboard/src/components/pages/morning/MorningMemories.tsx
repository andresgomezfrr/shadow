import { timeAgo } from '../../../utils/format';
import { Badge } from '../../common/Badge';
import { LAYER_COLORS } from '../../../api/types';
import type { DailySummary } from '../../../api/types';

export function MorningMemories({ memories }: { memories: DailySummary['recentMemories'] }) {
  if (memories.length === 0) return null;

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">🧠 What Shadow learned today</h2>
        <a href="/memories" className="text-xs text-accent hover:underline">View all</a>
      </div>
      <div className="flex flex-col gap-1.5">
        {memories.map((m) => (
          <a key={m.id} href={`/memories?highlight=${m.id}`} className="bg-card border border-border rounded-lg px-4 py-2.5 flex items-center gap-2 hover:border-accent/50 transition-colors no-underline">
            <Badge className={LAYER_COLORS[m.layer] ?? LAYER_COLORS.cold}>{m.layer}</Badge>
            <Badge className="text-text-dim bg-border">{m.kind}</Badge>
            <span className="text-[13px] flex-1 truncate">{m.title}</span>
            <span className="text-xs text-text-muted shrink-0">{timeAgo(m.createdAt)}</span>
          </a>
        ))}
      </div>
    </section>
  );
}
