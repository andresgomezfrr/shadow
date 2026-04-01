export type ShadowEventKind =
  | 'trust_level_change'
  | 'observation_notable'
  | 'suggestion_ready'
  | 'run_completed'
  | 'run_failed'
  | 'pattern_detected'
  | 'memory_insight'
  | 'consolidation_complete'
  | 'suggestion_expired';

export type ShadowEventPayload = {
  message: string;
  detail?: string;
  trustLevel?: number;
  suggestionId?: string;
  runId?: string;
  repoId?: string;
  observationIds?: string[];
};

// Priority mapping for event kinds
export const EVENT_PRIORITIES: Record<ShadowEventKind, number> = {
  trust_level_change: 9,
  run_failed: 8,
  observation_notable: 7,
  suggestion_ready: 6,
  run_completed: 6,
  pattern_detected: 5,
  memory_insight: 4,
  consolidation_complete: 3,
  suggestion_expired: 2,
};
