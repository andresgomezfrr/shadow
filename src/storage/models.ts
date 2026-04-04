// --- Entity linking ---

export type EntityLink = {
  type: 'repo' | 'project' | 'system' | 'contact';
  id: string;
};

// --- Projects ---

export type ProjectRecord = {
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
  lastFetchedAt: string | null;
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
  logsLocation: string | null;
  deployMethod: string | null;
  debugGuide: string | null;
  relatedRepos: string[];
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
  entities: EntityLink[];
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
};

// --- Observations ---

export type ObservationRecord = {
  id: string;
  repoId: string;
  repoIds: string[];
  entities: EntityLink[];
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
  entities: EntityLink[];
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

// --- Entity Relations ---

export type EntityRelationRecord = {
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

// --- Jobs ---

export type JobRecord = {
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

// --- Feedback ---

export type FeedbackRecord = {
  id: string;
  targetKind: string;
  targetId: string;
  action: string;
  note: string | null;
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

// --- Digests ---

export type DigestRecord = {
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

// --- Memory search result ---

export type MemorySearchResult = {
  memory: MemoryRecord;
  rank: number;
  snippet: string;
};
