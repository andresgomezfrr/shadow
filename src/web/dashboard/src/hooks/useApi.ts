import { useState, useEffect, useCallback, useRef } from 'react';

export function useApi<T>(
  fetcher: () => Promise<T | null>,
  deps: unknown[] = [],
  intervalMs = 30_000,
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

  useEffect(() => {
    let mounted = true;
    let timer: ReturnType<typeof setInterval> | null = null;
    const load = async () => {
      const result = await fetcherRef.current();
      if (mounted) {
        setData(result);
        setLoading(false);
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

  return { data, loading, refresh };
}
