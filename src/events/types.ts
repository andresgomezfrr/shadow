export type ShadowEventKind =
  | 'suggestion_ready'
  | 'suggestion_expiring'
  | 'observation_notable'
  | 'run_completed'
  | 'run_failed'
  | 'job_completed'
  | 'job_failed'
  | 'version_available'
  | 'auto_plan_complete'
  | 'plan_needs_review'
  | 'auto_execute_complete';

export type ShadowEventPayload = {
  message: string;
  detail?: string;
  suggestionId?: string;
  runId?: string;
  repoId?: string;
  observationIds?: string[];
  jobType?: string;
  jobId?: string;
};

export const EVENT_PRIORITIES: Record<ShadowEventKind, number> = {
  auto_execute_complete: 8,
  run_failed: 8,
  version_available: 8,
  plan_needs_review: 7,
  observation_notable: 7,
  job_failed: 7,
  suggestion_ready: 6,
  run_completed: 6,
  auto_plan_complete: 5,
  suggestion_expiring: 3,
  job_completed: 3,
};
