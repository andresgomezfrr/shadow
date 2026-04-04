import { useState } from 'react';
import { useApi } from '../../../hooks/useApi';
import { fetchConfig } from '../../../api/client';

type Props = {
  visible: boolean;
};

const DISPLAY_KEYS = [
  { key: 'heartbeatIntervalMs', label: 'Heartbeat interval', format: 'ms' },
  { key: 'daemonPollIntervalMs', label: 'Daemon poll interval', format: 'ms' },
  { key: 'runnerTimeoutMs', label: 'Runner timeout', format: 'ms' },
  { key: 'maxConcurrentRuns', label: 'Max concurrent runs', format: 'number' },
  { key: 'maxWatchedRepos', label: 'Max watched repos', format: 'number' },
  { key: 'remoteSyncEnabled', label: 'Remote sync', format: 'bool' },
  { key: 'remoteSyncIntervalMs', label: 'Remote sync interval', format: 'ms' },
  { key: 'watcherEnabled', label: 'Watcher enabled', format: 'bool' },
  { key: 'activityTriggerThreshold', label: 'Activity trigger threshold', format: 'number' },
  { key: 'backend', label: 'Backend', format: 'string' },
  { key: 'env', label: 'Environment', format: 'string' },
  { key: 'logLevel', label: 'Log level', format: 'string' },
] as const;

function formatValue(value: unknown, format: string): string {
  if (value === undefined || value === null) return '—';
  if (format === 'ms') return `${Math.round(Number(value) / 1000)}s`;
  if (format === 'bool') return value ? 'Yes' : 'No';
  return String(value);
}

export function SectionSystemConfig({ visible }: Props) {
  const { data } = useApi(fetchConfig, [], 120_000);
  const [expanded, setExpanded] = useState(false);

  const config = data?.config;
  const count = config ? Object.keys(config).length : 0;

  return (
    <section
      id="section-config"
      className={`bg-card border border-border rounded-lg p-5 mb-6 transition-opacity ${
        visible ? '' : 'opacity-20 pointer-events-none'
      }`}
    >
      <h2 className="text-base font-semibold mb-2">System Config</h2>
      <p className="text-sm text-text-dim mb-3">
        Runtime configuration from environment variables. Read-only.
      </p>

      {!expanded ? (
        <button
          onClick={() => setExpanded(true)}
          className="text-xs text-text-muted hover:text-accent transition-colors cursor-pointer"
        >
          {count} settings via environment — show details
        </button>
      ) : (
        <div className="animate-fade-in">
          <div className="space-y-1.5">
            {DISPLAY_KEYS.map(({ key, label, format }) => (
              <div key={key} className="flex items-center justify-between text-sm">
                <span className="text-text-dim">{label}</span>
                <span className="text-text font-mono text-xs">
                  {config ? formatValue(config[key], format) : '—'}
                </span>
              </div>
            ))}
          </div>
          <button
            onClick={() => setExpanded(false)}
            className="text-xs text-text-muted hover:text-accent transition-colors cursor-pointer mt-3"
          >
            hide
          </button>
        </div>
      )}
    </section>
  );
}
