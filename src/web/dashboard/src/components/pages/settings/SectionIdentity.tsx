import type { UserProfile } from '../../../api/types';
import { SettingsField } from '../../common/SettingsField';

type Props = {
  profile: UserProfile;
  saved: string | null;
  onSave: (field: string, value: unknown) => Promise<void>;
  visible: boolean;
};

const INPUT_CLASS = 'bg-bg border border-border rounded-lg px-3 py-2 text-text text-sm w-full max-w-xs outline-none focus:border-accent transition-colors';
const SELECT_CLASS = 'bg-bg border border-border rounded-lg px-3 py-2 text-text text-sm outline-none focus:border-accent transition-colors cursor-pointer';

export function SectionIdentity({ profile, saved, onSave, visible }: Props) {
  return (
    <section
      id="section-identity"
      className={`bg-card border border-border rounded-lg p-5 mb-6 transition-opacity ${
        visible ? '' : 'opacity-20 pointer-events-none'
      }`}
    >
      <h2 className="text-base font-semibold mb-4">Identity</h2>
      <div className="space-y-4">
        <SettingsField label="Name" fieldKey="displayName" saved={saved}>
          <input
            type="text"
            defaultValue={profile.displayName ?? ''}
            onBlur={(e) => onSave('displayName', e.target.value)}
            className={INPUT_CLASS}
          />
        </SettingsField>

        <SettingsField label="Locale" fieldKey="locale" saved={saved}>
          <select
            defaultValue={profile.locale}
            onChange={(e) => onSave('locale', e.target.value)}
            className={SELECT_CLASS}
          >
            <option value="es">Spanish</option>
            <option value="en">English</option>
          </select>
        </SettingsField>

        <SettingsField label="Timezone" fieldKey="timezone" saved={saved}>
          <input
            type="text"
            defaultValue={profile.timezone ?? ''}
            placeholder="Europe/Madrid"
            onBlur={(e) => onSave('timezone', e.target.value)}
            className={INPUT_CLASS}
          />
        </SettingsField>
      </div>
    </section>
  );
}
