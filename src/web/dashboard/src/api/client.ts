import type {
  StatusResponse,
  DailySummary,
  Memory,
  Suggestion,
  Observation,
  Repo,
  Contact,
  Digest,
  Project,
  ProjectDetail,
  System,
  SystemDetail,
  EnrichmentItem,
  UsageSummary,
  Job,
  EventRecord,
  Run,
  UserProfile,
  ActivityEntry,
  ActivitySummary,
  FeedResponse,
  RunContext,
  SuggestionContext,
  ObservationContext,
  TaskContext,
  Task,
  PrStatus,
} from './types';

async function api<T>(path: string, opts?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(path, opts);
    if (!res.ok) throw new Error(res.statusText);
    return (await res.json()) as T;
  } catch (e) {
    console.error('API error:', path, e);
    return null;
  }
}

function qs(params: Record<string, string | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][];
  if (entries.length === 0) return '';
  return '?' + new URLSearchParams(entries).toString();
}

// --- Search types ---

export type SearchItem = {
  id: string;
  title: string;
  subtitle: string;
  route: string;
  score?: number;
};

export type SearchGroupType = 'memory' | 'observation' | 'suggestion' | 'task' | 'run' | 'project' | 'system' | 'repo' | 'contact';

export type SearchGroup = {
  type: SearchGroupType;
  label: string;
  items: SearchItem[];
};

// --- GET ---

export const fetchStatus = () => api<StatusResponse>('/api/status');

export const searchAll = (q: string, limit?: number) =>
  api<{ groups: SearchGroup[] }>(`/api/search${qs({ q, limit: limit != null ? String(limit) : undefined })}`);

export const lookupEntity = <T,>(type: SearchGroupType, id: string) =>
  api<{ item: T }>(`/api/lookup${qs({ type, id })}`);

export const fetchDailySummary = () => api<DailySummary>('/api/daily-summary');

export const fetchMemories = (params?: { q?: string; layer?: string; memoryType?: string; limit?: number; offset?: number }) =>
  api<{ items: Memory[]; total: number }>(`/api/memories${qs({ q: params?.q, layer: params?.layer, memoryType: params?.memoryType, limit: params?.limit != null ? String(params.limit) : undefined, offset: params?.offset != null ? String(params.offset) : undefined })}`);

export const fetchSuggestions = (params?: { status?: string; kind?: string; sort?: string; repoId?: string; projectId?: string; limit?: number; offset?: number }) =>
  api<{ items: Suggestion[]; total: number; feedbackState: Record<string, string>; scores: Record<string, number> }>(`/api/suggestions${qs({ status: params?.status, kind: params?.kind, sort: params?.sort, repoId: params?.repoId, projectId: params?.projectId, limit: params?.limit != null ? String(params.limit) : undefined, offset: params?.offset != null ? String(params.offset) : undefined })}`);

export const fetchObservations = (params?: { limit?: number; offset?: number; status?: string; severity?: string; kind?: string; repoId?: string; projectId?: string }) =>
  api<{ items: Observation[]; total: number; feedbackState: Record<string, string> }>(`/api/observations${qs({ limit: params?.limit != null ? String(params.limit) : undefined, offset: params?.offset != null ? String(params.offset) : undefined, status: params?.status, severity: params?.severity, kind: params?.kind, repoId: params?.repoId, projectId: params?.projectId })}`);

export const fetchRepos = () => api<Repo[]>('/api/repos');

export const fetchContacts = (team?: string) =>
  api<Contact[]>(`/api/contacts${qs({ team })}`);

export const fetchDigests = (params?: { kind?: string; limit?: number; before?: string; after?: string }) =>
  api<Digest[]>(`/api/digests${qs({
    kind: params?.kind,
    limit: params?.limit != null ? String(params.limit) : undefined,
    before: params?.before,
    after: params?.after,
  })}`);

export type DigestKindStatus = { status: string; periodStart?: string };

export const fetchDigestStatus = () =>
  api<Record<string, DigestKindStatus>>('/api/digest/status');

export const triggerDigest = (kind: 'daily' | 'weekly' | 'brag', periodStart?: string) =>
  api<{ triggered: boolean }>(`/api/digest/${kind}/trigger`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(periodStart ? { periodStart } : {}),
  });

