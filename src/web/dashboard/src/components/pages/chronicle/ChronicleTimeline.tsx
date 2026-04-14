import { useState } from 'react';
import type { ChronicleEntry } from '../../../api/types';
import { TIER_PORTRAITS, getMilestoneIcon } from './images';
import { ChronicleLightbox } from './ChronicleLightbox';

type Props = {
  entries: ChronicleEntry[];
};

function iconFor(entry: ChronicleEntry): string | null {
  if (entry.kind === 'tier_lore' && entry.tier != null) return TIER_PORTRAITS[entry.tier] ?? null;
  if (entry.kind === 'milestone' && entry.milestoneKey) return getMilestoneIcon(entry.milestoneKey);
  return null;
}

function subtitleFor(entry: ChronicleEntry): string {
  return entry.kind === 'tier_lore' ? `Tier crossing · Lv.${entry.tier ?? '?'}` : 'Milestone';
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function ChronicleTimeline({ entries }: Props) {
  const [selected, setSelected] = useState<ChronicleEntry | null>(null);

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
        {entries.map((e) => {
          const icon = iconFor(e);
          return (
            <li key={e.id} className="pl-4 border-l-2 border-accent/30 flex gap-3">
              {icon && (
                <button
                  type="button"
                  onClick={() => setSelected(e)}
                  className="focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-full flex-shrink-0 mt-0.5"
                  aria-label={`View ${e.title}`}
                >
                  <img
                    src={icon}
                    alt=""
                    className="w-12 h-12 rounded-full object-cover cursor-pointer transition-all hover:brightness-110 hover:scale-105"
                  />
                </button>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 mb-1">
                  <h3 className="text-sm font-semibold text-accent">{e.title}</h3>
                  <span className="text-[10px] text-text-muted uppercase tracking-wide">
                    {e.kind === 'tier_lore' ? 'Tier crossing' : 'Milestone'}
                  </span>
                  <span className="text-[10px] text-text-muted ml-auto">{formatDate(e.createdAt)}</span>
                </div>
                <p className="text-sm text-text-dim italic leading-relaxed">{e.bodyMd}</p>
              </div>
            </li>
          );
        })}
      </ol>

      {selected && iconFor(selected) && (
        <ChronicleLightbox
          src={iconFor(selected)!}
          title={selected.title}
          subtitle={subtitleFor(selected)}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
}
