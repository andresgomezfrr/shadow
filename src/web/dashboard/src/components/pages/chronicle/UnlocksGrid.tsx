import { useState } from 'react';
import type { Unlockable } from '../../../api/types';
import { UNLOCK_PLACEHOLDER, TIER_PORTRAITS } from './images';
import { ChronicleLightbox } from './ChronicleLightbox';

type Props = {
  unlockables: Unlockable[];
  currentTier: number;
};

export function UnlocksGrid({ unlockables, currentTier }: Props) {
  const [selected, setSelected] = useState<Unlockable | null>(null);
  const sorted = [...unlockables].sort((a, b) => a.tierRequired - b.tierRequired);

  return (
    <section className="bg-card border border-border rounded-lg p-5 mb-6">
      <h2 className="text-base font-semibold mb-4">Unlocks</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {sorted.map((u) => {
          const reached = u.tierRequired <= currentTier;
          const showTitle = u.unlocked || reached;
          const iconSrc = u.unlocked ? TIER_PORTRAITS[u.tierRequired] : UNLOCK_PLACEHOLDER;
          return (
            <div
              key={u.id}
              className={`rounded-lg p-3 border transition-all
                ${u.unlocked ? 'bg-accent-soft border-accent/40' : 'bg-bg border-border opacity-60'}
              `}
            >
              <div className="flex items-center gap-2 mb-2">
                {u.unlocked ? (
                  <button
                    type="button"
                    onClick={() => setSelected(u)}
                    className="focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-full flex-shrink-0"
                    aria-label={`View ${u.title}`}
                  >
                    <img
                      src={iconSrc}
                      alt=""
                      className="w-8 h-8 rounded-full object-cover cursor-pointer transition-all hover:brightness-110 hover:scale-110"
                    />
                  </button>
                ) : (
                  <img
                    src={iconSrc}
                    alt=""
                    className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                  />
                )}
                <span className="text-[10px] uppercase tracking-wider text-text-muted">
                  Lv.{u.tierRequired}
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

      {selected && (
        <ChronicleLightbox
          src={TIER_PORTRAITS[selected.tierRequired]}
          title={selected.title}
          subtitle={`Unlock · Lv.${selected.tierRequired}`}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
}
