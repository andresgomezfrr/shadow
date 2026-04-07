import { formatTokens } from '../../utils/format';
import { useApi } from '../../hooks/useApi';
import { fetchStatus } from '../../api/client';
import { TRUST_NAMES, MOOD_EMOJIS } from '../../api/types';
import { MetricCard } from '../common/MetricCard';
import { ProgressBar } from '../common/ProgressBar';
import { tierLabel } from './settings/SectionBehavior';


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
        <MetricCard label="Trust Level" value={`Lv.${profile.trustLevel} ${trustName}`} accent href="/profile">
          <ProgressBar value={profile.trustLevel} max={5} />
        </MetricCard>

        <MetricCard label="Trust Score" value={profile.trustScore.toFixed(1)} href="/profile" />

        <MetricCard label="Personality" value={`Level ${profile.personalityLevel}`} href="/profile">
          <ProgressBar value={profile.personalityLevel} max={5} />
        </MetricCard>

        <MetricCard label="Proactivity" value={tierLabel(profile.proactivityLevel)} href="/profile" />

        <MetricCard label="Mood" value={`${moodEmoji} ${mood}`} />

        <MetricCard
          label="Focus Mode"
          value={profile.focusMode === 'focus' ? '🎯 Active' : 'Inactive'}
          href="/profile"
        />

        <MetricCard label="Repos" value={counts.repos} href="/repos" />
        <MetricCard label="Memories" value={counts.memories} href="/memories" />
        <MetricCard label="Pending suggestions" value={counts.pendingSuggestions} accent href="/suggestions?status=pending" />
        <MetricCard label="Contacts" value={counts.contacts} href="/team" />
        <MetricCard label="Systems" value={counts.systems} href="/systems" />

        <MetricCard
          label="Tokens today"
          value={formatTokens(usage.totalInputTokens + usage.totalOutputTokens)}
          href="/usage"
        >
          <div className="text-xs text-text-muted mt-1">
            {formatTokens(usage.totalInputTokens)} in / {formatTokens(usage.totalOutputTokens)} out
          </div>
        </MetricCard>

        <MetricCard label="LLM calls" value={usage.totalCalls} href="/usage" />

        {lastHeartbeat && (() => {
          const r = (lastHeartbeat.result ?? {}) as Record<string, unknown>;
          return (
            <MetricCard label="Last heartbeat" value={lastHeartbeat.status} href="/activity">
              <div className="text-xs text-text-muted mt-1">
                {r.observationsCreated ?? 0} obs &middot; {r.suggestionsCreated ?? 0} sug
              </div>
            </MetricCard>
          );
        })()}
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
