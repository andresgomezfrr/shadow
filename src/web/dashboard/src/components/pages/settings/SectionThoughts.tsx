import { useState } from 'react';
import type { UserProfile } from '../../../api/types';
import { Toggle } from '../../common/Toggle';
import { SaveIndicator } from '../../common/SettingsField';
import {
  MODEL_OPTIONS,
  THOUGHT_FREQUENCY_OPTIONS,
  THOUGHT_DURATION_OPTIONS,
  getPref,
  getModel,
  getModels,
  getThoughtFrequencyValue,
} from './settings-data';

type Props = {
  profile: UserProfile;
  saved: string | null;
  onSavePreference: (key: string, value: unknown) => Promise<void>;
  visible: boolean;
};

const SELECT_CLASS = 'w-full bg-bg border border-border rounded-lg px-3 py-2 text-text text-sm outline-none focus:border-accent transition-colors cursor-pointer';

export function SectionThoughts({ profile, saved, onSavePreference, visible }: Props) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const enabled = getPref<boolean>(profile, 'thoughtsEnabled', true) !== false;

  return (
    <section
      id="section-thoughts"
      className={`bg-card border border-border rounded-lg p-5 mb-6 transition-opacity ${
        visible ? '' : 'opacity-20 pointer-events-none'
      }`}
    >
      <h2 className="text-base font-semibold mb-4">Thoughts</h2>
      <p className="text-sm text-text-dim mb-4">
        Shadow shares brief thoughts in the status line at random intervals.
      </p>

      {/* Toggle */}
      <div className="flex items-center justify-between">
        <div>
          <label className="text-sm font-medium">Enabled</label>
          <p className="text-xs text-text-dim">Show thoughts in the status line</p>
        </div>
        <div className="flex items-center gap-2">
          <SaveIndicator show={saved === 'thoughtsEnabled'} />
          <Toggle
            checked={enabled}
            onChange={(v) => onSavePreference('thoughtsEnabled', v)}
          />
        </div>
      </div>

      {/* Advanced toggle */}
      {enabled && !showAdvanced && (
        <button
          onClick={() => setShowAdvanced(true)}
          className="text-xs text-text-muted hover:text-accent transition-colors cursor-pointer mt-3"
        >
          Model: {getModel(profile, 'thought', 'haiku')}, Freq: ~{getThoughtFrequencyValue(profile)}min — configure
        </button>
      )}

      {/* Advanced settings */}
      {enabled && showAdvanced && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4 animate-fade-in">
          <div>
            <label className="text-sm text-text-muted block mb-1">
              Model
              <SaveIndicator show={saved === 'models'} />
            </label>
            <select
              value={getModel(profile, 'thought', 'haiku')}
              onChange={async (e) => {
                const currentModels = getModels(profile);
                await onSavePreference('models', { ...currentModels, thought: e.target.value });
              }}
              className={SELECT_CLASS}
            >
              {MODEL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm text-text-muted block mb-1">
              Frequency
              <SaveIndicator show={saved === 'thoughtIntervalMinMs'} />
            </label>
            <select
              value={getThoughtFrequencyValue(profile)}
              onChange={async (e) => {
                const mins = Number(e.target.value);
                await onSavePreference('thoughtIntervalMinMs', mins * 60 * 1000);
                await onSavePreference('thoughtIntervalMaxMs', mins * 2 * 60 * 1000);
              }}
              className={SELECT_CLASS}
            >
              {THOUGHT_FREQUENCY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm text-text-muted block mb-1">
              Duration
              <SaveIndicator show={saved === 'thoughtDurationMs'} />
            </label>
            <select
              value={String(getPref(profile, 'thoughtDurationMs', 60000))}
              onChange={(e) => onSavePreference('thoughtDurationMs', Number(e.target.value))}
              className={SELECT_CLASS}
            >
              {THOUGHT_DURATION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <button
            onClick={() => setShowAdvanced(false)}
            className="text-xs text-text-muted hover:text-accent transition-colors cursor-pointer col-span-full"
          >
            hide
          </button>
        </div>
      )}
    </section>
  );
}
