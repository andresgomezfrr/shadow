import type { UserProfile } from '../../../api/types';
import { SettingsField } from '../../common/SettingsField';
import { MOOD_OPTIONS, ENERGY_OPTIONS } from './settings-data';

type Props = {
  profile: UserProfile;
  saved: string | null;
  onSave: (field: string, value: unknown) => Promise<void>;
  visible: boolean;
};

const SELECT_CLASS = 'bg-bg border border-border rounded-lg px-3 py-2 text-text text-sm outline-none focus:border-accent transition-colors cursor-pointer';

export function SectionStatus({ profile, saved, onSave, visible }: Props) {
  return (
    <section
      id="section-status"
      className={`bg-card border border-border rounded-lg p-5 mb-6 transition-opacity ${
        visible ? '' : 'opacity-20 pointer-events-none'
      }`}
    >
      <h2 className="text-base font-semibold mb-4">Status</h2>
      <div className="space-y-4">
        <SettingsField label="Mood hint" fieldKey="moodHint" saved={saved}>
          <select
            defaultValue={profile.moodHint ?? 'neutral'}
            onChange={(e) => onSave('moodHint', e.target.value)}
            className={SELECT_CLASS}
          >
            {MOOD_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </SettingsField>

        <SettingsField label="Energy level" fieldKey="energyLevel" saved={saved}>
          <select
            defaultValue={profile.energyLevel ?? ''}
            onChange={(e) => onSave('energyLevel', e.target.value || null)}
            className={SELECT_CLASS}
          >
            {ENERGY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </SettingsField>
      </div>
    </section>
  );
}
