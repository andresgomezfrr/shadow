import { timeAgo, formatTokens } from '../../utils/format';
import { useState, useCallback } from 'react';
import { useApi } from '../../hooks/useApi';
import { fetchDailySummary, acceptSuggestion, dismissSuggestion, snoozeSuggestion } from '../../api/client';
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

const SNOOZE_OPTIONS = [
  { label: '3h', hours: 3 },
  { label: '6h', hours: 6 },
  { label: '1d', hours: 24 },
  { label: '3d', hours: 72 },
  { label: '7d', hours: 168 },
];

function SuggestionReviewCard({
  suggestion,
  onAccept,
  onDismiss,
  onSnooze,
}: {
  suggestion: Suggestion;
  onAccept: (id: string) => void;
  onDismiss: (id: string) => void;
  onSnooze: (id: string, hours: number) => void;
}) {
  const [leaving, setLeaving] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);

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
        <div className="relative">
          <button
            onClick={() => setSnoozeOpen(!snoozeOpen)}
            className="px-4 py-1.5 rounded-lg text-xs font-medium bg-blue/15 text-blue border border-blue/30 cursor-pointer transition-all hover:bg-blue/25"
          >
            Snooze
          </button>
          {snoozeOpen && (
            <div className="absolute top-full left-0 mt-1 bg-card border border-border rounded-lg shadow-lg z-10 overflow-hidden">
              {SNOOZE_OPTIONS.map((opt) => (
                <button
                  key={opt.hours}
                  onClick={() => { setLeaving(true); setTimeout(() => onSnooze(suggestion.id, opt.hours), 350); setSnoozeOpen(false); }}
                  className="block w-full px-4 py-1.5 text-xs text-left hover:bg-accent-soft cursor-pointer"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
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
    const note = window.prompt('Reason for dismissing (optional):');
    await dismissSuggestion(id, note || undefined);
    setDismissed((s) => new Set(s).add(id));
    refresh();
  }, [refresh]);

  const handleSnooze = useCallback(async (id: string, hours: number) => {
    await snoozeSuggestion(id, hours);
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
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-8">
        <MetricCard label="Observations" value={data.activity.observationsToday} />
        <MetricCard label="Memories" value={data.activity.memoriesCreatedToday} />
        <MetricCard label="Suggestions" value={data.activity.pendingSuggestions} accent />
        <MetricCard label="Runs to review" value={data.activity.runsToReview} accent={data.activity.runsToReview > 0} />
        <MetricCard label="Tokens" value={formatTokens(data.tokens.input + data.tokens.output)} />
      </div>

      {/* Recent jobs */}
      {data.recentJobs && data.recentJobs.length > 0 && (
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-3">⚙️ Recent jobs</h2>
          <div className="flex flex-col gap-1.5">
            {data.recentJobs.map((job) => {
              const phases = (job.phases ?? []).filter((p: string) => !['wake', 'idle', 'notify'].includes(p));
              const typeColors: Record<string, string> = { heartbeat: 'text-purple bg-purple/15', suggest: 'text-accent bg-accent-soft', consolidate: 'text-orange bg-orange/15' };
              const duration = job.durationMs != null ? `${(job.durationMs / 1000).toFixed(1)}s` : '';
              return (
                <div key={job.id} className="bg-card border border-border rounded-lg px-4 py-2.5 flex items-center gap-2 flex-wrap text-xs">
                  <Badge className={typeColors[job.type] ?? 'text-text-dim bg-border'}>{job.type}</Badge>
                  {phases.length > 0 ? phases.map((p: string, i: number) => (
                    <span key={i} className="text-text-muted">{p}</span>
                  )) : <span className="text-text-muted">skip</span>}
                  {job.llmCalls > 0 && <span className="text-text-muted">· {job.llmCalls} LLM</span>}
                  {duration && <span className="text-text-muted">· {duration}</span>}
                  <span className="text-text-muted ml-auto">{timeAgo(job.startedAt)}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* What Shadow learned */}
      {data.recentMemories && data.recentMemories.length > 0 && (
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-3">🧠 What Shadow learned today</h2>
          <div className="flex flex-col gap-1.5">
            {data.recentMemories.map((m) => (
              <div key={m.id} className="bg-card border border-border rounded-lg px-4 py-2.5 flex items-center gap-2">
                <Badge className="text-purple bg-purple/15">{m.layer}</Badge>
                <Badge className="text-text-dim bg-border">{m.kind}</Badge>
                <span className="text-[13px] flex-1 truncate">{m.title}</span>
                <span className="text-xs text-text-muted shrink-0">{timeAgo(m.createdAt)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Runs to review */}
      {data.runsToReview && data.runsToReview.length > 0 && (
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-3">▶ Runs to review</h2>
          <div className="flex flex-col gap-1.5">
            {data.runsToReview.map((r) => (
              <a key={r.id} href={`/runs?highlight=${r.id}`} className="bg-card border border-border rounded-lg px-4 py-2.5 flex items-center gap-2 hover:border-accent transition-colors no-underline">
                <Badge className="text-green bg-green/15">completed</Badge>
                <Badge className="text-text-dim bg-border">{r.kind}</Badge>
                <span className="text-[13px] text-text flex-1 truncate">{r.prompt.slice(0, 80)}</span>
                <span className="text-xs text-text-muted shrink-0">{timeAgo(r.createdAt)}</span>
              </a>
            ))}
          </div>
        </section>
      )}

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
                onSnooze={handleSnooze}
              />
            ))}
          </div>
        )}
      </section>

      {/* Today's observations */}
      {data.topObservations.length > 0 && (
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-4">👀 Active observations</h2>
          <div className="flex flex-col gap-2">
            {data.topObservations.map((obs) => {
              const sevClass = SEVERITY_COLORS[obs.severity] ?? SEVERITY_COLORS.info;
              return (
                <a key={obs.id} href={`/observations?highlight=${obs.id}`} className="bg-card border border-border rounded-lg px-4 py-3 flex items-center gap-3 hover:border-accent transition-colors no-underline">
                  <Badge className={sevClass}>{obs.severity}</Badge>
                  <Badge className="text-text-dim bg-border">{obs.kind}</Badge>
                  {obs.votes > 1 && <Badge className="text-orange bg-orange/15">{obs.votes}x</Badge>}
                  <span className="text-[13px] text-text flex-1 truncate">{obs.title}</span>
                </a>
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


