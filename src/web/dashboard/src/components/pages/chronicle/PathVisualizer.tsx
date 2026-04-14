import { useState } from 'react';
import type { ChronicleTier } from '../../../api/types';
import { TIER_PORTRAITS, TIER_LOCKED_IMAGE } from './images';
import { ChronicleLightbox } from './ChronicleLightbox';

type Props = {
  tiers: ChronicleTier[];
};

export function PathVisualizer({ tiers }: Props) {
  const [selected, setSelected] = useState<ChronicleTier | null>(null);

  return (
    <section className="bg-card border border-border rounded-lg p-5 mb-6">
      <h2 className="text-base font-semibold mb-4">The Path</h2>
      <div className="flex items-center justify-center gap-2 py-3 px-3 flex-wrap">
        {tiers.map((t, i) => {
          const isLast = i === tiers.length - 1;
          const src = t.isReached ? TIER_PORTRAITS[t.tier] : TIER_LOCKED_IMAGE;
          return (
            <div key={t.tier} className="flex items-center">
              <div className="flex flex-col items-center gap-1">
                <button
                  type="button"
                  onClick={() => setSelected(t)}
                  className="focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-xl"
                  aria-label={`View ${t.name}`}
                >
                  <img
                    src={src}
                    alt={t.name}
                    className={`w-20 h-20 rounded-xl object-contain cursor-pointer transition-all hover:brightness-110 hover:scale-105 bg-bg
                      ${t.isCurrent ? 'ring-4 ring-accent/50 scale-105' : ''}
                      ${t.isReached && !t.isCurrent ? 'ring-2 ring-accent/30' : ''}
                      ${!t.isReached ? 'opacity-50 grayscale' : ''}
                    `}
                  />
                </button>
                <p
                  className={`text-[10px] uppercase tracking-wide ${t.isCurrent ? 'text-accent font-semibold' : t.isReached ? 'text-text-dim' : 'text-text-muted'}`}
                >
                  {t.name}
                </p>
                <p className="text-[9px] text-text-muted">Lv.{t.tier}</p>
              </div>
              {!isLast && (
                <div
                  className={`w-6 h-0.5 mx-1 ${tiers[i + 1].isReached || t.isCurrent ? 'bg-accent/50' : 'bg-border'}`}
                />
              )}
            </div>
          );
        })}
      </div>

      {selected && (
        <ChronicleLightbox
          src={selected.isReached ? TIER_PORTRAITS[selected.tier] : TIER_LOCKED_IMAGE}
          title={selected.isReached ? selected.name : '???'}
          subtitle={`Lv.${selected.tier}`}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
}
