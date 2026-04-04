import { useState, useEffect } from 'react';
import type { UserProfile } from '../../../api/types';
import { SaveIndicator } from '../../common/SettingsField';
import { PERSONALITY_LABELS } from './settings-data';

type Props = {
  profile: UserProfile;
  saved: string | null;
  onSave: (field: string, value: unknown) => Promise<void>;
  onDebouncedSave: (field: string, value: unknown) => void;
  visible: boolean;
};

const SELECT_CLASS = 'bg-bg border border-border rounded-lg px-3 py-2 text-text text-sm outline-none focus:border-accent transition-colors cursor-pointer';

function SliderField({
  label,
  description,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  description?: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-sm font-medium">{label}</label>
        <span className="text-sm text-accent font-semibold">{value}</span>
      </div>
      {description && <p className="text-xs text-text-muted mb-2">{description}</p>}
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--color-accent)] h-1.5 bg-border rounded-full appearance-none cursor-pointer"
      />
      <div className="flex justify-between text-[10px] text-text-muted mt-0.5">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}

export function SectionBehavior({ profile, saved, onSave, onDebouncedSave, visible }: Props) {
  const [localProactivity, setLocalProactivity] = useState(profile.proactivityLevel);
  const [localPersonality, setLocalPersonality] = useState(profile.personalityLevel);

  useEffect(() => {
    setLocalProactivity(profile.proactivityLevel);
    setLocalPersonality(profile.personalityLevel);
  }, [profile.proactivityLevel, profile.personalityLevel]);

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
          <SliderField
            label="Proactivity"
            description="How proactive Shadow is when sharing observations and suggestions"
            value={localProactivity}
            min={1}
            max={10}
            onChange={(v) => {
              setLocalProactivity(v);
              onDebouncedSave('proactivityLevel', v);
            }}
          />
          <SaveIndicator show={saved === 'proactivityLevel'} />
        </div>
        <div>
          <SliderField
            label="Personality"
            description={PERSONALITY_LABELS[localPersonality] ?? ''}
            value={localPersonality}
            min={1}
            max={5}
            onChange={(v) => {
              setLocalPersonality(v);
              onDebouncedSave('personalityLevel', v);
            }}
          />
          <SaveIndicator show={saved === 'personalityLevel'} />
        </div>
        <div>
          <label className="text-sm font-medium block mb-1">
            Verbosity
            <SaveIndicator show={saved === 'verbosity'} />
          </label>
          <select
            defaultValue={profile.verbosity}
            onChange={(e) => onSave('verbosity', e.target.value)}
            className={SELECT_CLASS}
          >
            <option value="concise">Concise</option>
            <option value="normal">Normal</option>
            <option value="verbose">Verbose</option>
          </select>
        </div>
      </div>
    </section>
  );
}
