import { useState, useCallback } from 'react';
import { useApi } from '../../hooks/useApi';
import { fetchDailySummary, acceptSuggestion, dismissSuggestion, snoozeSuggestion } from '../../api/client';
import { TRUST_NAMES, MOOD_EMOJIS } from '../../api/types';
import { MorningMetrics } from './morning/MorningMetrics';
import { MorningJobs } from './morning/MorningJobs';
import { MorningMemories } from './morning/MorningMemories';
import { MorningRuns } from './morning/MorningRuns';
import { MorningSuggestions } from './morning/MorningSuggestions';
import { MorningObservations } from './morning/MorningObservations';
import { MorningRepos } from './morning/MorningRepos';

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

      <MorningMetrics activity={data.activity} tokens={data.tokens} />
      <MorningJobs jobs={data.recentJobs} />
      <MorningMemories memories={data.recentMemories} />
      <MorningRuns runs={data.runsToReview} />
      <MorningSuggestions
        suggestions={pendingSuggestions}
        onAccept={handleAccept}
        onDismiss={handleDismiss}
        onSnooze={handleSnooze}
      />
      <MorningObservations observations={data.topObservations} />
      <MorningRepos repos={data.repos} />
    </div>
  );
}
