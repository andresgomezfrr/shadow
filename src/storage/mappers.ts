import type {
  AuditEventRecord,
  BondAxes,
  BondDailyCacheRecord,
  ChronicleEntryRecord,
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
  ObservationRecord,
  ProjectRecord,
  RepoRecord,
  RunRecord,
  SuggestionRecord,
  SystemRecord,
  TaskRecord,
  UnlockableRecord,
  UserProfileRecord,
} from './models.js';

// --- Primitive types ---

export type SQLValue = string | number | bigint | null | Uint8Array;

// --- Utility functions ---

export function r(row: unknown): Record<string, unknown> {
  return row as Record<string, unknown>;
}

export function str(v: unknown): string {
  return String(v);
}

export function strOrNull(v: unknown): string | null {
  return v == null ? null : String(v);
}

export function num(v: unknown): number {
  return Number(v);
}

export function bool(v: unknown): boolean {
  return v === 1 || v === true;
}

/** Convert a JS value to a SQLite-safe value (booleans→0/1, objects/arrays→JSON). */
export function toSqlValue(value: unknown): SQLValue {
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === 'object' && value !== null) return JSON.stringify(value);
  return (value ?? null) as SQLValue;
}

/**
 * Safe JSON parse for mapper fields. Returns fallback on null/invalid, but
 * now logs when it catches — previously silent (audit D-12). Callers can
 * pass `ctx` (e.g. `"memories.tags_json"`) to attribute the bad row; if
 * omitted we still log the error + value preview so corrupt columns are
 * at least visible in daemon.stderr.log instead of invisibly returning
 * empty arrays forever.
 */
export function jsonParse<T>(v: unknown, fallback: T, ctx?: string): T {
  if (v == null) return fallback;
  try {
    return JSON.parse(String(v)) as T;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const preview = String(v).slice(0, 80).replace(/\s+/g, ' ');
    console.error(`[mappers] jsonParse fallback${ctx ? ` at ${ctx}` : ''}: ${msg} — value='${preview}'`);
    return fallback;
  }
}

