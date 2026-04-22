import { useState } from 'react';
import type { UserProfile } from '../../../api/types';
import { SaveIndicator } from '../../common/SettingsField';
import { MODEL_OPTIONS, MODEL_PHASES, getModel, getModels } from './settings-data';

type Props = {
  profile: UserProfile;
  saved: string | null;
  onSavePreference: (key: string, value: unknown) => Promise<void>;
  visible: boolean;
};

const SELECT_CLASS = 'w-full bg-bg border border-border rounded-lg px-3 py-2 text-text text-sm outline-none focus:border-accent transition-colors cursor-pointer';

// Core = the most-used phases users want quick access to. Heartbeat trio
// (summarize/extract/observe) included since they fire every 30min and are
// the easiest cost knob (audit P-11). Cleanup ('analyze') stays in extras —
// it's a small JSON-output call, low cost impact.
const CORE_KEYS = new Set(['summarize', 'extract', 'observe', 'suggest', 'consolidate', 'runner']);

export function SectionLLMModels({ profile, saved, onSavePreference, visible }: Props) {
  const [showExtra, setShowExtra] = useState(false);

  const currentModels = getModels(profile);
  const corePhases = MODEL_PHASES.filter((p) => CORE_KEYS.has(p.key));
  const extraPhases = MODEL_PHASES.filter((p) => !CORE_KEYS.has(p.key));

  const saveModel = async (phase: string, value: string) => {
    const newModels = { ...currentModels, [phase]: value };
    await onSavePreference('models', newModels);
  };

  const extraSummary = extraPhases
    .map((p) => `${p.label}: ${getModel(profile, p.key, p.default)}`)
    .join(', ');

  return (
    <section
      id="section-models"
      className={`bg-card border border-border rounded-lg p-5 mb-6 transition-opacity ${
        visible ? '' : 'opacity-20 pointer-events-none'
      }`}
    >
      <h2 className="text-base font-semibold mb-2">LLM Models</h2>
      <p className="text-sm text-text-dim mb-4">
        Choose which model Shadow uses for each phase.
        <SaveIndicator show={saved === 'models'} />
      </p>

      {/* Core phases — always visible */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {corePhases.map((phase) => (
          <div key={phase.key}>
            <label className="text-sm text-text-muted block mb-1">{phase.label}</label>
            <p className="text-xs text-text-dim mb-2">{phase.desc}</p>
            <select
              value={getModel(profile, phase.key, phase.default)}
              onChange={(e) => saveModel(phase.key, e.target.value)}
              className={SELECT_CLASS}
            >
              {MODEL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        ))}
      </div>

      {/* Extra phases (enrich + digests) — collapsible */}
      <div className="mt-4 pt-3 border-t border-border">
        {!showExtra ? (
          <button
            onClick={() => setShowExtra(true)}
            className="text-xs text-text-muted hover:text-accent transition-colors cursor-pointer"
          >
            Enrichment & Digests: {extraSummary} — show all
          </button>
        ) : (
          <div className="animate-fade-in">
            <p className="text-xs text-text-dim mb-3">Enrichment & Digest models</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {extraPhases.map((phase) => (
                <div key={phase.key}>
                  <label className="text-sm text-text-muted block mb-1">{phase.label}</label>
                  <p className="text-xs text-text-dim mb-2">{phase.desc}</p>
                  <select
                    value={getModel(profile, phase.key, phase.default)}
                    onChange={(e) => saveModel(phase.key, e.target.value)}
                    className={SELECT_CLASS}
                  >
                    {MODEL_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <button
              onClick={() => setShowExtra(false)}
              className="text-xs text-text-muted hover:text-accent transition-colors cursor-pointer mt-3"
            >
              hide
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
