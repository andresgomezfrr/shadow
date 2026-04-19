import { useState, useEffect, useCallback, useRef } from 'react';
import { useEventStream } from './useEventStream';

/**
 * Enhanced version of useApi that also subscribes to SSE events for push-based refresh.
 * Falls back to polling at the same cadence as useApi (30s) so a stale SSE
 * connection doesn't leave the UI two minutes out of date — see audit UI-08.
 * Callers that legitimately want longer polling can override pollingIntervalMs.
 */
export function useSSERefresh<T>(
  fetcher: () => Promise<T | null>,
  deps: unknown[] = [],
  eventTypes: string[] = [],
  pollingIntervalMs = 30_000,
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