export const fetchProjects = (status?: string) =>
  api<Project[]>(`/api/projects${qs({ status })}`);

export const fetchSystems = (kind?: string) =>
  api<System[]>(`/api/systems${qs({ kind })}`);

export const fetchProjectDetail = (id: string) =>
  api<ProjectDetail>(`/api/projects/${id}`);

export const fetchSystemDetail = (id: string) =>
  api<SystemDetail>(`/api/systems/${id}`);

export const fetchSoulHistory = () =>
  api<{ current: { id: string; bodyMd: string; updatedAt: string } | null; snapshots: { id: string; title: string; bodyMd: string; createdAt: string; archivedAt: string }[] }>('/api/soul/history');

export const fetchConfig = () =>
  api<{ config: Record<string, unknown> }>('/api/config');

export const fetchProjectEnrichment = (projectId: string, params?: { limit?: number; offset?: number }) =>
  api<{ items: EnrichmentItem[]; total: number }>(`/api/enrichment${qs({ entityType: 'project', entityId: projectId, limit: params?.limit != null ? String(params.limit) : undefined, offset: params?.offset != null ? String(params.offset) : undefined })}`);

export const fetchEnrichment = (params?: { source?: string; limit?: number; offset?: number }) =>
  api<{ items: EnrichmentItem[]; total: number }>(`/api/enrichment${qs({ source: params?.source, limit: params?.limit != null ? String(params.limit) : undefined, offset: params?.offset != null ? String(params.offset) : undefined })}`);

export const fetchEnrichmentServers = () =>
  api<{ servers: { name: string; enabled: boolean; description: string | null; toolCount: number | null; defaultTtl: string | null; enrichmentHint: string | null }[] }>('/api/enrichment/servers');

export const toggleEnrichmentServer = (name: string, enabled: boolean) =>
  api<{ ok: boolean; name: string; enabled: boolean }>('/api/enrichment/servers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, enabled }),
  });

export const fetchEnrichmentProjects = () =>
  api<{ projects: { id: string; name: string; status: string; enabled: boolean }[]; disabledProjects: string[] }>('/api/enrichment/projects');

export const toggleEnrichmentProject = (name: string, enabled: boolean) =>
  api<{ ok: boolean; name: string; enabled: boolean }>('/api/enrichment/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, enabled }),
  });

export const fetchUsage = (period: 'day' | 'week' | 'month' = 'week') =>
  api<UsageSummary>(`/api/usage?period=${period}`);

export const fetchHeartbeats = () => api<Job[]>('/api/heartbeats');

export const fetchJobs = (params?: { type?: string; typePrefix?: string; limit?: number; offset?: number }) =>
  api<{ items: Job[]; total: number }>(`/api/jobs${qs({ type: params?.type, typePrefix: params?.typePrefix, limit: params?.limit != null ? String(params.limit) : undefined, offset: params?.offset != null ? String(params.offset) : undefined })}`);

export const fetchActivity = (params?: { type?: string; source?: string; status?: string; period?: string; limit?: number; offset?: number }) =>
  api<{ items: ActivityEntry[]; total: number }>(`/api/activity${qs({ type: params?.type, source: params?.source, status: params?.status, period: params?.period, limit: params?.limit != null ? String(params.limit) : undefined, offset: params?.offset != null ? String(params.offset) : undefined })}`);

export const fetchActivitySummary = (period: string = 'today') =>
  api<ActivitySummary>(`/api/activity/summary${qs({ period })}`);

export const fetchEvents = () => api<EventRecord[]>('/api/events');

export const fetchRuns = (params?: { status?: string; repoId?: string; archived?: boolean; limit?: number; offset?: number }) =>
  api<{ items: Run[]; total: number }>(`/api/runs${qs({ status: params?.status, repoId: params?.repoId, archived: params?.archived != null ? String(params.archived) : undefined, limit: params?.limit != null ? String(params.limit) : undefined, offset: params?.offset != null ? String(params.offset) : undefined })}`);

// --- POST ---