export function toSnake(camelCase: string): string {
  return camelCase.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

// --- Mapper functions ---

export function mapRepo(row: unknown): RepoRecord {
  const d = r(row);
  return {
    id: str(d.id),
    name: str(d.name),
    path: str(d.path),
    remoteUrl: strOrNull(d.remote_url),
    defaultBranch: str(d.default_branch),
    languageHint: strOrNull(d.language_hint),
    testCommand: strOrNull(d.test_command),
    lintCommand: strOrNull(d.lint_command),
    buildCommand: strOrNull(d.build_command),
    lastObservedAt: strOrNull(d.last_observed_at),
    lastFetchedAt: strOrNull(d.last_fetched_at),
    lastRemoteHead: strOrNull(d.last_remote_head),
    contextMd: strOrNull(d.context_md),
    contextUpdatedAt: strOrNull(d.context_updated_at),
    createdAt: str(d.created_at),
    updatedAt: str(d.updated_at),
  };
}

export function mapSystem(row: unknown): SystemRecord {
  const d = r(row);
  return {
    id: str(d.id),
    name: str(d.name),
    kind: str(d.kind),
    url: strOrNull(d.url),
    description: strOrNull(d.description),
    accessMethod: strOrNull(d.access_method),
    config: jsonParse(d.config_json, {}),
    healthCheck: strOrNull(d.health_check),
    logsLocation: strOrNull(d.logs_location),
    deployMethod: strOrNull(d.deploy_method),
    debugGuide: strOrNull(d.debug_guide),
    relatedRepos: jsonParse(d.related_repos_json, []),
    lastCheckedAt: strOrNull(d.last_checked_at),
    createdAt: str(d.created_at),
    updatedAt: str(d.updated_at),
  };
}

export function mapProject(row: unknown): ProjectRecord {
  const d = r(row);
  return {
    id: str(d.id),
    name: str(d.name),
    description: strOrNull(d.description),
    kind: str(d.kind),
    status: str(d.status),
    repoIds: jsonParse(d.repo_ids_json, []),
    systemIds: jsonParse(d.system_ids_json, []),
    contactIds: jsonParse(d.contact_ids_json, []),
    startDate: strOrNull(d.start_date),
    endDate: strOrNull(d.end_date),
    notesMd: strOrNull(d.notes_md),
    contextMd: strOrNull(d.context_md),
    contextUpdatedAt: strOrNull(d.context_updated_at),
    createdAt: str(d.created_at),
    updatedAt: str(d.updated_at),
  };
}

export function mapContact(row: unknown): ContactRecord {
  const d = r(row);
  return {
    id: str(d.id),
    name: str(d.name),
    role: strOrNull(d.role),
    team: strOrNull(d.team),
    email: strOrNull(d.email),
    slackId: strOrNull(d.slack_id),
    githubHandle: strOrNull(d.github_handle),
    notesMd: strOrNull(d.notes_md),
    preferredChannel: strOrNull(d.preferred_channel),
    lastMentionedAt: strOrNull(d.last_mentioned_at),
    createdAt: str(d.created_at),
    updatedAt: str(d.updated_at),
  };
}

export function mapProfile(row: unknown): UserProfileRecord {
  const d = r(row);
  return {
    id: str(d.id),
    displayName: strOrNull(d.display_name),
    timezone: strOrNull(d.timezone),
    locale: str(d.locale),
    workHours: jsonParse(d.work_hours_json, {}),
    commitPatterns: jsonParse(d.commit_patterns_json, {}),
    verbosity: str(d.verbosity),
    proactiveLevel: str(d.proactive_level),
    proactivityLevel: num(d.proactivity_level),
    focusMode: strOrNull(d.focus_mode),
    focusUntil: strOrNull(d.focus_until),
    energyLevel: strOrNull(d.energy_level),
    moodHint: strOrNull(d.mood_hint),
    moodPhrase: strOrNull(d.mood_phrase),
    // Bond system (v49)
    bondAxes: jsonParse<BondAxes>(d.bond_axes_json, { time: 0, depth: 0, momentum: 0, alignment: 0, autonomy: 0 }),
    bondTier: num(d.bond_tier),
    bondResetAt: str(d.bond_reset_at),
    bondTierLastRiseAt: strOrNull(d.bond_tier_last_rise_at),
    totalInteractions: num(d.total_interactions),
    preferences: jsonParse(d.preferences_json, {}),
    dislikes: jsonParse(d.dislikes_json, []),
    createdAt: str(d.created_at),
    updatedAt: str(d.updated_at),
  };
}

export function mapChronicleEntry(row: unknown): ChronicleEntryRecord {
  const d = r(row);
  return {
    id: str(d.id),
    kind: str(d.kind) as 'tier_lore' | 'milestone',
    tier: d.tier == null ? null : num(d.tier),
    milestoneKey: strOrNull(d.milestone_key),
    title: str(d.title),
    bodyMd: str(d.body_md),
    model: str(d.model),
    createdAt: str(d.created_at),
  };
}

export function mapUnlockable(row: unknown): UnlockableRecord {
  const d = r(row);
  return {
    id: str(d.id),
    tierRequired: num(d.tier_required),
    kind: str(d.kind),
    title: str(d.title),
    description: strOrNull(d.description),
    payload: jsonParse(d.payload_json, {}),
    unlocked: num(d.unlocked) === 1,
    unlockedAt: strOrNull(d.unlocked_at),
    createdAt: str(d.created_at),
  };
}

export function mapBondDailyCache(row: unknown): BondDailyCacheRecord {
  const d = r(row);
  return {
    cacheKey: str(d.cache_key),
    bodyMd: str(d.body_md),
    model: str(d.model),
    generatedAt: str(d.generated_at),
    expiresAt: str(d.expires_at),
  };
}

export function mapMemory(row: unknown): MemoryRecord {
  const d = r(row);
  return {
    id: str(d.id),
    repoId: strOrNull(d.repo_id),
    contactId: strOrNull(d.contact_id),
    systemId: strOrNull(d.system_id),
    entities: jsonParse(d.entities_json, []),
    layer: str(d.layer),
    scope: str(d.scope),
    kind: str(d.kind),
    title: str(d.title),
    bodyMd: str(d.body_md),
    tags: jsonParse(d.tags_json, []),
    sourceType: str(d.source_type),
    sourceId: strOrNull(d.source_id),
    confidenceScore: num(d.confidence_score),
    relevanceScore: num(d.relevance_score),
    accessCount: num(d.access_count),
    lastAccessedAt: strOrNull(d.last_accessed_at),
    promotedFrom: strOrNull(d.promoted_from),
    demotedTo: strOrNull(d.demoted_to),
    memoryType: (strOrNull(d.memory_type) ?? 'unclassified') as MemoryRecord['memoryType'],
    validFrom: strOrNull(d.valid_from),
    validUntil: strOrNull(d.valid_until),
    sourceMemoryIds: jsonParse(d.source_memory_ids_json, []),
    expiresAt: strOrNull(d.expires_at),
    createdAt: str(d.created_at),
    updatedAt: str(d.updated_at),
    archivedAt: strOrNull(d.archived_at),
    enforcedAt: d.enforced_at == null ? null : num(d.enforced_at),
  };
}

export function mapObservation(row: unknown): ObservationRecord {
  const d = r(row);
  return {
    id: str(d.id),
    repoId: str(d.repo_id),
    repoIds: jsonParse(d.repo_ids_json, []),
    entities: jsonParse(d.entities_json, []),
    sourceKind: str(d.source_kind ?? 'repo'),
    sourceId: strOrNull(d.source_id),
    kind: str(d.kind),
    severity: str(d.severity),
    title: str(d.title),
    detail: jsonParse(d.detail_json, {}),
    context: jsonParse(d.context_json, {}),
    votes: num(d.votes ?? 1),
    status: str(d.status ?? 'open'),
    firstSeenAt: str(d.first_seen_at ?? d.created_at),
    lastSeenAt: str(d.last_seen_at ?? d.created_at),
    processed: bool(d.processed),
    suggestionId: strOrNull(d.suggestion_id),
    lastNotifiedAt: strOrNull(d.last_notified_at),
    createdAt: str(d.created_at),
  };
}

export function mergeContext(
  old: Record<string, unknown>,
  fresh: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...old, ...fresh };
  if (Array.isArray(old.files) && Array.isArray(fresh.files)) {
    merged.files = [...new Set([...(old.files as string[]), ...(fresh.files as string[])])];
  }
  const sessions = new Set<string>();
  if (old.sessionId) sessions.add(String(old.sessionId));
  if (Array.isArray(old.sessionIds)) (old.sessionIds as string[]).forEach((s) => sessions.add(s));
  if (fresh.sessionId) sessions.add(String(fresh.sessionId));
  if (Array.isArray(fresh.sessionIds)) (fresh.sessionIds as string[]).forEach((s) => sessions.add(s));
  if (sessions.size > 0) {
    merged.sessionIds = [...sessions];
    delete merged.sessionId;
  }
  return merged;
}

