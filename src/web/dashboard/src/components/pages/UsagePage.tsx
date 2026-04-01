import { useState } from 'react';
import { useApi } from '../../hooks/useApi';
import { fetchUsage } from '../../api/client';
import { FilterTabs } from '../common/FilterTabs';
import { MetricCard } from '../common/MetricCard';

const PERIODS = [
  { label: 'Day', value: 'day' },
  { label: 'Week', value: 'week' },
  { label: 'Month', value: 'month' },
];

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

export function UsagePage() {
  const [period, setPeriod] = useState('week');
  const { data } = useApi(
    () => fetchUsage(period as 'day' | 'week' | 'month'),
    [period],
    30_000,
  );

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <h1 className="text-xl font-semibold">Usage</h1>
        <FilterTabs options={PERIODS} active={period} onChange={setPeriod} />
      </div>

      {!data ? (
        <div className="text-text-dim">Loading...</div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-4 mb-8">
            <MetricCard label="Input tokens" value={formatTokens(data.totalInputTokens)} accent />
            <MetricCard label="Output tokens" value={formatTokens(data.totalOutputTokens)} />
            <MetricCard label="Calls" value={data.totalCalls} />
          </div>

          {Object.keys(data.byModel).length > 0 && (
            <div>
              <h2 className="text-base font-semibold mb-3">By model</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {Object.entries(data.byModel).map(([model, stats]) => (
                  <div key={model} className="bg-card border border-border rounded-lg p-4 transition-colors hover:border-accent">
                    <div className="font-medium text-sm text-accent mb-2">{model}</div>
                    <div className="grid grid-cols-3 gap-2 text-xs text-text-dim">
                      <div>
                        <div className="text-text-muted">Input</div>
                        <div className="text-text font-medium">{formatTokens(stats.input)}</div>
                      </div>
                      <div>
                        <div className="text-text-muted">Output</div>
                        <div className="text-text font-medium">{formatTokens(stats.output)}</div>
                      </div>
                      <div>
                        <div className="text-text-muted">Calls</div>
                        <div className="text-text font-medium">{stats.calls}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
