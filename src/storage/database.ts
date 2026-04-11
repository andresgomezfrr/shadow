import { DatabaseSync } from 'node:sqlite';
import * as sqliteVec from 'sqlite-vec';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import type { ShadowConfig } from '../config/load-config.js';
import type {
  AuditEventRecord,
  ContactRecord,
  DigestRecord,
  EnrichmentCacheRecord,
  EntityLink,
  EntityRelationRecord,
  EventRecord,
  FeedbackRecord,
  InteractionRecord,
  JobRecord,
  LlmUsageRecord,
  MemoryRecord,
  MemorySearchResult,
  ObservationRecord,
  ProjectRecord,
  RepoRecord,
  RunRecord,
  SuggestionRecord,
  SystemRecord,
  TaskRecord,
  UserProfileRecord,
} from './models.js';
import { applyMigrations } from './migrations.js';

import * as entities from './stores/entities.js';
import * as knowledge from './stores/knowledge.js';
import * as execution from './stores/execution.js';
import * as tracking from './stores/tracking.js';
import * as profileStore from './stores/profile.js';
import * as enrichmentStore from './stores/enrichment.js';
import * as relations from './stores/relations.js';
import * as tasksStore from './stores/tasks.js';

// --- Input types ---

export type CreateRepoInput = {
  name: string;
  path: string;
  remoteUrl?: string | null;
  defaultBranch?: string;
  languageHint?: string | null;
  testCommand?: string | null;
  lintCommand?: string | null;
  buildCommand?: string | null;
};

export type CreateProjectInput = {
  name: string;
  kind?: string;
  description?: string | null;
  status?: string;
  repoIds?: string[];
  systemIds?: string[];
  contactIds?: string[];
  startDate?: string | null;
  endDate?: string | null;
  notesMd?: string | null;
};

export type CreateSystemInput = {
  name: string;
  kind: string;
  url?: string | null;
  description?: string | null;
  accessMethod?: string | null;
  config?: Record<string, unknown>;
  healthCheck?: string | null;
  logsLocation?: string | null;
  deployMethod?: string | null;
  debugGuide?: string | null;
};

export type CreateContactInput = {
  name: string;
  role?: string | null;
  team?: string | null;
  email?: string | null;
  slackId?: string | null;
  githubHandle?: string | null;
  notesMd?: string | null;
  preferredChannel?: string | null;
};

export type CreateMemoryInput = {
  repoId?: string | null;
  contactId?: string | null;
  systemId?: string | null;
  layer: string;
  scope: string;
  kind: string;
  title: string;
  bodyMd: string;
  tags?: string[];
  sourceType: string;
  sourceId?: string | null;
  confidenceScore?: number;
  relevanceScore?: number;
  memoryType?: 'episodic' | 'semantic';
  validFrom?: string | null;
  validUntil?: string | null;
  sourceMemoryIds?: string[];
};

export type CreateObservationInput = {
  repoId: string;
  sourceKind?: string;
  sourceId?: string | null;
  kind: string;
  severity?: string;
  title: string;
  detail?: Record<string, unknown>;
  context?: Record<string, unknown>;
};

export type CreateSuggestionInput = {
  repoId?: string | null;
  repoIds?: string[];
  sourceObservationId?: string | null;
  kind: string;
  title: string;
  summaryMd: string;
  reasoningMd?: string | null;
  impactScore?: number;
  confidenceScore?: number;
  riskScore?: number;
  requiredTrustLevel?: number;
};

export type CreateRunInput = {
  repoId: string;
  repoIds?: string[];
  suggestionId?: string | null;
  taskId?: string | null;
  parentRunId?: string | null;
  kind: string;
  prompt: string;
};

export type CreateAuditEventInput = {
  actor?: string;
  interface: string;
  action: string;
  targetKind?: string | null;
  targetId?: string | null;
  detail?: Record<string, unknown>;
};

export type CreateLlmUsageInput = {
  source: string;
  sourceId?: string | null;
  model: string;
  inputTokens: number;
  outputTokens: number;
};

// --- Database class ---

export class ShadowDatabase {
  readonly config: ShadowConfig;
  private readonly database: DatabaseSync;

  constructor(config: ShadowConfig) {
    this.config = config;
    mkdirSync(dirname(config.resolvedDatabasePath), { recursive: true });
    this.database = new DatabaseSync(config.resolvedDatabasePath, { allowExtension: true });
    sqliteVec.load(this.database);
    applyMigrations(this.database, config.resolvedDatabasePath);
  }