export const executeRun = (id: string) =>
  api<{ runId: string; status: string }>(`/api/runs/${id}/execute`, { method: 'POST' });

export const createRunSession = (id: string) =>
  api<{ sessionId: string; command: string }>(`/api/runs/${id}/session`, { method: 'POST' });

export const discardRun = (id: string, note?: string) =>
  api<{ ok: boolean }>(`/api/runs/${id}/discard`, {
    method: 'POST',
    headers: note ? { 'Content-Type': 'application/json' } : undefined,
    body: note ? JSON.stringify({ note }) : undefined,
  });

export const closeRun = (id: string, note?: string) =>
  api<{ ok: boolean }>(`/api/runs/${id}/close`, {
    method: 'POST',
    headers: note ? { 'Content-Type': 'application/json' } : undefined,
    body: note ? JSON.stringify({ note }) : undefined,
  });

export const archiveRun = (id: string) =>
  api<{ ok: boolean }>(`/api/runs/${id}/archive`, { method: 'POST' });

export const retryRun = (id: string) =>
  api<{ ok: boolean; newRunId: string }>(`/api/runs/${id}/retry`, { method: 'POST' });

export const rollbackRun = (id: string) =>
  api<{ ok: boolean }>(`/api/runs/${id}/rollback`, { method: 'POST' });

export const verifyRun = (id: string) =>
  api<{ ok: boolean; verified: string }>(`/api/runs/${id}/verify`, { method: 'POST' });

export const fetchEntityGraph = () =>
  api<import('./types').EntityRelation[]>('/api/entity-graph');

export const createDraftPr = (id: string) =>
  api<{ ok: boolean; prUrl: string }>(`/api/runs/${id}/draft-pr`, { method: 'POST' });

export const fetchFeedbackState = (targetKind: string) =>
  api<Record<string, string>>(`/api/feedback-state?targetKind=${targetKind}`);

export const sendFeedback = (targetKind: string, targetId: string, action: string, note?: string) =>
  api<{ ok: boolean }>('/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetKind, targetId, action, note }),
  });

export const acknowledgeObservation = (id: string) =>
  api<Observation>(`/api/observations/${id}/acknowledge`, { method: 'POST' });

export const resolveObservation = (id: string, note?: string) =>
  api<Observation>(`/api/observations/${id}/resolve`, {
    method: 'POST',
    headers: note ? { 'Content-Type': 'application/json' } : undefined,
    body: note ? JSON.stringify({ note }) : undefined,
  });

export const reopenObservation = (id: string) =>
  api<Observation>(`/api/observations/${id}/reopen`, { method: 'POST' });

export const fetchRunningJobs = () =>
  api<{ types: string[] }>('/api/jobs/running');

export const triggerHeartbeat = () =>
  api<{ triggered: boolean }>('/api/heartbeat/trigger', { method: 'POST' });

export const triggerJob = (type: string) =>
  api<{ triggered: boolean }>(`/api/jobs/trigger/${type}`, { method: 'POST' });

export const triggerJobWithParams = (type: string, params?: Record<string, string>) =>
  api<{ triggered: boolean }>(`/api/jobs/trigger/${type}`, {
    method: 'POST',
    headers: params ? { 'Content-Type': 'application/json' } : undefined,
    body: params ? JSON.stringify(params) : undefined,
  });

export const acceptSuggestion = (id: string, category?: string) =>
  api<Suggestion>(`/api/suggestions/${id}/accept`, {
    method: 'POST',
    headers: category ? { 'Content-Type': 'application/json' } : undefined,
    body: category ? JSON.stringify({ category }) : undefined,
  });

export const dismissSuggestion = (id: string, note?: string, category?: string) =>
  api<Suggestion>(`/api/suggestions/${id}/dismiss`, {
    method: 'POST',
    headers: (note || category) ? { 'Content-Type': 'application/json' } : undefined,
    body: (note || category) ? JSON.stringify({ note, category }) : undefined,
  });

export const bulkSuggestionAction = (action: 'accept' | 'dismiss' | 'snooze' | 'update', ids: string[], opts?: { category?: string; note?: string; hours?: number }) =>
  api<{ processed: number; total: number }>('/api/suggestions/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ids, ...opts }),
  });

