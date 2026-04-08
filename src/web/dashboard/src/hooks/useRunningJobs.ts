import { useState, useCallback, useMemo } from 'react';
import { useApi } from './useApi';
import { useEventStream } from './useEventStream';
import { fetchRunningJobs } from '../api/client';

const SSE_EVENTS = ['job:started', 'job:complete'];

export function useRunningJobs() {
  const { data, refresh } = useApi(fetchRunningJobs, [], 30_000);
  const [sseOverrides, setSseOverrides] = useState<Map<string, 'add' | 'remove'>>(new Map());

  const handleSSE = useCallback((type: string, raw: unknown) => {
    const d = raw as Record<string, unknown> | undefined;
    const jobType = (d?.type ?? d?.jobType) as string | undefined;
    if (!jobType) return;

    if (type === 'job:started') {
      setSseOverrides(prev => { const next = new Map(prev); next.set(jobType, 'add'); return next; });
    } else if (type === 'job:complete') {
      setSseOverrides(prev => { const next = new Map(prev); next.set(jobType, 'remove'); return next; });
      // Refresh from server to get authoritative state
      setTimeout(refresh, 500);
    }
  }, [refresh]);

  useEventStream(SSE_EVENTS, handleSSE);

  // Reset overrides when server data arrives
  const serverTypes = data?.types ?? [];

  const runningTypes = useMemo(() => {
    const set = new Set(serverTypes);
    for (const [jobType, action] of sseOverrides) {
      if (action === 'add') set.add(jobType);
      else set.delete(jobType);
    }
    return set;
  }, [serverTypes, sseOverrides]);

  const isRunning = useCallback((type: string) => runningTypes.has(type), [runningTypes]);

  return { runningTypes, isRunning };
}