export function mapSuggestion(row: unknown): SuggestionRecord {
  const d = r(row);
  return {
    id: str(d.id),
    repoId: strOrNull(d.repo_id),
    repoIds: jsonParse(d.repo_ids_json, []),
    entities: jsonParse(d.entities_json, []),
    sourceObservationId: strOrNull(d.source_observation_id),
    kind: str(d.kind),
    title: str(d.title),
    summaryMd: str(d.summary_md),
    reasoningMd: strOrNull(d.reasoning_md),
    impactScore: num(d.impact_score),
    confidenceScore: num(d.confidence_score),
    riskScore: num(d.risk_score),
    requiredTrustLevel: num(d.required_trust_level),
    status: str(d.status),
    feedbackNote: strOrNull(d.feedback_note),
    shownAt: strOrNull(d.shown_at),
    resolvedAt: strOrNull(d.resolved_at),
    revalidationCount: num(d.revalidation_count),
    lastRevalidatedAt: strOrNull(d.last_revalidated_at),
    revalidationVerdict: strOrNull(d.revalidation_verdict),
    revalidationNote: strOrNull(d.revalidation_note),
    effort: str(d.effort ?? 'medium'),
    createdAt: str(d.created_at),
    expiresAt: strOrNull(d.expires_at),
  };
}