export const snoozeSuggestion = (id: string, hours: number) =>
  api<Suggestion>(`/api/suggestions/${id}/snooze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hours }),
  });

export const updateProfile = (updates: Partial<UserProfile>) =>
  api<UserProfile>('/api/profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });

export const setFocusMode = (mode: 'focus' | 'available', duration?: string) =>
  api<UserProfile>('/api/focus', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, duration }),
  });

export const createCorrection = (params: { title?: string; body: string; scope: string; entityType?: string; entityId?: string }) =>
  api<{ ok: boolean; correction: unknown }>('/api/corrections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

// --- Workspace ---

export const fetchWorkspaceFeed = (params?: { type?: string; projectId?: string; limit?: number; offset?: number }) =>
  api<FeedResponse>(`/api/workspace/feed${qs({ type: params?.type, projectId: params?.projectId, limit: params?.limit != null ? String(params.limit) : undefined, offset: params?.offset != null ? String(params.offset) : undefined })}`);

export const fetchRunContext = (id: string) =>
  api<RunContext>(`/api/runs/${id}/context`);

export const fetchSuggestionContext = (id: string) =>
  api<SuggestionContext>(`/api/suggestions/${id}/context`);

export const fetchObservationContext = (id: string) =>
  api<ObservationContext>(`/api/observations/${id}/context`);

export const fetchPrStatus = (id: string) =>
  api<PrStatus>(`/api/runs/${id}/pr-status`);

export const revalidateSuggestion = (id: string) =>
  api<{ ok: boolean; jobId: string }>(`/api/suggestions/${id}/revalidate`, { method: 'POST' });

/** Check if there are active (queued/running) revalidation jobs for given suggestion IDs */
export async function getActiveRevalidations(suggestionIds?: string[]): Promise<Set<string>> {
  const active = new Set<string>();
  const result = await fetchJobs({ type: 'revalidate-suggestion', limit: 40 });
  const all = result?.items ?? [];
  for (const job of all) {
    if (job.status !== 'queued' && job.status !== 'running') continue;
    const sid = (job.result as Record<string, unknown>)?.suggestionId as string | undefined;
    if (sid && (!suggestionIds || suggestionIds.includes(sid))) active.add(sid);
  }
  return active;
}

export const fetchNotifications = () => api<import('./types').EventRecord[]>('/api/notifications');

export const markNotificationsRead = (ids: string[]) =>
  api<{ ok: boolean; read: number }>('/api/notifications/read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });

export const markAllNotificationsRead = () =>
  api<{ ok: boolean; read: number }>('/api/notifications/read-all', { method: 'POST' });

export const cleanupWorktree = (id: string) =>
  api<{ ok: boolean }>(`/api/runs/${id}/cleanup-worktree`, { method: 'POST' });

// --- Tasks ---

export const fetchTasks = (params?: { status?: string; limit?: number; offset?: number }) => {
  const q = new URLSearchParams();
  if (params?.status) q.set('status', params.status);
  if (params?.limit) q.set('limit', String(params.limit));
  if (params?.offset) q.set('offset', String(params.offset));
  const qs = q.toString();
  return api<{ items: Task[]; total: number }>(`/api/tasks${qs ? `?${qs}` : ''}`);
};

export const fetchTaskContext = (id: string) => api<TaskContext>(`/api/tasks/${id}`);

export const createTask = (input: { title: string; status?: string; contextMd?: string; externalRefs?: { source: string; key: string; url: string }[]; repoIds?: string[]; projectId?: string; sessionId?: string; sessionRepoPath?: string }) =>
  api<Task>('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });

export const updateTask = (id: string, updates: Record<string, unknown>) =>
  api<Task>(`/api/tasks/${id}/update`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates) });

export const closeTask = (id: string) =>
  api<Task>(`/api/tasks/${id}/close`, { method: 'POST' });

export const archiveTask = (id: string) =>
  api<{ ok: boolean }>(`/api/tasks/${id}/archive`, { method: 'POST' });

export const deleteTask = (id: string) =>
  api<{ ok: boolean }>(`/api/tasks/${id}`, { method: 'DELETE' });
