import type { ChronicleEntry } from '../../../api/types';
import { BOND_TIER_BADGES } from '../../../api/types';

type Props = {
  tier: number;
  name: string;
  loreEntry: ChronicleEntry | null;
};

export function TierBadge({ tier, name, loreEntry }: Props) {
  const badge = BOND_TIER_BADGES[tier] ?? '👾';
  return (
    <section className="bg-card border border-border rounded-lg p-6 mb-6">
      <div className="flex items-center gap-5">
        <div className="w-24 h-24 rounded-full bg-accent-soft flex items-center justify-center text-5xl flex-shrink-0">
          {badge}
        </div>
        <div>
          <p className="text-text-dim text-xs uppercase tracking-wider">Current bond</p>
          <h1 className="text-3xl font-semibold text-accent">
            {name}
          </h1>
          <p className="text-text-muted text-sm mt-1">
            Lv.{tier}
          </p>
        </div>
      </div>
      {loreEntry && (
        <blockquote className="mt-5 pl-4 border-l-2 border-accent italic text-text text-sm leading-relaxed">
          {loreEntry.bodyMd}
        </blockquote>
      )}
    </section>
  );
}
