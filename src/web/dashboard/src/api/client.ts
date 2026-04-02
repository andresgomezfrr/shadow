import type {
  StatusResponse,
  DailySummary,
  Memory,
  Suggestion,
  Observation,
  Repo,
  Contact,
  System,
  UsageSummary,
  Heartbeat,
  EventRecord,
  Run,
  UserProfile,
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

// --- GET ---

export const fetchStatus = () => api<StatusResponse>('/api/status');

export const fetchDailySummary = () => api<DailySummary>('/api/daily-summary');

export const fetchMemories = (params?: { q?: string; layer?: string }) =>
  api<Memory[]>(`/api/memories${qs({ q: params?.q, layer: params?.layer })}`);

export const fetchSuggestions = (params?: { status?: string }) =>
  api<Suggestion[]>(`/api/suggestions${qs({ status: params?.status })}`);

export const fetchObservations = (limit = 20, status?: string) =>
  api<Observation[]>(`/api/observations${qs({ limit: String(limit), status })}`);

export const fetchRepos = () => api<Repo[]>('/api/repos');

export const fetchContacts = (team?: string) =>
  api<Contact[]>(`/api/contacts${qs({ team })}`);

export const fetchSystems = (kind?: string) =>
  api<System[]>(`/api/systems${qs({ kind })}`);

export const fetchUsage = (period: 'day' | 'week' | 'month' = 'week') =>
  api<UsageSummary>(`/api/usage?period=${period}`);

export const fetchHeartbeats = () => api<Heartbeat[]>('/api/heartbeats');

export const fetchEvents = () => api<EventRecord[]>('/api/events');

export const fetchRuns = (params?: { status?: string; repoId?: string }) =>
  api<Run[]>(`/api/runs${qs({ status: params?.status, repoId: params?.repoId })}`);

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

export const markRunExecutedManual = (id: string) =>
  api<{ ok: boolean }>(`/api/runs/${id}/executed-manual`, { method: 'POST' });

export const archiveRun = (id: string) =>
  api<{ ok: boolean }>(`/api/runs/${id}/archive`, { method: 'POST' });

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

export const triggerHeartbeat = () =>
  api<{ triggered: boolean }>('/api/heartbeat/trigger', { method: 'POST' });

export const acceptSuggestion = (id: string) =>
  api<Suggestion>(`/api/suggestions/${id}/accept`, { method: 'POST' });

export const dismissSuggestion = (id: string, note?: string) =>
  api<Suggestion>(`/api/suggestions/${id}/dismiss`, {
    method: 'POST',
    headers: note ? { 'Content-Type': 'application/json' } : undefined,
    body: note ? JSON.stringify({ note }) : undefined,
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
