import { Badge } from '../../common/Badge';
import type { EnrichmentItem } from '../../../api/types';

export function MorningEnrichment({ items }: { items: EnrichmentItem[] }) {
  if (items.length === 0) return null;

  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold mb-3">🔗 External context</h2>
      <div className="flex flex-col gap-1.5">
        {items.map((item) => (
          <div
            key={item.id}
            className="bg-card border border-border rounded-lg px-4 py-2.5 flex items-center gap-2.5"
          >
            <Badge className="text-amber-400 bg-amber-400/15">{item.source}</Badge>
            {item.entityName && (
              <span className="text-xs text-text-dim">{item.entityName}</span>
            )}
            <span className="text-[13px] text-text flex-1 truncate">{item.summary}</span>
            <span className="text-xs text-text-muted">{new Date(item.createdAt).toLocaleTimeString()}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