  /** Raw DatabaseSync handle — used by search.ts for vector queries */
  get rawDb(): DatabaseSync {
    return this.database;
  }

  close(): void {
    this.database.close();
  }

  // --- Storage info ---

  listTables(): string[] {
    const rows = this.database
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    return rows.map((r) => r.name);
  }

  // --- Repos ---

  createRepo(input: CreateRepoInput): RepoRecord { return entities.createRepo(this.database, input); }
  getRepo(id: string): RepoRecord | null { return entities.getRepo(this.database, id); }
  findRepoByName(name: string): RepoRecord | null { return entities.findRepoByName(this.database, name); }
  findRepoByPath(path: string): RepoRecord | null { return entities.findRepoByPath(this.database, path); }
  listRepos(): RepoRecord[] { return entities.listRepos(this.database); }
  countRepos(): number { return entities.countRepos(this.database); }
  updateRepo(id: string, updates: Partial<Pick<RepoRecord, 'name' | 'remoteUrl' | 'defaultBranch' | 'languageHint' | 'testCommand' | 'lintCommand' | 'buildCommand' | 'lastObservedAt' | 'lastFetchedAt' | 'lastRemoteHead' | 'contextMd' | 'contextUpdatedAt'>>): void { return entities.updateRepo(this.database, id, updates); }
  deleteRepo(id: string): void {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      entities.deleteRepo(this.database, id);
      knowledge.removeEntityReferences(this.database, 'repo', id);
      relations.deleteRelationsFor(this.database, 'repo', id);
      this.database.exec('COMMIT');
    } catch (e) {
      this.database.exec('ROLLBACK');
      throw e;
    }
  }

  // --- Systems ---

  createSystem(input: CreateSystemInput): SystemRecord { return entities.createSystem(this.database, input); }
  getSystem(id: string): SystemRecord | null { return entities.getSystem(this.database, id); }
  getSystemsByIds(ids: string[]): SystemRecord[] { return entities.getSystemsByIds(this.database, ids); }
  findSystemByName(name: string): SystemRecord | null { return entities.findSystemByName(this.database, name); }
  listSystems(filters?: { kind?: string }): SystemRecord[] { return entities.listSystems(this.database, filters); }
  countSystems(): number { return entities.countSystems(this.database); }
  updateSystem(id: string, updates: Partial<Pick<SystemRecord, 'name' | 'kind' | 'url' | 'description' | 'accessMethod' | 'healthCheck' | 'logsLocation' | 'deployMethod' | 'debugGuide' | 'lastCheckedAt'>>): void { return entities.updateSystem(this.database, id, updates); }
  deleteSystem(id: string): void {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      entities.deleteSystem(this.database, id);
      knowledge.removeEntityReferences(this.database, 'system', id);
      relations.deleteRelationsFor(this.database, 'system', id);
      this.database.exec('COMMIT');
    } catch (e) {
      this.database.exec('ROLLBACK');
      throw e;
    }
  }

  // --- Projects ---

  createProject(input: CreateProjectInput): ProjectRecord { return entities.createProject(this.database, input); }
  getProject(id: string): ProjectRecord | null { return entities.getProject(this.database, id); }
  findProjectByName(name: string): ProjectRecord | null { return entities.findProjectByName(this.database, name); }
  listProjects(filters?: { status?: string }): ProjectRecord[] { return entities.listProjects(this.database, filters); }
  updateProject(id: string, updates: Partial<Pick<ProjectRecord, 'name' | 'kind' | 'description' | 'status' | 'repoIds' | 'systemIds' | 'contactIds' | 'startDate' | 'endDate' | 'notesMd' | 'contextMd' | 'contextUpdatedAt'>>): ProjectRecord { return entities.updateProject(this.database, id, updates); }
  deleteProject(id: string): void {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      entities.deleteProject(this.database, id);
      knowledge.removeEntityReferences(this.database, 'project', id);
      relations.deleteRelationsFor(this.database, 'project', id);
      this.database.exec('COMMIT');
    } catch (e) {
      this.database.exec('ROLLBACK');
      throw e;
    }
  }
  findProjectsForRepo(repoId: string): ProjectRecord[] { return entities.findProjectsForRepo(this.database, repoId); }

  // --- Contacts ---

  createContact(input: CreateContactInput): ContactRecord { return entities.createContact(this.database, input); }
  getContact(id: string): ContactRecord | null { return entities.getContact(this.database, id); }
  findContactByName(name: string): ContactRecord | null { return entities.findContactByName(this.database, name); }
  listContacts(filters?: { team?: string }): ContactRecord[] { return entities.listContacts(this.database, filters); }
  countContacts(): number { return entities.countContacts(this.database); }
  updateContact(id: string, updates: Partial<Pick<ContactRecord, 'name' | 'role' | 'team' | 'email' | 'slackId' | 'githubHandle' | 'notesMd' | 'preferredChannel' | 'lastMentionedAt'>>): void { return entities.updateContact(this.database, id, updates); }
  deleteContact(id: string): void {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      entities.deleteContact(this.database, id);
      knowledge.removeEntityReferences(this.database, 'contact', id);
      relations.deleteRelationsFor(this.database, 'contact', id);
      this.database.exec('COMMIT');
    } catch (e) {
      this.database.exec('ROLLBACK');
      throw e;
    }
  }

  // --- User Profile ---

  getProfile(id = 'default'): UserProfileRecord | null { return profileStore.getProfile(this.database, id); }
  ensureProfile(id = 'default'): UserProfileRecord { return profileStore.ensureProfile(this.database, id); }
  updateProfile(id: string, updates: Record<string, unknown>): void { return profileStore.updateProfile(this.database, id, updates); }

  // --- Memories ---

  createMemory(input: CreateMemoryInput): MemoryRecord { return knowledge.createMemory(this.database, input); }
  getMemory(id: string): MemoryRecord | null { return knowledge.getMemory(this.database, id); }
  listMemories(filters?: { layer?: string; layers?: string[]; scope?: string; repoId?: string; memoryType?: string; kind?: string; archived?: boolean; createdSince?: string; entityType?: string; entityId?: string; limit?: number; offset?: number }): MemoryRecord[] { return knowledge.listMemories(this.database, filters); }
  countMemories(filters?: { layer?: string; memoryType?: string; kind?: string; archived?: boolean; createdSince?: string; entityType?: string; entityId?: string }): number { return knowledge.countMemories(this.database, filters); }
  searchMemories(query: string, options?: { layer?: string; scope?: string; repoId?: string; limit?: number }): MemorySearchResult[] { return knowledge.searchMemories(this.database, query, options); }
  updateMemory(id: string, updates: Partial<Pick<MemoryRecord, 'layer' | 'scope' | 'kind' | 'title' | 'bodyMd' | 'tags' | 'confidenceScore' | 'relevanceScore' | 'accessCount' | 'lastAccessedAt' | 'promotedFrom' | 'demotedTo' | 'archivedAt'>> & { entities?: Array<{ type: string; id: string }> }): void { return knowledge.updateMemory(this.database, id, updates); }
  touchMemory(id: string): void { return knowledge.touchMemory(this.database, id); }
  mergeMemoryBody(id: string, newBodyMd: string, newTags?: string[]): void { return knowledge.mergeMemoryBody(this.database, id, newBodyMd, newTags); }

  // --- Observations ---

  createObservation(input: CreateObservationInput): ObservationRecord { return knowledge.createObservation(this.database, input); }
  getObservation(id: string): ObservationRecord | null { return knowledge.getObservation(this.database, id); }
  listObservations(filters?: { repoId?: string; sourceKind?: string; processed?: boolean; status?: string; severity?: string; kind?: string; projectId?: string; entityType?: string; entityId?: string; limit?: number; offset?: number }): ObservationRecord[] { return knowledge.listObservations(this.database, filters); }
  countObservations(filters?: { repoId?: string; status?: string; severity?: string; kind?: string; projectId?: string; entityType?: string; entityId?: string }): number { return knowledge.countObservations(this.database, filters); }
  countObservationsSince(since: string): number { return knowledge.countObservationsSince(this.database, since); }
  markObservationProcessed(id: string, suggestionId?: string): void { return knowledge.markObservationProcessed(this.database, id, suggestionId); }
  updateObservationStatus(id: string, status: string): void { return knowledge.updateObservationStatus(this.database, id, status); }
  expireObservationsBySeverity(): number { return knowledge.expireObservationsBySeverity(this.database); }
  capObservationsPerRepo(maxPerRepo = 10): number { return knowledge.capObservationsPerRepo(this.database, maxPerRepo); }
  touchObservationLastSeen(id: string): void { return knowledge.touchObservationLastSeen(this.database, id); }
  touchObservationsLastSeen(ids: string[]): void { return knowledge.touchObservationsLastSeen(this.database, ids); }
  bumpObservationVotes(id: string, context?: Record<string, unknown>): void { return knowledge.bumpObservationVotes(this.database, id, context); }
  reopenObservation(id: string, context?: Record<string, unknown>): void { return knowledge.reopenObservation(this.database, id, context); }

  // --- Suggestions ---

  createSuggestion(input: CreateSuggestionInput): SuggestionRecord { return knowledge.createSuggestion(this.database, input); }
  getSuggestion(id: string): SuggestionRecord | null { return knowledge.getSuggestion(this.database, id); }
  listSuggestions(filters?: { status?: string; kind?: string; repoId?: string; projectId?: string; entityType?: string; entityId?: string; sortBy?: string; limit?: number; offset?: number }): SuggestionRecord[] { return knowledge.listSuggestions(this.database, filters); }
  countSuggestions(filters?: { status?: string; kind?: string; repoId?: string; projectId?: string; entityType?: string; entityId?: string }): number { return knowledge.countSuggestions(this.database, filters); }
  updateSuggestion(id: string, updates: Partial<Pick<SuggestionRecord, 'status' | 'feedbackNote' | 'shownAt' | 'resolvedAt' | 'expiresAt' | 'title' | 'summaryMd' | 'reasoningMd' | 'impactScore' | 'confidenceScore' | 'riskScore' | 'revalidationCount' | 'lastRevalidatedAt' | 'revalidationVerdict' | 'revalidationNote'>>): void { return knowledge.updateSuggestion(this.database, id, updates); }
  countPendingSuggestions(): number { return knowledge.countPendingSuggestions(this.database); }

  // --- Vector embeddings ---

  storeEmbedding(table: 'memory_vectors' | 'observation_vectors' | 'suggestion_vectors' | 'enrichment_vectors', id: string, embedding: Float32Array): void { return knowledge.storeEmbedding(this.database, table, id, embedding); }
  deleteEmbedding(table: 'memory_vectors' | 'observation_vectors' | 'suggestion_vectors' | 'enrichment_vectors', id: string): void { return knowledge.deleteEmbedding(this.database, table, id); }
  removeEntityReferences(entityType: string, entityId: string): void { return knowledge.removeEntityReferences(this.database, entityType, entityId); }
  syncEntityLinks(sourceTable: string, sourceId: string, entities: EntityLink[]): void { return knowledge.syncEntityLinks(this.database, sourceTable, sourceId, entities); }

  // --- Interactions ---

  createInteraction(input: { interface: string; kind: string; inputSummary?: string | null; outputSummary?: string | null; sentiment?: string | null; topics?: string[]; trustDelta?: number }): InteractionRecord { return tracking.createInteraction(this.database, input); }
  getInteraction(id: string): InteractionRecord | null { return tracking.getInteraction(this.database, id); }
  listRecentInteractions(limit = 20): InteractionRecord[] { return tracking.listRecentInteractions(this.database, limit); }

  // --- Event Queue ---

  createEvent(input: { kind: string; priority?: number; payload?: Record<string, unknown> }): EventRecord | null { return tracking.createEvent(this.database, input); }
  getEvent(id: string): EventRecord | null { return tracking.getEvent(this.database, id); }
  listPendingEvents(minPriority?: number): EventRecord[] { return tracking.listPendingEvents(this.database, minPriority); }
  deliverEvent(id: string): void { return tracking.deliverEvent(this.database, id); }
  deliverAllEvents(): number { return tracking.deliverAllEvents(this.database); }
  listUnreadEvents(since?: string): import('./models.js').EventRecord[] { return tracking.listUnreadEvents(this.database, since); }
  markEventRead(id: string): void { return tracking.markEventRead(this.database, id); }
  markAllEventsRead(): number { return tracking.markAllEventsRead(this.database); }

  // --- Runs ---

  createRun(input: CreateRunInput): RunRecord { return execution.createRun(this.database, input); }
  getRun(id: string): RunRecord | null { return execution.getRun(this.database, id); }
  listRuns(filters?: { status?: string; repoId?: string; parentRunId?: string; archived?: boolean; startedAfter?: string; limit?: number; offset?: number }): RunRecord[] { return execution.listRuns(this.database, filters); }
  countRuns(filters?: { status?: string; archived?: boolean }): number { return execution.countRuns(this.database, filters); }
  updateRun(id: string, updates: Partial<Pick<RunRecord, 'status' | 'resultSummaryMd' | 'errorSummary' | 'artifactDir' | 'sessionId' | 'worktreePath' | 'confidence' | 'prUrl' | 'snapshotRef' | 'resultRef' | 'diffStat' | 'verified' | 'closedNote' | 'archived' | 'activity' | 'outcome' | 'taskId' | 'startedAt' | 'finishedAt'>> & { doubts?: string[]; verification?: RunRecord['verification'] }): void { return execution.updateRun(this.database, id, updates); }
  transitionRun(id: string, to: import('./models.js').RunRecord['status']): void { return execution.transitionRun(this.database, id, to); }

  // --- Entity Relations ---

  createRelation(input: { sourceType: string; sourceId: string; relation: string; targetType: string; targetId: string; confidence?: number; sourceOrigin?: string; metadata?: Record<string, unknown> }): EntityRelationRecord { return relations.createRelation(this.database, input); }
  getRelation(id: string): EntityRelationRecord | null { return relations.getRelation(this.database, id); }
  listRelations(filters?: { sourceType?: string; sourceId?: string; targetType?: string; targetId?: string; relation?: string }): EntityRelationRecord[] { return relations.listRelations(this.database, filters); }
  getRelatedEntities(type: string, id: string, opts?: { direction?: 'outgoing' | 'incoming' | 'both'; maxDepth?: number }): Array<{ entityType: string; entityId: string; depth: number }> { return relations.getRelatedEntities(this.database, type, id, opts); }
  deleteRelation(id: string): void { return relations.deleteRelation(this.database, id); }
  deleteRelationsFor(type: string, id: string): void { return relations.deleteRelationsFor(this.database, type, id); }

  // --- Jobs ---

  createJob(input: { type: string; startedAt: string }): JobRecord { return execution.createJob(this.database, input); }
  getJob(id: string): JobRecord | null { return execution.getJob(this.database, id); }
  updateJob(id: string, updates: Partial<Pick<JobRecord, 'phase' | 'phases' | 'activity' | 'status' | 'llmCalls' | 'tokensUsed' | 'result' | 'durationMs' | 'finishedAt'>>): void { return execution.updateJob(this.database, id, updates); }
  listJobs(filters?: { type?: string; typePrefix?: string; status?: string; startedAfter?: string; limit?: number; offset?: number }): JobRecord[] { return execution.listJobs(this.database, filters); }
  countJobs(filters?: { type?: string; typePrefix?: string; status?: string }): number { return execution.countJobs(this.database, filters); }
  getLastJob(type: string): JobRecord | null { return execution.getLastJob(this.database, type); }
  enqueueJob(type: string, opts?: { priority?: number; triggerSource?: string; params?: Record<string, unknown> }): JobRecord { return execution.enqueueJob(this.database, type, opts); }
  claimNextJob(opts?: { types?: string[]; excludeTypes?: string[] }): JobRecord | null { return execution.claimNextJob(this.database, opts); }
  hasQueuedOrRunning(type: string): boolean { return execution.hasQueuedOrRunning(this.database, type); }

  // --- Feedback ---

  createFeedback(input: { targetKind: string; targetId: string; action: string; note?: string | null; category?: string | null }): void { return tracking.createFeedback(this.database, input); }
  listFeedback(targetKind?: string, limit = 15): FeedbackRecord[] { return tracking.listFeedback(this.database, targetKind, limit); }
  getThumbsState(targetKind?: string): Record<string, string> { return tracking.getThumbsState(this.database, targetKind); }
  getDismissPatterns(repoId?: string): Array<{ category: string; count: number; recentNotes: string[] }> { return tracking.getDismissPatterns(this.database, repoId); }
  getAcceptDismissRate(days = 30): { accepted: number; dismissed: number; total: number; rate: number } { return tracking.getAcceptDismissRate(this.database, days); }
  hasResolveFeedback(observationId: string): boolean { return tracking.hasResolveFeedback(this.database, observationId); }

  // --- Audit Events ---

  createAuditEvent(input: CreateAuditEventInput): AuditEventRecord { return tracking.createAuditEvent(this.database, input); }
  getAuditEvent(id: string): AuditEventRecord | null { return tracking.getAuditEvent(this.database, id); }
  listAuditEvents(limit = 50): AuditEventRecord[] { return tracking.listAuditEvents(this.database, limit); }

  // --- LLM Usage ---

  recordLlmUsage(input: CreateLlmUsageInput): LlmUsageRecord { return tracking.recordLlmUsage(this.database, input); }
  getLlmUsage(id: string): LlmUsageRecord | null { return tracking.getLlmUsage(this.database, id); }
  getUsageSummary(period: 'day' | 'week' | 'month' = 'day'): { totalInputTokens: number; totalOutputTokens: number; totalCalls: number; byModel: Record<string, { input: number; output: number; calls: number }> } { return tracking.getUsageSummary(this.database, period); }

  // --- Enrichment Cache ---

  upsertEnrichment(input: { source: string; entityType?: string; entityId?: string; entityName?: string; summary: string; detail?: Record<string, unknown>; contentHash: string; expiresAt?: string }): EnrichmentCacheRecord { return enrichmentStore.upsertEnrichment(this.database, input); }
  getEnrichment(id: string): EnrichmentCacheRecord | null { return enrichmentStore.getEnrichment(this.database, id); }
  listNewEnrichment(limit = 20): EnrichmentCacheRecord[] { return enrichmentStore.listNewEnrichment(this.database, limit); }
  listEnrichment(filters?: { source?: string; entityType?: string; entityId?: string; reported?: boolean; createdSince?: string; limit?: number; offset?: number }): EnrichmentCacheRecord[] { return enrichmentStore.listEnrichment(this.database, filters); }
  countEnrichment(filters?: { source?: string; entityType?: string; entityId?: string; reported?: boolean }): number { return enrichmentStore.countEnrichment(this.database, filters); }
  markEnrichmentReported(id: string): void { return enrichmentStore.markEnrichmentReported(this.database, id); }
  expireStaleEnrichment(): { marked: number; deleted: number } { return enrichmentStore.expireStaleEnrichment(this.database); }
  touchEnrichment(id: string): void { return enrichmentStore.touchEnrichment(this.database, id); }
  updateEnrichmentStats(id: string, stats: { refreshCount?: number; changeCount?: number; ttlCategory?: string }): void { return enrichmentStore.updateEnrichmentStats(this.database, id, stats); }

  // --- Digests ---

  createDigest(input: { kind: string; periodStart: string; periodEnd: string; contentMd: string; model: string; tokensUsed?: number }): DigestRecord { return enrichmentStore.createDigest(this.database, input); }
  getDigest(id: string): DigestRecord | null { return enrichmentStore.getDigest(this.database, id); }
  listDigests(filters?: { kind?: string; limit?: number; before?: string; after?: string }): DigestRecord[] { return enrichmentStore.listDigests(this.database, filters); }
  getLatestDigest(kind: string): DigestRecord | null { return enrichmentStore.getLatestDigest(this.database, kind); }
  updateDigest(id: string, updates: { contentMd?: string; tokensUsed?: number }): void { return enrichmentStore.updateDigest(this.database, id, updates); }

  // --- Tasks ---

  createTask(input: Parameters<typeof tasksStore.createTask>[1]): TaskRecord { return tasksStore.createTask(this.database, input); }
  getTask(id: string): TaskRecord | null { return tasksStore.getTask(this.database, id); }
  listTasks(filters?: { status?: string; repoId?: string; projectId?: string; archived?: boolean; limit?: number; offset?: number }): TaskRecord[] { return tasksStore.listTasks(this.database, filters); }
  countTasks(filters?: { status?: string; repoId?: string; projectId?: string }): number { return tasksStore.countTasks(this.database, filters); }
  updateTask(id: string, updates: Parameters<typeof tasksStore.updateTask>[2]): void { return tasksStore.updateTask(this.database, id, updates); }
  deleteTask(id: string): void { return tasksStore.deleteTask(this.database, id); }
}

// --- Factory ---

export function createDatabase(config: ShadowConfig): ShadowDatabase {
  return new ShadowDatabase(config);
}
