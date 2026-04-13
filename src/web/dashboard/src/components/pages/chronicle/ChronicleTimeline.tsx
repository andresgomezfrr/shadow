import type { ChronicleEntry } from '../../../api/types';

type Props = {
  entries: ChronicleEntry[];
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function ChronicleTimeline({ entries }: Props) {
  if (entries.length === 0) {
    return (
      <section className="bg-card border border-border rounded-lg p-5 mb-6">
        <h2 className="text-base font-semibold mb-3">Chronicle</h2>
        <p className="text-text-muted italic text-sm">
          The Chronicle is blank. The first words will be written when a threshold is crossed.
        </p>
      </section>
    );
  }

  return (
    <section className="bg-card border border-border rounded-lg p-5 mb-6">
      <h2 className="text-base font-semibold mb-4">Chronicle</h2>
      <ol className="space-y-4">
        {entries.map((e) => (
          <li key={e.id} className="pl-4 border-l-2 border-accent/30">
            <div className="flex items-baseline gap-2 mb-1">
              <h3 className="text-sm font-semibold text-accent">{e.title}</h3>
              <span className="text-[10px] text-text-muted uppercase tracking-wide">
                {e.kind === 'tier_lore' ? 'Tier crossing' : 'Milestone'}
              </span>
              <span className="text-[10px] text-text-muted ml-auto">{formatDate(e.createdAt)}</span>
            </div>
            <p className="text-sm text-text-dim italic leading-relaxed">{e.bodyMd}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
