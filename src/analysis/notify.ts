import type { HeartbeatContext } from './state-machine.js';

export async function activityNotify(
  ctx: HeartbeatContext,
): Promise<{ eventsQueued: number }> {
  let eventsQueued = 0;

  // Check proactivity level to decide what gets queued
  const proactivityLevel = ctx.profile.proactivityLevel;

  // Check for pending suggestions that haven't been shown yet
  const pendingSuggestions = ctx.db.listSuggestions({ status: 'open' });
  const unshownSuggestions = pendingSuggestions.filter((s) => !s.shownAt);

  for (const suggestion of unshownSuggestions) {
    // Only queue high-impact suggestions at low proactivity levels
    if (proactivityLevel < 5 && suggestion.impactScore < 4) continue;
    // Only queue medium+ impact at medium proactivity
    if (proactivityLevel < 8 && suggestion.impactScore < 2) continue;

    ctx.db.createEvent({
      kind: 'suggestion_ready',
      priority: suggestion.impactScore + suggestion.confidenceScore / 100,
      payload: {
        suggestionId: suggestion.id,
        title: suggestion.title,
        kind: suggestion.kind,
        impactScore: suggestion.impactScore,
      },
    });
    ctx.db.updateSuggestion(suggestion.id, { shownAt: new Date().toISOString() });
    eventsQueued++;
  }

  // Check for high-severity active observations that should trigger immediate notifications.
  // Throttle 24h per observation via observations.last_notified_at — prevents the historical
  // bug where dedup only checked undelivered events and every heartbeat re-queued a new one
  // for the same observation (one obs accumulated 90+ events in prod).
  const THROTTLE_MS = 24 * 60 * 60 * 1000;
  const nowMs = Date.now();
  const recentObservations = ctx.db.listObservations({ status: 'open', limit: 50 });
  const criticalObservations = recentObservations.filter(
    (obs) => obs.severity === 'high' || obs.severity === 'critical',
  );

  // Still skip if there's a pending event for the same obs — avoids same-tick duplicates
  const pendingEvents = ctx.db.listPendingEvents();
  const notifiedObsIds = new Set(
    pendingEvents
      .filter((e) => e.kind === 'observation_notable')
      .map((e) => e.payload?.observationId as string | undefined)
      .filter(Boolean),
  );

  for (const obs of criticalObservations) {
    if (notifiedObsIds.has(obs.id)) continue;
    if (obs.lastNotifiedAt) {
      const lastMs = Date.parse(obs.lastNotifiedAt);
      if (Number.isFinite(lastMs) && nowMs - lastMs < THROTTLE_MS) continue;
    }

    // Always notify on critical/high observations regardless of proactivity level.
    // Payload includes both repoId and projectIds (extracted from entities) so
    // consumers can route the notification even when the LLM put a wrong
    // repo_id but linked the right project entity (audit A-08).
    const projectIds = (obs.entities ?? [])
      .filter((e) => e.type === 'project')
      .map((e) => e.id);
    const nowIso = new Date(nowMs).toISOString();
    ctx.db.createEvent({
      kind: 'observation_notable',
      priority: obs.severity === 'critical' ? 9 : 7,
      payload: {
        observationId: obs.id,
        title: obs.title,
        kind: obs.kind,
        severity: obs.severity,
        repoId: obs.repoId,
        projectIds,
      },
    });
    ctx.db.setObservationNotifiedAt(obs.id, nowIso);
    eventsQueued++;
  }

  return { eventsQueued };
}
