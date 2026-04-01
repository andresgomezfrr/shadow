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
    }, intervalMs);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, refresh };
}
