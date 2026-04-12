import { useCallback, useEffect, useState } from 'react';
import type { SearchGroupType } from '../api/client';

const STORAGE_KEY = 'shadow:cmd-k-recents';
const MAX_RECENTS = 10;

export type RecentItem = {
  type: SearchGroupType;
  id: string;
  title: string;
  subtitle: string;
  route: string;
  timestamp: number;
};

function readStorage(): RecentItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is RecentItem =>
      x && typeof x === 'object'
      && typeof x.type === 'string' && typeof x.id === 'string'
      && typeof x.title === 'string' && typeof x.route === 'string'
      && typeof x.timestamp === 'number',
    );
  } catch {
    return [];
  }
}

function writeStorage(items: RecentItem[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // quota exceeded or disabled — fail silently
  }
}

export function useRecents() {
  const [recents, setRecents] = useState<RecentItem[]>(() => readStorage());

  const addRecent = useCallback((item: Omit<RecentItem, 'timestamp'>) => {
    setRecents(prev => {
      const filtered = prev.filter(r => !(r.type === item.type && r.id === item.id));
      const next = [{ ...item, timestamp: Date.now() }, ...filtered].slice(0, MAX_RECENTS);
      writeStorage(next);
      return next;
    });
  }, []);

  const clearRecents = useCallback(() => {
    writeStorage([]);
    setRecents([]);
  }, []);

  // Sync across tabs
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setRecents(readStorage());
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  return { recents, addRecent, clearRecents };
}
