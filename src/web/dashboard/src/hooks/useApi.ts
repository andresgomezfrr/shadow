import { useState, useEffect, useCallback, useRef } from 'react';

export function useApi<T>(
  fetcher: () => Promise<T | null>,
  deps: unknown[] = [],
  intervalMs = 30_000,
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const refresh = useCallback(async () => {
    try {
      const result = await fetcherRef.current();
      setData(result);
      setError(result === null ? 'Request failed' : null);
      setLoading(false);
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
      setLoading(false);
      return null;
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    let timer: ReturnType<typeof setInterval> | null = null;
    const load = async () => {
      try {
        const result = await fetcherRef.current();
        if (mounted) {
          setData(result);
          setError(result === null ? 'Request failed' : null);
          setLoading(false);
        }
      } catch (e) {
        if (mounted) {
          setError(e instanceof Error ? e.message : 'Unknown error');
          setLoading(false);
        }
      }
    };
    const startPolling = () => {
      if (timer) clearInterval(timer);
      timer = setInterval(() => { if (mounted) load(); }, intervalMs);
    };
    const onVisibility = () => {
      if (document.hidden) {
        if (timer) { clearInterval(timer); timer = null; }
      } else {
        load();
        startPolling();
      }
    };
    load();
    startPolling();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      mounted = false;
      if (timer) clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error, refresh };
}
