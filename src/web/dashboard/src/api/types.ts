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
  EventRecord,
  RunRecord as Run,
  JobRecord as Job,
  DigestRecord as Digest,
  EntityRelationRecord as EntityRelation,
  FeedbackRecord,
  LlmUsageRecord,
  EnrichmentCacheRecord,
  HeartbeatJobResult,
  SuggestJobResult,
  SuggestDeepJobResult,
  SuggestProjectJobResult,
  ConsolidateJobResult,
  ReflectJobResult,
  RemoteSyncJobResult,
  RepoProfileJobResult,
  ContextEnrichJobResult,
  ProjectProfileJobResult,
  DigestJobResult,
  JobResultMap,
  JobType,
  TaskRecord as Task,
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
    activeTasks: number;
    repos: number;
    contacts: number;
    systems: number;
  };
  usage: UsageSummary;
  lastHeartbeat: import('@shadow/models').JobRecord | null;
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
// Workspace types
// ---------------------------------------------------------------------------

export type ChainInfo = {
  observationId?: string;
  observationTitle?: string;
  suggestionId?: string;
  suggestionTitle?: string;
};

export type FeedItem = {
  source: 'run' | 'suggestion' | 'observation' | 'task';
  id: string;
  priority: number;
  data: import('@shadow/models').RunRecord | import('@shadow/models').SuggestionRecord | import('@shadow/models').ObservationRecord | import('@shadow/models').TaskRecord;
  chain?: ChainInfo;
};

export type FeedResponse = {
  items: FeedItem[];
  total: number;
  counts: { runs: number; runsActive: number; runsDone: number; runsFailed: number; tasks: number; tasksOpen: number; tasksActive: number; tasksBlocked: number; tasksDone: number; suggestions: number; sugAccepted: number; observations: number; obsDone: number; snoozed: number; acknowledged: number };
};

export type RunContext = {
  run: import('@shadow/models').RunRecord;
  childRuns: import('@shadow/models').RunRecord[];
  parentRun: import('@shadow/models').RunRecord | null;
  sourceSuggestion: import('@shadow/models').SuggestionRecord | null;
  sourceObservation: import('@shadow/models').ObservationRecord | null;
};

export type SuggestionContext = {
  suggestion: import('@shadow/models').SuggestionRecord;
  sourceObservation: import('@shadow/models').ObservationRecord | null;
  linkedRuns: import('@shadow/models').RunRecord[];
  rankScore: number | null;
  warning?: string;
};

export type ObservationContext = {
  observation: import('@shadow/models').ObservationRecord;
  generatedSuggestions: import('@shadow/models').SuggestionRecord[];
  linkedRuns: import('@shadow/models').RunRecord[];
};

export type TaskContext = {
  task: import('@shadow/models').TaskRecord;
  observations: import('@shadow/models').ObservationRecord[];
  suggestions: import('@shadow/models').SuggestionRecord[];
  runs: import('@shadow/models').RunRecord[];
};

export type PrStatus = {
  state: 'OPEN' | 'MERGED' | 'CLOSED';
  isDraft: boolean;
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;
  checksStatus: 'SUCCESS' | 'FAILURE' | 'PENDING' | null;
  url: string;
};

// ---------------------------------------------------------------------------
// Chronicle types (v49)
// ---------------------------------------------------------------------------

export type BondAxes = {
  time: number;
  depth: number;
  momentum: number;
  alignment: number;
  autonomy: number;
};

export type ChronicleTier = {
  tier: number;
  name: string;  // actual name if tier <= currentTier, otherwise '???'
  minDays: number;
  qualityFloor: number;
  isReached: boolean;
  isCurrent: boolean;
  isNext: boolean;
  loreRevealed: boolean;
};

export type ChronicleEntry = {
  id: string;
  kind: 'tier_lore' | 'milestone';
  tier: number | null;
  milestoneKey: string | null;
  title: string;
  bodyMd: string;
  model: string;
  createdAt: string;
};

export type Unlockable = {
  id: string;
  tierRequired: number;
  kind: string;
  title: string;
  description: string | null;
  payload: Record<string, unknown>;
  unlocked: boolean;
  unlockedAt: string | null;
  createdAt: string;
};

export type ChronicleResponse = {
  profile: {
    bondTier: number;
    bondAxes: BondAxes;
    bondResetAt: string;
    bondTierLastRiseAt: string | null;
  };
  tiers: ChronicleTier[];
  entries: ChronicleEntry[];
  unlockables: Unlockable[];
  nextStep: {
    tier: number;
    name: string;
    requirements: {
      minDays: number;
      daysElapsed: number;
      qualityFloor: number;
      currentQuality: number;
    };
    hint: string;
  } | null;
  voiceOfShadow: { body: string; generatedAt: string };
};

// ---------------------------------------------------------------------------
// UI constants
// ---------------------------------------------------------------------------

/** @deprecated Use BOND_TIER_NAMES — kept temporarily for back-compat. */
export const TRUST_NAMES: Record<number, string> = {
  1: 'Observer',
  2: 'Advisor',
  3: 'Assistant',
  4: 'Partner',
  5: 'Shadow',
};

export const BOND_TIER_NAMES: Record<number, string> = {
  1: 'observer',
  2: 'echo',
  3: 'whisper',
  4: 'shade',
  5: 'shadow',
  6: 'wraith',
  7: 'herald',
  8: 'kindred',
};

export const BOND_TIER_BADGES: Record<number, string> = {
  1: '🔍',
  2: '💭',
  3: '🤫',
  4: '🌫',
  5: '👾',
  6: '👻',
  7: '📯',
  8: '🌌',
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
  open: 'text-green bg-green/15',
  acknowledged: 'text-blue bg-blue/15',
  done: 'text-text-dim bg-text-muted/15',
  expired: 'text-text-muted bg-text-muted/10',
};
