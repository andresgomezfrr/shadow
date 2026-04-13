import type { ChronicleTier } from '../../../api/types';
import { BOND_TIER_BADGES } from '../../../api/types';

type Props = {
  tiers: ChronicleTier[];
};

export function PathVisualizer({ tiers }: Props) {
  return (
    <section className="bg-card border border-border rounded-lg p-5 mb-6">
      <h2 className="text-base font-semibold mb-4">The Path</h2>
      <div className="flex items-center justify-between gap-1 overflow-x-auto">
        {tiers.map((t, i) => {
          const isLast = i === tiers.length - 1;
          const badge = t.isReached ? BOND_TIER_BADGES[t.tier] : '◌';
          return (
            <div key={t.tier} className="flex items-center flex-1 min-w-0">
              <div className="flex flex-col items-center gap-1 flex-shrink-0">
                <div
                  className={`w-11 h-11 rounded-full flex items-center justify-center text-xl transition-all
                    ${t.isCurrent ? 'bg-accent text-bg ring-4 ring-accent/30 scale-110' : ''}
                    ${t.isReached && !t.isCurrent ? 'bg-accent-soft text-accent' : ''}
                    ${!t.isReached ? 'bg-card border border-border text-text-muted' : ''}
                  `}
                >
                  {badge}
                </div>
                <p
                  className={`text-[10px] uppercase tracking-wide ${t.isCurrent ? 'text-accent font-semibold' : t.isReached ? 'text-text-dim' : 'text-text-muted'}`}
                >
                  {t.name}
                </p>
                <p className="text-[9px] text-text-muted">Lv.{t.tier}</p>
              </div>
              {!isLast && (
                <div
                  className={`flex-1 h-0.5 mx-1 ${tiers[i + 1].isReached || t.isCurrent ? 'bg-accent/50' : 'bg-border'}`}
                />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