export function mapInteraction(row: unknown): InteractionRecord {
  const d = r(row);
  return {
    id: str(d.id),
    interface: str(d.interface),
    kind: str(d.kind),
    inputSummary: strOrNull(d.input_summary),
    outputSummary: strOrNull(d.output_summary),
    sentiment: strOrNull(d.sentiment),
    topics: jsonParse(d.topics_json, []),
    trustDelta: num(d.trust_delta),
    createdAt: str(d.created_at),
  };
}

export function mapEvent(row: unknown): EventRecord {
  const d = r(row);
  return {
    id: str(d.id),
    kind: str(d.kind),
    priority: num(d.priority),
    payload: jsonParse(d.payload_json, {}),
    delivered: bool(d.delivered),
    deliveredAt: strOrNull(d.delivered_at),
    readAt: strOrNull(d.read_at),
    createdAt: str(d.created_at),
  };
}

export function mapRun(row: unknown): RunRecord {
  const d = r(row);
  return {
    id: str(d.id),
    repoId: str(d.repo_id),
    repoIds: jsonParse(d.repo_ids_json, []),
    suggestionId: strOrNull(d.suggestion_id),
    taskId: strOrNull(d.task_id),
    parentRunId: strOrNull(d.parent_run_id),
    kind: str(d.kind),
    status: str(d.status),
    outcome: strOrNull(d.outcome),
    prompt: str(d.prompt),
    resultSummaryMd: strOrNull(d.result_summary_md),
    errorSummary: strOrNull(d.error_summary),
    artifactDir: strOrNull(d.artifact_dir),
    sessionId: strOrNull(d.session_id),
    worktreePath: strOrNull(d.worktree_path),
    confidence: strOrNull(d.confidence),
    doubts: jsonParse(d.doubts_json, []),
    prUrl: strOrNull(d.pr_url),
    snapshotRef: strOrNull(d.snapshot_ref),
    resultRef: strOrNull(d.result_ref),
    diffStat: strOrNull(d.diff_stat),
    verification: jsonParse(d.verification_json, {}),
    verified: strOrNull(d.verified) as RunRecord['verified'],
    activity: strOrNull(d.activity),
    closedNote: strOrNull(d.closed_note),
    autoEvalAt: strOrNull(d.auto_eval_at),
    archived: bool(d.archived),
    startedAt: strOrNull(d.started_at),
    finishedAt: strOrNull(d.finished_at),
    createdAt: str(d.created_at),
  };
}

export function mapRelation(row: unknown): EntityRelationRecord {
  const d = r(row);
  return {
    id: str(d.id),
    sourceType: str(d.source_type),
    sourceId: str(d.source_id),
    relation: str(d.relation),
    targetType: str(d.target_type),
    targetId: str(d.target_id),
    confidence: Number(d.confidence),
    sourceOrigin: str(d.source_origin),
    metadata: jsonParse(d.metadata_json, {}),
    createdAt: str(d.created_at),
    updatedAt: str(d.updated_at),
  };
}

