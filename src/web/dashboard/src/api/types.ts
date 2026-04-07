// Entity types — single source of truth from backend models
export type {
  EntityLink,
  ProjectRecord as Project,
  RepoRecord as Repo,
  SystemRecord as System,
  ContactRecord as Contact,
  UserProfileRecord as UserProfile,
  MemoryRecord as Memory,
  ObservationRecord as Observation,
  SuggestionRecord as Suggestion,
  HeartbeatRecord as Heartbeat,
  EventRecord,
  RunRecord as Run,
  JobRecord as Job,
  DigestRecord as Digest,
  EntityRelationRecord as EntityRelation,
  FeedbackRecord,
  LlmUsageRecord,
  EnrichmentCacheRecord,
} from '@shadow/models';

// ---------------------------------------------------------------------------
// Dashboard-only composite types (API responses, not in backend models)
// ---------------------------------------------------------------------------

export type ActivityEntry = {
  id: string;
  source: 'job' | 'run';
  type: string;
  status: string;
  phases: string[];
  activity: string | null;
  llmCalls: number;
  tokensUsed: number;
  durationMs: number | null;
  result: Record<string, unknown>;
  startedAt: string | null;
  finishedAt: string | null;
  runId: string | null;
  repoName: string | null;
  confidence: string | null;
  verified: string | null;
  parentRunId: string | null;
  prUrl: string | null;
};

export type ActivitySummary = {
  period: string;
  jobCount: number;
  runCount: number;
  llmCalls: number;
  tokensUsed: number;
  observationsCreated: number;
  memoriesCreated: number;
  suggestionsCreated: number;
};

export type UsageSummary = {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCalls: number;
  byModel: Record<string, { input: number; output: number; calls: number }>;
};

export type StatusResponse = {
  profile: import('@shadow/models').UserProfileRecord;
  counts: {
    memories: number;
    pendingSuggestions: number;
    activeObservations: number;
    runsToReview: number;
    repos: number;
    contacts: number;
    systems: number;
  };
  usage: UsageSummary;
  lastHeartbeat: import('@shadow/models').HeartbeatRecord | null;
  nextHeartbeatAt: string | null;
  recentActivity?: number;
};

export type ActiveProjectSummary = {
  id: string;
  name: string;
  kind: string;
  repoCount: number;
  systemCount: number;
  observationCount: number;
  suggestionCount: number;
  topObservation: string | null;
};

export type EnrichmentItem = {
  id: string;
  source: string;
  entityName: string | null;
  summary: string;
  createdAt: string;
};

export type DailySummary = {
  date: string;
  profile: import('@shadow/models').UserProfileRecord;
  activity: {
    observationsToday: number;
    memoriesCreatedToday: number;
    pendingSuggestions: number;
    runsToReview: number;
    pendingEvents: number;
  };
  topObservations: import('@shadow/models').ObservationRecord[];
  recentMemories: { id: string; title: string; kind: string; layer: string; createdAt: string }[];
  runsToReview: import('@shadow/models').RunRecord[];
  pendingSuggestions: import('@shadow/models').SuggestionRecord[];
  repos: { id: string; name: string; path: string; lastObservedAt: string | null }[];
  tokens: { input: number; output: number; calls: number };
  recentJobs: import('@shadow/models').JobRecord[];
  activeProjects?: ActiveProjectSummary[];
  recentEnrichment?: EnrichmentItem[];
};

export type ProjectDetail = import('@shadow/models').ProjectRecord & {
  repos: { id: string; name: string; path: string; lastObservedAt: string | null }[];
  systems: { id: string; name: string; kind: string }[];
  contacts: { id: string; name: string; role: string | null; team: string | null }[];
  observations: { id: string; kind: string; severity: string; title: string; votes: number; createdAt: string }[];
  suggestions: { id: string; kind: string; title: string; impactScore: number; confidenceScore: number; riskScore: number }[];
  memories: { id: string; kind: string; layer: string; title: string; createdAt: string }[];
  enrichment: EnrichmentItem[];
  counts: { observations: number; suggestions: number; memories: number };
};

export type SystemDetail = import('@shadow/models').SystemRecord & {
  observations: { id: string; kind: string; severity: string; title: string; createdAt: string }[];
  memories: { id: string; kind: string; title: string; createdAt: string }[];
  projects: { id: string; name: string; kind: string }[];
  counts: { observations: number; memories: number; projects: number };
};

// ---------------------------------------------------------------------------
// UI constants
// ---------------------------------------------------------------------------

export const TRUST_NAMES: Record<number, string> = {
  1: 'Observer',
  2: 'Advisor',
  3: 'Assistant',
  4: 'Partner',
  5: 'Shadow',
};

export const MOOD_EMOJIS: Record<string, string> = {
  neutral: '😐',
  happy: '😊',
  focused: '🎯',
  tired: '😴',
  excited: '🤩',
  concerned: '🤔',
  frustrated: '😤',
};

export const LAYER_COLORS: Record<string, string> = {
  core: 'text-purple bg-purple/15',
  hot: 'text-red bg-red/15',
  warm: 'text-orange bg-orange/15',
  cool: 'text-blue bg-blue/15',
  cold: 'text-text-dim bg-text-muted/15',
};

export const SEVERITY_COLORS: Record<string, string> = {
  info: 'text-blue bg-blue/15',
  warning: 'text-orange bg-orange/15',
  high: 'text-red bg-red/15',
  error: 'text-red bg-red/15',
  critical: 'text-red bg-red/25',
};

export const STATUS_COLORS: Record<string, string> = {
  active: 'text-green bg-green/15',
  acknowledged: 'text-blue bg-blue/15',
  resolved: 'text-text-dim bg-text-muted/15',
  expired: 'text-text-muted bg-text-muted/10',
};
