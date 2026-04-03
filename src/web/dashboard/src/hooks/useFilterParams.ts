import { useSearchParams } from 'react-router-dom';
import { useCallback } from 'react';

/**
 * Syncs filter state with URL search params.
 * Reads from URL on mount, updates URL on change.
 * Default values are omitted from the URL to keep it clean.
 */
export function useFilterParams<T extends Record<string, string>>(defaults: T) {
  const [searchParams, setSearchParams] = useSearchParams();

  const params = {} as Record<string, string>;
  for (const [key, def] of Object.entries(defaults)) {
    params[key] = searchParams.get(key) ?? def;
  }

  const setParam = useCallback((key: string, value: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value === (defaults as Record<string, string>)[key]) next.delete(key);
      else next.set(key, value);
      // Reset offset when changing any other filter
      if (key !== 'offset') next.delete('offset');
      return next;
    }, { replace: true });
  }, [setSearchParams, defaults]);

  return { params: params as T, setParam };
}
