// --- Repos ---

export type RepoRecord = {
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

// --- Systems ---

export type SystemRecord = {
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

// --- Contacts ---

export type ContactRecord = {
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

// --- User Profile ---

export type UserProfileRecord = {
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

// --- Memory ---

export type MemoryRecord = {
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
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

// --- Observations ---

export type ObservationRecord = {
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

// --- Suggestions ---

export type SuggestionRecord = {
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

// --- Heartbeats ---

export type HeartbeatRecord = {
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

// --- Interactions ---

export type InteractionRecord = {
  id: string;
  interface: string;
  kind: string;
  inputSummary: string | null;
  outputSummary: string | null;
  sentiment: string | null;
  topics: string[];
  trustDelta: number;
  createdAt: string;
};

// --- Event Queue ---

export type EventRecord = {
  id: string;
  kind: string;
  priority: number;
  payload: Record<string, unknown>;
  delivered: boolean;
  deliveredAt: string | null;
  createdAt: string;
};

// --- Runs ---

export type RunRecord = {
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
  archived: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
};

// --- Audit Events ---

export type AuditEventRecord = {
  id: string;
  actor: string;
  interface: string;
  action: string;
  targetKind: string | null;
  targetId: string | null;
  detail: Record<string, unknown>;
  createdAt: string;
};

// --- LLM Usage ---

export type LlmUsageRecord = {
  id: string;
  source: string;
  sourceId: string | null;
  model: string;
  inputTokens: number;
  outputTokens: number;
  createdAt: string;
};

// --- Memory search result ---

export type MemorySearchResult = {
  memory: MemoryRecord;
  rank: number;
  snippet: string;
};
