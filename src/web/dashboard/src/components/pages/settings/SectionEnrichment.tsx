import { useState } from 'react';
import type { UserProfile } from '../../../api/types';
import { Toggle } from '../../common/Toggle';
import { SaveIndicator } from '../../common/SettingsField';
import { ENRICHMENT_INTERVAL_OPTIONS, getPref } from './settings-data';

type Props = {
  profile: UserProfile;
  saved: string | null;
  onSavePreference: (key: string, value: unknown) => Promise<void>;
  visible: boolean;
};

const SELECT_CLASS = 'bg-bg border border-border rounded-lg px-3 py-2 text-text text-sm outline-none focus:border-accent transition-colors cursor-pointer';

export function SectionEnrichment({ profile, saved, onSavePreference, visible }: Props) {
  const [showInterval, setShowInterval] = useState(false);
  const enabled = getPref(profile, 'enrichmentEnabled', false);
  const intervalMin = getPref(profile, 'enrichmentIntervalMin', 120);

  return (
    <section
      id="section-enrichment"
      className={`bg-card border border-border rounded-lg p-5 mb-6 transition-opacity ${
        visible ? '' : 'opacity-20 pointer-events-none'
      }`}
    >
      <h2 className="text-base font-semibold mb-4">MCP Enrichment</h2>
      <p className="text-sm text-text-dim mb-4">
        Shadow periodically queries your MCP tools (calendar, monitoring, CI) to gather external context.
      </p>

      <div className="flex items-center justify-between">
        <div>
          <label className="text-sm font-medium">Enabled</label>
          <p className="text-xs text-text-dim">Query external MCP tools periodically</p>
        </div>
        <div className="flex items-center gap-2">
          <SaveIndicator show={saved === 'enrichmentEnabled'} />
          <Toggle
            checked={!!enabled}
            onChange={(v) => onSavePreference('enrichmentEnabled', v)}
          />
        </div>
      </div>

      {/* Collapsed summary */}
      {enabled && !showInterval && (
        <button
          onClick={() => setShowInterval(true)}
          className="text-xs text-text-muted hover:text-accent transition-colors cursor-pointer mt-3"
        >
          Interval: every {intervalMin}min — configure
        </button>
      )}

      {/* Interval selector */}
      {enabled && showInterval && (
        <div className="mt-4 animate-fade-in">
          <label className="text-sm font-medium block mb-1">
            Interval
            <SaveIndicator show={saved === 'enrichmentIntervalMin'} />
          </label>
          <select
            value={String(intervalMin)}
            onChange={(e) => onSavePreference('enrichmentIntervalMin', Number(e.target.value))}
            className={SELECT_CLASS}
          >
            {ENRICHMENT_INTERVAL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <button
            onClick={() => setShowInterval(false)}
            className="text-xs text-text-muted hover:text-accent transition-colors cursor-pointer mt-2 block"
          >
            hide
          </button>
        </div>
      )}
    </section>
  );
}
