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
  contextMd: string | null;
  contextUpdatedAt: string | null;
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
  lastRemoteHead: string | null;
  contextMd: string | null;
  contextUpdatedAt: string | null;
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

export type BondAxes = {
  time: number;
  depth: number;
  momentum: number;
  alignment: number;
  autonomy: number;
};

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
  focusMode: string | null;
  focusUntil: string | null;
  energyLevel: string | null;
  moodHint: string | null;
  moodPhrase: string | null;
  // Bond system (v49)
  bondAxes: BondAxes;
  bondTier: number;
  bondResetAt: string;
  bondTierLastRiseAt: string | null;
  totalInteractions: number;
  preferences: Record<string, unknown>;
  dislikes: unknown[];
  createdAt: string;
  updatedAt: string;
};

// --- Chronicle / Unlockables / Bond cache ---

export type ChronicleEntryRecord = {
  id: string;
  kind: 'tier_lore' | 'milestone';
  tier: number | null;
  milestoneKey: string | null;
  title: string;
  bodyMd: string;
  model: string;
  createdAt: string;
};

export type UnlockableRecord = {
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

export type BondDailyCacheRecord = {
  cacheKey: string;
  bodyMd: string;
  model: string;
  generatedAt: string;
  expiresAt: string;
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
  enforcedAt: number | null;
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
  lastNotifiedAt: string | null;
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
  revalidationCount: number;
  lastRevalidatedAt: string | null;
  revalidationVerdict: string | null;
  revalidationNote: string | null;
  effort: string;
  createdAt: string;
  expiresAt: string | null;
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
  readAt: string | null;
  createdAt: string;
};

// --- Runs ---

export type RunRecord = {
  id: string;
  repoId: string;
  repoIds: string[];
  suggestionId: string | null;
  taskId: string | null;
  parentRunId: string | null;
  kind: string;
  status: string;
  outcome: string | null;
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
  activity: string | null;
  closedNote: string | null;
  autoEvalAt: string | null;
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

// --- Job result types (compile-time only, runtime is always Record<string, unknown>) ---

export type HeartbeatJobResult = {
  observationsCreated: number;
  observationItems?: Array<{ id: string; title: string }>;
  memoriesCreated: number;
  memoryItems?: Array<{ id: string; title: string }>;
  reposAnalyzed: string[];
};

export type SuggestJobResult = {
  suggestionsCreated: number;
  suggestionItems: Array<{ id: string; title: string }>;
  repoId?: string;
};

export type SuggestDeepJobResult = {
  repoName: string;
  suggestionsCreated: number;
  suggestionTitles: string[];
  repoId: string;
};

export type SuggestProjectJobResult = {
  projectName: string;
  suggestionsCreated: number;
  suggestionTitles: string[];
};

export type ConsolidateJobResult = {
  memoriesPromoted: number;
  memoriesDemoted: number;
  memoriesExpired: number;
  correctionsProcessed: number;
  memoriesArchived: number;
  memoriesEdited: number;
  memoriesMerged: number;
  memoriesArchivedByMerge: number;
  memoriesDeduped: number;
};

export type ReflectJobResult = {
  skipped: boolean;
  soulUpdated?: boolean;
  reason?: string;
  deltaPreview?: string;
};

export type RemoteSyncJobResult = {
  reposSynced: number;
  reposWithChanges: number;
  repoSummaries: Array<{ name: string; newCommits: number }>;
};

export type RepoProfileJobResult = {
  reposProfiled: number;
  repoNames: string[];
};

export type ContextEnrichJobResult = {
  itemsCollected: number;
  sources: string[];
  entityNames: string[];
  projectResults?: Array<{
    projectId: string;
    projectName: string;
    itemsCollected: number;
    sources: string[];
    error?: string;
  }>;
};

export type ProjectProfileJobResult = {
  projectName: string;
  repoCount: number;
};

export type DigestJobResult = {
  periodStart?: string;
  digestId?: string;
  wordCount: number;
};

export type AutoPlanJobResult = {
  autoPlanned: number;
  autoDismissed: number;
  skipped: number;
  candidates: Array<{ suggestionId: string; title: string; action: string }>;
};

export type AutoExecuteJobResult = {
  autoExecuted: number;
  needsReview: number;
  filtered: number;
  candidates: Array<{ runId: string; action: string; reason?: string }>;
};

export type JobResultMap = {
  heartbeat: HeartbeatJobResult;
  suggest: SuggestJobResult;
  'suggest-deep': SuggestDeepJobResult;
  'suggest-project': SuggestProjectJobResult;
  consolidate: ConsolidateJobResult;
  reflect: ReflectJobResult;
  'remote-sync': RemoteSyncJobResult;
  'repo-profile': RepoProfileJobResult;
  'context-enrich': ContextEnrichJobResult;
  'project-profile': ProjectProfileJobResult;
  'digest-daily': DigestJobResult;
  'digest-weekly': DigestJobResult;
  'digest-brag': DigestJobResult;
  'auto-plan': AutoPlanJobResult;
  'auto-execute': AutoExecuteJobResult;
};

export type JobType = keyof JobResultMap;

// --- Feedback ---

export type FeedbackRecord = {
  id: string;
  targetKind: string;
  targetId: string;
  action: string;
  note: string | null;
  category: string | null;
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

// --- Enrichment Cache ---

export type EnrichmentCacheRecord = {
  id: string;
  source: string;
  entityType: string | null;
  entityId: string | null;
  entityName: string | null;
  summary: string;
  detail: Record<string, unknown>;
  contentHash: string;
  reported: boolean;
  stale: boolean;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  ttlCategory: string | null;
  refreshCount: number;
  changeCount: number;
  accessCount: number;
  lastConsumedAt: string | null;
};

// --- Tasks ---

export type TaskRecord = {
  id: string;
  title: string;
  status: string;
  contextMd: string | null;
  externalRefs: { source: string; key: string; url: string }[];
  repoIds: string[];
  projectId: string | null;
  entities: EntityLink[];
  suggestionId: string | null;
  sessionId: string | null;
  sessionRepoPath: string | null;
  prUrls: string[];
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  closedNote: string | null;
};

// --- Memory search result ---

export type MemorySearchResult = {
  memory: MemoryRecord;
  rank: number;
  snippet: string;
};
