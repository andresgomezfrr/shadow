import { useState, useEffect, useCallback, useRef } from 'react';
import { useEventStream } from './useEventStream';

/**
 * Enhanced version of useApi that also subscribes to SSE events for push-based refresh.
 * Falls back to polling at a longer interval (120s default vs 30s in useApi).
 */
export function useSSERefresh<T>(
  fetcher: () => Promise<T | null>,
  deps: unknown[] = [],
  eventTypes: string[] = [],
  pollingIntervalMs = 120_000,
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const refresh = useCallback(async () => {
    const result = await fetcherRef.current();
    setData(result);
    setLoading(false);
    return result;
  }, []);

  // SSE subscription — refresh on matching events
  const { connected } = useEventStream(eventTypes, () => {
    refresh();
  });

  // Initial load + polling fallback
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const result = await fetcherRef.current();
      if (mounted) {
        setData(result);
        setLoading(false);
      }
    };
    load();
    const timer = setInterval(() => {
      if (mounted) load();
    }, pollingIntervalMs);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, deps);

  return { data, loading, refresh, connected };
}
