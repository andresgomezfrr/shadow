import { useApi } from '../../hooks/useApi';
import { fetchStatus } from '../../api/client';
import { TRUST_NAMES, MOOD_EMOJIS } from '../../api/types';
import { MetricCard } from '../common/MetricCard';
import { ProgressBar } from '../common/ProgressBar';

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

export function DashboardPage() {
  const { data } = useApi(fetchStatus, [], 30_000);

  if (!data) return <div className="text-text-dim">Loading...</div>;

  const { profile, counts, usage, lastHeartbeat } = data;
  const trustName = TRUST_NAMES[profile.trustLevel] ?? 'Unknown';
  const mood = profile.moodHint ?? 'neutral';
  const moodEmoji = MOOD_EMOJIS[mood] ?? '😐';

  return (
    <div>
      <h1 className="text-xl font-semibold mb-6">Dashboard</h1>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        <MetricCard label="Trust Level" value={`Lv.${profile.trustLevel} ${trustName}`} accent>
          <ProgressBar value={profile.trustLevel} max={5} />
        </MetricCard>

        <MetricCard label="Trust Score" value={profile.trustScore.toFixed(1)} />

        <MetricCard label="Personality" value={`Level ${profile.personalityLevel}`}>
          <ProgressBar value={profile.personalityLevel} max={5} />
        </MetricCard>

        <MetricCard label="Proactivity" value={`${profile.proactivityLevel}/10`}>
          <ProgressBar value={profile.proactivityLevel} max={10} />
        </MetricCard>

        <MetricCard label="Mood" value={`${moodEmoji} ${mood}`} />

        <MetricCard
          label="Focus Mode"
          value={profile.focusMode === 'focus' ? '🎯 Active' : 'Inactive'}
        />

        <MetricCard label="Repos" value={counts.repos} />
        <MetricCard label="Memories" value={counts.memories} />
        <MetricCard label="Pending suggestions" value={counts.pendingSuggestions} accent />
        <MetricCard label="Contacts" value={counts.contacts} />
        <MetricCard label="Systems" value={counts.systems} />

        <MetricCard
          label="Tokens today"
          value={formatTokens(usage.totalInputTokens + usage.totalOutputTokens)}
        >
          <div className="text-xs text-text-muted mt-1">
            {formatTokens(usage.totalInputTokens)} in / {formatTokens(usage.totalOutputTokens)} out
          </div>
        </MetricCard>

        <MetricCard label="LLM calls" value={usage.totalCalls} />

        {lastHeartbeat && (
          <MetricCard label="Last heartbeat" value={lastHeartbeat.phase}>
            <div className="text-xs text-text-muted mt-1">
              {lastHeartbeat.observationsCreated} obs &middot; {lastHeartbeat.suggestionsCreated} sug
            </div>
          </MetricCard>
        )}
      </div>

      {Object.keys(usage.byModel).length > 0 && (
        <section className="mt-8">
          <h2 className="text-base font-semibold mb-3">Usage by model</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {Object.entries(usage.byModel).map(([model, stats]) => (
              <div key={model} className="bg-card border border-border rounded-lg px-4 py-3">
                <div className="font-medium text-sm text-accent">{model}</div>
                <div className="text-xs text-text-dim mt-1">
                  {formatTokens(stats.input)} in / {formatTokens(stats.output)} out &middot; {stats.calls} calls
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
