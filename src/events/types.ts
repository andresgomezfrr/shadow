export type ShadowEventKind =
  | 'suggestion_ready'
  | 'observation_notable'
  | 'run_completed'
  | 'run_failed'
  | 'job_completed'
  | 'job_failed'
  | 'version_available';

export type ShadowEventPayload = {
  message: string;
  detail?: string;
  suggestionId?: string;
  runId?: string;
  repoId?: string;
  observationIds?: string[];
  jobType?: string;
};

export const EVENT_PRIORITIES: Record<ShadowEventKind, number> = {
  run_failed: 8,
  version_available: 8,
  observation_notable: 7,
  job_failed: 7,
  suggestion_ready: 6,
  run_completed: 6,
  job_completed: 3,
};
