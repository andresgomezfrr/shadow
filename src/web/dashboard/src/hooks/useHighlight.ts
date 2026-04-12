import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Reads `?highlight=<id>` from URL, auto-expands that item,
 * scrolls to it, and provides a pulse class for visual feedback.
 * Exposes `highlightId` (captured, persists after URL clear) so pages
 * can prefetch the item if it's not in the visible list.
 */
export function useHighlight(expanded: Set<string>, setExpanded: (fn: (s: Set<string>) => Set<string>) => void) {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlHighlight = searchParams.get('highlight');
  const [capturedId, setCapturedId] = useState<string | null>(null);
  const [pulseId, setPulseId] = useState<string | null>(null);
  const scrolledRef = useRef(false);

  useEffect(() => {
    if (!urlHighlight) return;
    setCapturedId(urlHighlight);
    setExpanded((s) => new Set(s).add(urlHighlight));
    setPulseId(urlHighlight);
    scrolledRef.current = false;
    // Clear the param from URL after reading
    const next = new URLSearchParams(searchParams);
    next.delete('highlight');
    setSearchParams(next, { replace: true });
    // Clear pulse after animation
    const timer = setTimeout(() => setPulseId(null), 3000);
    return () => clearTimeout(timer);
  }, [urlHighlight]);

  const scrollRef = (id: string) => (el: HTMLElement | null) => {
    if (el && id === capturedId && !scrolledRef.current) {
      scrolledRef.current = true;
      setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
    }
  };

  return { pulseId, scrollRef, highlightId: capturedId };
}
