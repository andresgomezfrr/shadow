// Mirrors src/storage/models.ts — kept in sync manually

export type EntityRelation = {
  id: string;
  sourceType: string;
  sourceId: string;
  relation: string;
  targetType: string;
  targetId: string;
  confidence: number;
  sourceOrigin: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type UserProfile = {
  id: string;
  displayName: string | null;
  timezone: string | null;
  locale: string;
  workHours: Record<string, unknown>;
  commitPatterns: Record<string, unknown>;
  verbosity: string;
  proactiveLevel: string;
  proactivityLevel: number;
  personalityLevel: number;
  focusMode: string | null;
  focusUntil: string | null;
  energyLevel: string | null;
  moodHint: string | null;
  trustLevel: number;
  trustScore: number;
  bondLevel: number;
  totalInteractions: number;
  preferences: Record<string, unknown>;
  dislikes: unknown[];
  createdAt: string;
  updatedAt: string;
};

export type Repo = {
  id: string;
  name: string;
  path: string;
  remoteUrl: string | null;
  defaultBranch: string;
  languageHint: string | null;
  testCommand: string | null;
  lintCommand: string | null;
  buildCommand: string | null;
  lastObservedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Memory = {
  id: string;
  repoId: string | null;
  contactId: string | null;
  systemId: string | null;
  layer: string;
  scope: string;
  kind: string;
  title: string;
  bodyMd: string;
  tags: string[];
  sourceType: string;
  sourceId: string | null;
  confidenceScore: number;
  relevanceScore: number;
  accessCount: number;
  lastAccessedAt: string | null;
  promotedFrom: string | null;
  demotedTo: string | null;
  memoryType: 'episodic' | 'semantic' | 'unclassified';
  validFrom: string | null;
  validUntil: string | null;
  sourceMemoryIds: string[];
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  // search-only fields
  rank?: number;
  snippet?: string;
};

export type Observation = {
  id: string;
  repoId: string;
  sourceKind: string;
  sourceId: string | null;
  kind: string;
  severity: string;
  title: string;
  detail: Record<string, unknown>;
  context: Record<string, unknown>;
  votes: number;
  status: string;
  firstSeenAt: string;
  lastSeenAt: string;
  processed: boolean;
  suggestionId: string | null;
  createdAt: string;
};

export type Suggestion = {
  id: string;
  repoId: string | null;
  repoIds: string[];
  sourceObservationId: string | null;
  kind: string;
  title: string;
  summaryMd: string;
  reasoningMd: string | null;
  impactScore: number;
  confidenceScore: number;
  riskScore: number;
  requiredTrustLevel: number;
  status: string;
  feedbackNote: string | null;
  shownAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  expiresAt: string | null;
};

export type Heartbeat = {
  id: string;
  phase: string;
  phases: string[];
  activity: string | null;
  reposObserved: string[];
  observationsCreated: number;
  suggestionsCreated: number;
  llmCalls: number;
  tokensUsed: number;
  eventsQueued: number;
  memoriesPromoted: number;
  memoriesDemoted: number;
  durationMs: number | null;
  startedAt: string;
  finishedAt: string | null;
};

export type Contact = {
  id: string;
  name: string;
  role: string | null;
  team: string | null;
  email: string | null;
  slackId: string | null;
  githubHandle: string | null;
  notesMd: string | null;
  preferredChannel: string | null;
  lastMentionedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Project = {
  id: string;
  name: string;
  description: string | null;
  kind: string;
  status: string;
  repoIds: string[];
  systemIds: string[];
  contactIds: string[];
  startDate: string | null;
  endDate: string | null;
  notesMd: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Digest = {
  id: string;
  kind: string;
  periodStart: string;
  periodEnd: string;
  contentMd: string;
  model: string;
  tokensUsed: number;
  createdAt: string;
  updatedAt: string;
};

export type System = {
  id: string;
  name: string;
  kind: string;
  url: string | null;
  description: string | null;
  accessMethod: string | null;
  config: Record<string, unknown>;
  healthCheck: string | null;
  lastCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EventRecord = {
  id: string;
  kind: string;
  priority: number;
  payload: Record<string, unknown>;
  delivered: boolean;
  deliveredAt: string | null;
  createdAt: string;
};

export type Run = {
  id: string;
  repoId: string;
  repoIds: string[];
  suggestionId: string | null;
  parentRunId: string | null;
  kind: string;
  status: string;
  prompt: string;
  resultSummaryMd: string | null;
  errorSummary: string | null;
  artifactDir: string | null;
  sessionId: string | null;
  worktreePath: string | null;
  confidence: string | null;
  doubts: string[];
  prUrl: string | null;
  snapshotRef: string | null;
  resultRef: string | null;
  diffStat: string | null;
  verification: Record<string, { passed: boolean; output: string; durationMs: number }>;
  verified: 'verified' | 'needs_review' | 'unverified' | null;
  archived: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
};

export type Job = {
  id: string;
  type: string;
  phase: string;
  phases: string[];
  activity: string | null;
  status: string;
  priority: number;
  triggerSource: string;
  llmCalls: number;
  tokensUsed: number;
  result: Record<string, unknown>;
  durationMs: number | null;
  startedAt: string;
  finishedAt: string | null;
  createdAt: string;
};

export type UsageSummary = {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCalls: number;
  byModel: Record<string, { input: number; output: number; calls: number }>;
};

export type StatusResponse = {
  profile: UserProfile;
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
  lastHeartbeat: Heartbeat | null;
  nextHeartbeatAt: string | null;
};

export type DailySummary = {
  date: string;
  profile: UserProfile;
  activity: {
    observationsToday: number;
    memoriesCreatedToday: number;
    pendingSuggestions: number;
    runsToReview: number;
    pendingEvents: number;
  };
  topObservations: Observation[];
  recentMemories: { id: string; title: string; kind: string; layer: string; createdAt: string }[];
  runsToReview: Run[];
  pendingSuggestions: Suggestion[];
  repos: { id: string; name: string; path: string; lastObservedAt: string | null }[];
  tokens: { input: number; output: number; calls: number };
  recentJobs: Job[];
  activeProjects?: ActiveProjectSummary[];
  recentEnrichment?: EnrichmentItem[];
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

export type ProjectDetail = Project & {
  repos: { id: string; name: string; path: string; lastObservedAt: string | null }[];
  systems: { id: string; name: string; kind: string }[];
  contacts: { id: string; name: string; role: string | null; team: string | null }[];
  observations: { id: string; kind: string; severity: string; title: string; votes: number; createdAt: string }[];
  suggestions: { id: string; kind: string; title: string; impactScore: number; confidenceScore: number; riskScore: number }[];
  memories: { id: string; kind: string; layer: string; title: string; createdAt: string }[];
  enrichment: EnrichmentItem[];
  counts: { observations: number; suggestions: number; memories: number };
};

export type SystemDetail = System & {
  observations: { id: string; kind: string; severity: string; title: string; createdAt: string }[];
  memories: { id: string; kind: string; title: string; createdAt: string }[];
  projects: { id: string; name: string; kind: string }[];
  counts: { observations: number; memories: number; projects: number };
};

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
  excited: '🚀',
  concerned: '😟',
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
