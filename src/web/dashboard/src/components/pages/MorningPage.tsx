import { useState, useCallback } from 'react';
import { useApi } from '../../hooks/useApi';
import { useDialog } from '../../hooks/useDialog';
import { fetchDailySummary, fetchDigests, acceptSuggestion, dismissSuggestion, snoozeSuggestion } from '../../api/client';
import { BOND_TIER_NAMES, MOOD_EMOJIS } from '../../api/types';
import { VoiceOfShadow } from './chronicle/VoiceOfShadow';
import { MorningMetrics } from './morning/MorningMetrics';
import { MorningJobs } from './morning/MorningJobs';
import { MorningMemories } from './morning/MorningMemories';
import { MorningRuns } from './morning/MorningRuns';
import { MorningSuggestions } from './morning/MorningSuggestions';
import { MorningObservations } from './morning/MorningObservations';
import { MorningRepos } from './morning/MorningRepos';
import { MorningDigest } from './morning/MorningDigest';
import { MorningProjects } from './morning/MorningProjects';
import { MorningEnrichment } from './morning/MorningEnrichment';

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
  const { data: digests } = useApi(() => fetchDigests({ kind: 'daily' }), [], 60_000);
  const now = new Date();
  const yesterdayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const yesterday = `${yesterdayDate.getFullYear()}-${String(yesterdayDate.getMonth() + 1).padStart(2, '0')}-${String(yesterdayDate.getDate()).padStart(2, '0')}`;
  const latestDigest = digests?.find((d) => d.periodStart === yesterday) ?? null;
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const { dialog, prompt } = useDialog();

  const handleAccept = useCallback(async (id: string) => {
    await acceptSuggestion(id);
    setDismissed((s) => new Set(s).add(id));
    refresh();
  }, [refresh]);

  const handleDismiss = useCallback(async (id: string) => {
    const note = await prompt({ title: 'Dismiss suggestion', message: 'Reason for dismissing (optional):', placeholder: 'Why is this being dismissed?' });
    if (note === null) return;
    await dismissSuggestion(id, note || undefined);
    setDismissed((s) => new Set(s).add(id));
    refresh();
  }, [prompt, refresh]);

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
  const bondName = BOND_TIER_NAMES[profile.bondTier] ?? 'observer';
  const pendingSuggestions = data.pendingSuggestions.filter((s) => !dismissed.has(s.id));

  return (
    <div className="max-w-5xl mx-auto">
      {dialog}
      {/* Greeting */}
      <div className="mb-6 flex items-center gap-5">
        <video
          autoPlay
          loop
          muted
          playsInline
          className="w-[120px] h-[120px] rounded-full object-cover shrink-0"
          src="/ghost/morning-greeting.mp4"
        />
        <div>
          <h1 className="text-2xl font-semibold">
            {getGreeting()}, {profile.displayName ?? 'dev'} {moodEmoji}
          </h1>
          <p className="text-text-dim mt-1 capitalize">{formatDate()}</p>
          <p className="text-text-muted text-xs mt-0.5">
            Bond: Lv.{profile.bondTier} {bondName}
          </p>
          <VoiceOfShadow className="mt-1" />
        </div>
      </div>

      {/* Yesterday's digest — context before today's data */}
      <MorningDigest digest={latestDigest} />

      {/* Metrics + Jobs — full width */}
      <MorningMetrics activity={data.activity} tokens={data.tokens} />
      <MorningJobs jobs={data.recentJobs} />

      {/* Active projects — scannable at a glance */}
      {data.activeProjects && data.activeProjects.length > 0 && (
        <MorningProjects projects={data.activeProjects} />
      )}

      {/* External context from MCP enrichment */}
      {data.recentEnrichment && data.recentEnrichment.length > 0 && (
        <MorningEnrichment items={data.recentEnrichment} />
      )}

      {/* 2-column grid — reduce scroll */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-0">
        <div>
          <MorningRuns runs={data.runsToReview} />
          <MorningMemories memories={data.recentMemories} />
        </div>
        <div>
          <MorningObservations observations={data.topObservations} />
          <MorningRepos repos={data.repos} />
        </div>
      </div>

      {/* Suggestions — full width (needs space for action buttons) */}
      <MorningSuggestions
        suggestions={pendingSuggestions}
        onAccept={handleAccept}
        onDismiss={handleDismiss}
        onSnooze={handleSnooze}
      />
    </div>
  );
}
