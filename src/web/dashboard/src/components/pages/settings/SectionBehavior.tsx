import { useState, useEffect } from 'react';
import type { UserProfile } from '../../../api/types';
import { SaveIndicator } from '../../common/SettingsField';

type Props = {
  profile: UserProfile;
  saved: string | null;
  onSave: (field: string, value: unknown) => Promise<void>;
  onDebouncedSave: (field: string, value: unknown) => void;
  visible: boolean;
};

const SELECT_CLASS = 'bg-bg border border-border rounded-lg px-3 py-2 text-text text-sm outline-none focus:border-accent transition-colors cursor-pointer';

const PROACTIVITY_TIERS = [
  { value: 1, label: 'Silent', description: 'Only critical alerts' },
  { value: 4, label: 'Low', description: 'Important stuff only' },
  { value: 6, label: 'Normal', description: 'Balanced' },
  { value: 9, label: 'High', description: 'Show me everything' },
] as const;

function proactivityToTier(level: number): number {
  if (level <= 3) return 1;
  if (level <= 5) return 4;
  if (level <= 7) return 6;
  return 9;
}

export function tierLabel(level: number): string {
  if (level <= 3) return 'Silent';
  if (level <= 5) return 'Low';
  if (level <= 7) return 'Normal';
  return 'High';
}

export function SectionBehavior({ profile, saved, onSave, visible }: Props) {
  const [localProactivity, setLocalProactivity] = useState(profile.proactivityLevel);

  useEffect(() => {
    setLocalProactivity(profile.proactivityLevel);
  }, [profile.proactivityLevel]);

  return (
    <section
      id="section-behavior"
      className={`bg-card border border-border rounded-lg p-5 mb-6 transition-opacity ${
        visible ? '' : 'opacity-20 pointer-events-none'
      }`}
    >
      <h2 className="text-base font-semibold mb-4">Behavior</h2>
      <div className="space-y-6">
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm font-medium">Proactivity</label>
            <SaveIndicator show={saved === 'proactivityLevel'} />
          </div>
          <p className="text-xs text-text-muted mb-2">How much Shadow shares with you proactively</p>
          <div className="flex gap-1.5">
            {PROACTIVITY_TIERS.map((tier) => (
              <button
                key={tier.value}
                onClick={() => { setLocalProactivity(tier.value); onSave('proactivityLevel', tier.value); }}
                className={`flex-1 px-2 py-2 rounded-lg text-xs border-none cursor-pointer transition-colors text-center ${
                  proactivityToTier(localProactivity) === tier.value
                    ? 'bg-accent-soft text-accent'
                    : 'bg-border/50 text-text-muted hover:text-text'
                }`}
              >
                <div className="font-medium">{tier.label}</div>
                <div className="text-[10px] mt-0.5 opacity-70">{tier.description}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
