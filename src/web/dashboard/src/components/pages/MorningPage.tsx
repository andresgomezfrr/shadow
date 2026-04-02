import { useState, useCallback } from 'react';
import { useApi } from '../../hooks/useApi';
import { fetchDailySummary, acceptSuggestion, dismissSuggestion } from '../../api/client';
import { TRUST_NAMES, MOOD_EMOJIS, SEVERITY_COLORS } from '../../api/types';
import type { Suggestion } from '../../api/types';
import { Badge } from '../common/Badge';
import { Markdown } from '../common/Markdown';
import { MetricCard } from '../common/MetricCard';
import { EmptyState } from '../common/EmptyState';

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 19) return 'Good afternoon';
  return 'Good evening';
}

function formatDate(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function SuggestionReviewCard({
  suggestion,
  onAccept,
  onDismiss,
}: {
  suggestion: Suggestion;
  onAccept: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const [leaving, setLeaving] = useState(false);

  const handleAction = (action: 'accept' | 'dismiss') => {
    setLeaving(true);
    setTimeout(() => {
      if (action === 'accept') onAccept(suggestion.id);
      else onDismiss(suggestion.id);
    }, 350);
  };

  return (
    <div className={`bg-card border border-border rounded-lg p-5 transition-all ${leaving ? 'animate-slide-out' : ''}`}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1 min-w-0">
          <div className="font-medium text-[15px]">{suggestion.title}</div>
          <div className="flex items-center gap-2 text-xs text-text-muted mt-0.5 flex-wrap">
            <span>{suggestion.kind}</span>
            <span>·</span>
            <span>{timeAgo(suggestion.createdAt)}</span>
            {suggestion.sourceObservationId && (
              <><span>·</span><a href={`/observations?highlight=${suggestion.sourceObservationId}`} className="text-accent hover:underline">from observation</a></>
            )}
          </div>
        </div>
        <div className="flex gap-1.5 shrink-0">
          <Badge title="Impact: how much value (1=low, 5=high)" className="text-green bg-green/15">↑{suggestion.impactScore}</Badge>
          <Badge title="Confidence (0-100%)" className="text-blue bg-blue/15">{Math.round(suggestion.confidenceScore)}%</Badge>
          {suggestion.riskScore > 1 && (
            <Badge title="Risk: breaking potential (1=safe, 5=dangerous)" className="text-orange bg-orange/15">⚠ {suggestion.riskScore}</Badge>
          )}
        </div>
      </div>
      <div className="mb-4"><Markdown>{suggestion.summaryMd}</Markdown></div>
      <div className="flex gap-2">
        <button
          onClick={() => handleAction('accept')}
          className="px-4 py-1.5 rounded-lg text-xs font-medium bg-green/15 text-green border border-green/30 cursor-pointer transition-all hover:bg-green/25"
        >
          Accept
        </button>
        <button
          onClick={() => handleAction('dismiss')}
          className="px-4 py-1.5 rounded-lg text-xs font-medium bg-border text-text-dim border border-border cursor-pointer transition-all hover:bg-red/15 hover:text-red hover:border-red/30"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

export function MorningPage() {
  const { data, refresh } = useApi(fetchDailySummary, [], 60_000);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const handleAccept = useCallback(async (id: string) => {
    await acceptSuggestion(id);
    setDismissed((s) => new Set(s).add(id));
    refresh();
  }, [refresh]);

  const handleDismiss = useCallback(async (id: string) => {
    await dismissSuggestion(id);
    setDismissed((s) => new Set(s).add(id));
    refresh();
  }, [refresh]);

  if (!data) {
    return <div className="text-text-dim">Loading...</div>;
  }

  const profile = data.profile;
  const mood = profile.moodHint ?? 'neutral';
  const moodEmoji = MOOD_EMOJIS[mood] ?? '😐';
  const trustName = TRUST_NAMES[profile.trustLevel] ?? 'Unknown';
  const pendingSuggestions = data.pendingSuggestions.filter((s) => !dismissed.has(s.id));

  return (
    <div className="max-w-4xl mx-auto">
      {/* Greeting */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold">
          {getGreeting()}, {profile.displayName ?? 'dev'} {moodEmoji}
        </h1>
        <p className="text-text-dim mt-1 capitalize">{formatDate()}</p>
        <p className="text-text-muted text-xs mt-0.5">
          Trust: Lv.{profile.trustLevel} {trustName} &middot; Score: {profile.trustScore.toFixed(1)}
        </p>
      </div>

      {/* Activity summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        <MetricCard label="Observations today" value={data.activity.observationsToday} />
        <MetricCard label="New memories" value={data.activity.memoriesCreatedToday} />
        <MetricCard label="Suggestions" value={data.activity.pendingSuggestions} accent />
        <MetricCard label="Tokens used" value={formatTokens(data.tokens.input + data.tokens.output)} />
      </div>

      {/* Suggestions queue */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          💡 Pending suggestions
          {pendingSuggestions.length > 0 && (
            <Badge>{pendingSuggestions.length}</Badge>
          )}
        </h2>
        {pendingSuggestions.length === 0 ? (
          <EmptyState
            icon="✅"
            title="All caught up"
            description="No pending suggestions to review"
          />
        ) : (
          <div className="flex flex-col gap-3">
            {pendingSuggestions.map((s) => (
              <SuggestionReviewCard
                key={s.id}
                suggestion={s}
                onAccept={handleAccept}
                onDismiss={handleDismiss}
              />
            ))}
          </div>
        )}
      </section>

      {/* Today's observations */}
      {data.topObservations.length > 0 && (
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-4">👀 Today's observations</h2>
          <div className="flex flex-col gap-2">
            {data.topObservations.map((obs) => {
              const sevClass = SEVERITY_COLORS[obs.severity] ?? SEVERITY_COLORS.info;
              return (
                <div key={obs.id} className="bg-card border border-border rounded-lg px-4 py-3 flex items-center gap-3">
                  <Badge className={sevClass}>{obs.severity}</Badge>
                  <Badge className="text-text-dim bg-border">{obs.kind}</Badge>
                  {obs.votes > 1 && <Badge className="text-orange bg-orange/15">{obs.votes}x</Badge>}
                  <span className="text-[13px] flex-1 truncate">{obs.title}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Repos */}
      {data.repos.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-4">📁 Active repos</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {data.repos.map((r) => (
              <div key={r.id} className="bg-card border border-border rounded-lg px-4 py-3">
                <div className="font-medium text-sm">{r.name}</div>
                <div className="text-xs text-text-muted truncate">{r.path}</div>
                {r.lastObservedAt && (
                  <div className="text-xs text-text-dim mt-1">{timeAgo(r.lastObservedAt)}</div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