export function mapAuditEvent(row: unknown): AuditEventRecord {
  const d = r(row);
  return {
    id: str(d.id),
    actor: str(d.actor),
    interface: str(d.interface),
    action: str(d.action),
    targetKind: strOrNull(d.target_kind),
    targetId: strOrNull(d.target_id),
    detail: jsonParse(d.detail_json, {}),
    createdAt: str(d.created_at),
  };
}

export function mapJob(row: unknown): JobRecord {
  const d = r(row);
  return {
    id: str(d.id),
    type: str(d.type),
    phase: str(d.phase),
    phases: jsonParse(d.phases_json, []),
    activity: strOrNull(d.activity),
    status: str(d.status),
    priority: num(d.priority ?? 5),
    triggerSource: str(d.trigger_source ?? 'schedule'),
    llmCalls: num(d.llm_calls ?? 0),
    tokensUsed: num(d.tokens_used ?? 0),
    result: jsonParse(d.result_json, {}),
    durationMs: d.duration_ms != null ? num(d.duration_ms) : null,
    startedAt: str(d.started_at),
    finishedAt: strOrNull(d.finished_at),
    createdAt: str(d.created_at),
  };
}

export function mapDigest(row: unknown): DigestRecord {
  const d = r(row);
  return {
    id: str(d.id),
    kind: str(d.kind),
    periodStart: str(d.period_start),
    periodEnd: str(d.period_end),
    contentMd: str(d.content_md),
    model: str(d.model),
    tokensUsed: num(d.tokens_used),
    createdAt: str(d.created_at),
    updatedAt: str(d.updated_at),
  };
}

export function mapFeedback(row: unknown): FeedbackRecord {
  const d = r(row);
  return {
    id: str(d.id),
    targetKind: str(d.target_kind),
    targetId: str(d.target_id),
    action: str(d.action),
    note: strOrNull(d.note),
    category: strOrNull(d.category),
    createdAt: str(d.created_at),
  };
}

export function mapLlmUsage(row: unknown): LlmUsageRecord {
  const d = r(row);
  return {
    id: str(d.id),
    source: str(d.source),
    sourceId: strOrNull(d.source_id),
    model: str(d.model),
    inputTokens: num(d.input_tokens),
    outputTokens: num(d.output_tokens),
    createdAt: str(d.created_at),
  };
}

export function mapEnrichment(row: unknown): EnrichmentCacheRecord {
  const d = r(row);
  return {
    id: str(d.id),
    source: str(d.source),
    entityType: strOrNull(d.entity_type),
    entityId: strOrNull(d.entity_id),
    entityName: strOrNull(d.entity_name),
    summary: str(d.summary),
    detail: jsonParse(d.detail_json, {}),
    contentHash: str(d.content_hash),
    reported: bool(d.reported),
    stale: bool(d.stale),
    createdAt: str(d.created_at),
    updatedAt: str(d.updated_at),
    expiresAt: strOrNull(d.expires_at),
    ttlCategory: strOrNull(d.ttl_category),
    refreshCount: num(d.refresh_count),
    changeCount: num(d.change_count),
    accessCount: num(d.access_count),
    lastConsumedAt: strOrNull(d.last_consumed_at),
  };
}

export function mapTask(row: unknown): TaskRecord {
  const d = r(row);
  return {
    id: str(d.id),
    title: str(d.title),
    status: str(d.status),
    contextMd: strOrNull(d.context_md),
    externalRefs: jsonParse(d.external_refs_json, []),
    repoIds: jsonParse(d.repo_ids_json, []),
    projectId: strOrNull(d.project_id),
    entities: jsonParse<EntityLink[]>(d.entities_json, []),
    suggestionId: strOrNull(d.suggestion_id),
    sessionId: strOrNull(d.session_id),
    sessionRepoPath: strOrNull(d.session_repo_path),
    prUrls: jsonParse(d.pr_urls_json, []),
    archived: bool(d.archived),
    createdAt: str(d.created_at),
    updatedAt: str(d.updated_at),
    closedAt: strOrNull(d.closed_at),
    closedNote: strOrNull(d.closed_note),
  };
}
