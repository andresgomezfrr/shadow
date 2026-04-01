import type { ShadowDatabase } from '../storage/database.js';
import type { ObservationRecord } from '../storage/models.js';

/**
 * Pattern detection from observations.
 *
 * These are programmatic pre-filters that identify patterns across observations.
 * The actual analysis and insight generation is done by the LLM in the heartbeat
 * analyze phase. These patterns help the LLM focus on what's important.
 */

export type DetectedPattern = {
  kind: string;
  title: string;
  detail: Record<string, unknown>;
  observationIds: string[];
};

/**
 * Detect patterns from unprocessed observations.
 * Returns patterns that should be highlighted in the LLM analyze prompt.
 */
export function detectPatterns(
  db: ShadowDatabase,
  observations: ObservationRecord[],
): DetectedPattern[] {
  const patterns: DetectedPattern[] = [];

  patterns.push(...detectHotFiles(observations));
  patterns.push(...detectRecurringFailures(observations));
  patterns.push(...detectWorkSchedule(observations));

  return patterns;
}

/**
 * Files that appear in multiple file_hotspot observations.
 */
function detectHotFiles(observations: ObservationRecord[]): DetectedPattern[] {
  const hotspots = observations.filter((o) => o.kind === 'file_hotspot');
  if (hotspots.length < 2) return [];

  const fileCounts = new Map<string, string[]>();
  for (const obs of hotspots) {
    const file = (obs.detail as Record<string, unknown>).file as string | undefined;
    if (!file) continue;
    const ids = fileCounts.get(file) ?? [];
    ids.push(obs.id);
    fileCounts.set(file, ids);
  }

  const patterns: DetectedPattern[] = [];
  for (const [file, ids] of fileCounts) {
    if (ids.length >= 2) {
      patterns.push({
        kind: 'recurring_hotspot',
        title: `${file} is a recurring hotspot (${ids.length} observations)`,
        detail: { file, count: ids.length },
        observationIds: ids,
      });
    }
  }

  return patterns;
}

/**
 * Same test_failure observed multiple times.
 */
function detectRecurringFailures(observations: ObservationRecord[]): DetectedPattern[] {
  const failures = observations.filter((o) => o.kind === 'test_failure');
  if (failures.length < 2) return [];

  return [
    {
      kind: 'recurring_test_failure',
      title: `Test failures detected ${failures.length} times`,
      detail: { count: failures.length },
      observationIds: failures.map((o) => o.id),
    },
  ];
}

/**
 * Work session patterns (start/end times).
 */
function detectWorkSchedule(observations: ObservationRecord[]): DetectedPattern[] {
  const sessions = observations.filter(
    (o) => o.kind === 'work_session_start' || o.kind === 'work_session_end',
  );
  if (sessions.length < 3) return [];

  return [
    {
      kind: 'work_schedule',
      title: `Detected ${sessions.length} work session events`,
      detail: {
        starts: sessions.filter((o) => o.kind === 'work_session_start').length,
        ends: sessions.filter((o) => o.kind === 'work_session_end').length,
      },
      observationIds: sessions.map((o) => o.id),
    },
  ];
}
