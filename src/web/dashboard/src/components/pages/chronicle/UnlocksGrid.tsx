import type { Unlockable } from '../../../api/types';
import { BOND_TIER_BADGES } from '../../../api/types';

type Props = {
  unlockables: Unlockable[];
  currentTier: number;
};

export function UnlocksGrid({ unlockables, currentTier }: Props) {
  // Sort by tier required
  const sorted = [...unlockables].sort((a, b) => a.tierRequired - b.tierRequired);

  return (
    <section className="bg-card border border-border rounded-lg p-5 mb-6">
      <h2 className="text-base font-semibold mb-4">Unlocks</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {sorted.map((u) => {
          const reached = u.tierRequired <= currentTier;
          const showTitle = u.unlocked || reached;
          return (
            <div
              key={u.id}
              className={`rounded-lg p-3 border transition-all
                ${u.unlocked ? 'bg-accent-soft border-accent/40' : 'bg-bg border-border opacity-60'}
              `}
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">
                  {u.unlocked ? '✨' : '🔒'}
                </span>
                <span className="text-[10px] uppercase tracking-wider text-text-muted">
                  Lv.{u.tierRequired} {BOND_TIER_BADGES[u.tierRequired]}
                </span>
              </div>
              <p className={`text-sm font-semibold ${u.unlocked ? 'text-accent' : 'text-text-muted'}`}>
                {showTitle ? u.title : '???'}
              </p>
              {u.description && showTitle && (
                <p className="text-[11px] text-text-dim mt-1 italic">{u.description}</p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
