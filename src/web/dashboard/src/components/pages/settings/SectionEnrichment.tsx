import { useState, useEffect } from 'react';
import type { UserProfile } from '../../../api/types';
import { fetchEnrichmentServers, toggleEnrichmentServer, triggerJob } from '../../../api/client';
import { Toggle } from '../../common/Toggle';
import { SaveIndicator } from '../../common/SettingsField';
import { ENRICHMENT_INTERVAL_OPTIONS, getPref } from './settings-data';

type Props = {
  profile: UserProfile;
  saved: string | null;
  onSavePreference: (key: string, value: unknown) => Promise<void>;
  visible: boolean;
};

type ServerInfo = { name: string; enabled: boolean; description: string | null; toolCount: number | null; defaultTtl: string | null };

const TTL_LABELS: Record<string, { label: string; color: string }> = {
  volatile: { label: '2h', color: 'text-red-400 bg-red-400/15' },
  short: { label: '12h', color: 'text-orange-400 bg-orange-400/15' },
  medium: { label: '48h', color: 'text-amber-400 bg-amber-400/15' },
  long: { label: '7d', color: 'text-blue-400 bg-blue-400/15' },
  stable: { label: '30d', color: 'text-green-400 bg-green-400/15' },
};

const SELECT_CLASS = 'bg-bg border border-border rounded-lg px-3 py-2 text-text text-sm outline-none focus:border-accent transition-colors cursor-pointer';

export function SectionEnrichment({ profile, saved, onSavePreference, visible }: Props) {
  const [showInterval, setShowInterval] = useState(false);
  const [servers, setServers] = useState<ServerInfo[]>([]);
  const [togglingServer, setTogglingServer] = useState<string | null>(null);
  const [discoverTriggered, setDiscoverTriggered] = useState(false);
  const enabled = getPref(profile, 'enrichmentEnabled', false);
  const intervalMin = getPref(profile, 'enrichmentIntervalMin', 120);

  useEffect(() => {
    fetchEnrichmentServers().then(data => {
      if (data?.servers) setServers(data.servers);
    });
  }, []);

  const handleToggleServer = async (name: string, newEnabled: boolean) => {
    setTogglingServer(name);
    const res = await toggleEnrichmentServer(name, newEnabled);
    if (res?.ok) {
      setServers(prev => prev.map(s => s.name === name ? { ...s, enabled: newEnabled } : s));
    }
    setTogglingServer(null);
  };

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

      {/* MCP Servers */}
      {enabled && servers.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium">MCP Servers</label>
            <button
              onClick={async () => {
                setDiscoverTriggered(true);
                await triggerJob('mcp-discover');
                setTimeout(() => {
                  setDiscoverTriggered(false);
                  fetchEnrichmentServers().then(data => { if (data?.servers) setServers(data.servers); });
                }, 20_000);
              }}
              disabled={discoverTriggered}
              className="text-[10px] px-2 py-0.5 rounded bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/25 border-none cursor-pointer transition-colors disabled:opacity-50"
            >
              {discoverTriggered ? 'Discovering...' : 'Refresh descriptions'}
            </button>
          </div>
          <div className="space-y-2">
            {servers.map(s => (
              <div
                key={s.name}
                className={`flex items-center justify-between px-4 py-3 border rounded-lg transition-colors ${
                  s.enabled
                    ? 'bg-bg border-border'
                    : 'bg-bg/50 border-border/50 opacity-60'
                }`}
              >
                <div className="flex-1 min-w-0 mr-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-text">{s.name}</span>
                    {s.toolCount != null && (
                      <span className="text-[10px] text-text-muted bg-border/50 px-1.5 py-0.5 rounded-full">
                        {s.toolCount} tools
                      </span>
                    )}
                    {s.defaultTtl && TTL_LABELS[s.defaultTtl] && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${TTL_LABELS[s.defaultTtl].color}`}>
                        TTL {TTL_LABELS[s.defaultTtl].label}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-text-dim mt-0.5 line-clamp-2">
                    {s.description ?? 'No description yet'}
                  </p>
                  {s.enrichmentHint && (
                    <p className="text-[10px] text-text-muted mt-0.5 italic">→ {s.enrichmentHint}</p>
                  )}
                </div>
                <Toggle
                  checked={s.enabled}
                  onChange={() => handleToggleServer(s.name, !s.enabled)}
                  disabled={togglingServer === s.name}
                />
              </div>
            ))}
          </div>
          <p className="text-xs text-text-muted mt-2">
            {servers.filter(s => s.enabled).length} of {servers.length} servers enabled
          </p>
        </div>
      )}

      {enabled && servers.length === 0 && (
        <p className="text-xs text-text-muted mt-3">No external MCP servers discovered.</p>
      )}

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
