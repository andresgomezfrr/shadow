import { useEffect, useMemo, useState } from 'react';
import { lookupEntity, type SearchGroupType } from '../api/client';

/**
 * Shared prefetch+merge logic for pages that deep-link via `?highlight=<id>`:
 * when the highlighted item isn't in the current paginated list, fetch it
 * via `lookupEntity` and prepend to the rendered list so the user sees the
 * item they asked for without waiting for filter/offset gymnastics.
 *
 * Previously duplicated in SuggestionsPage, RunsPage, ObservationsPage with
 * copy-paste drift (audit UI-03).
 *
 * `persistCapture: true` captures the highlightId on first render and keeps
 * it past URL clears — SuggestionsPage relies on this because it deletes
 * the ?highlight param as soon as it pulses the row.
 */
export function usePrefetchHighlight<T extends { id: string }>(
  entityType: SearchGroupType,
  highlightId: string | null,
  rawItems: T[] | null,
  opts?: { persistCapture?: boolean },
): { items: T[] | null; prefetched: T | null; capturedHighlight: string | null } {
  const [prefetched, setPrefetched] = useState<T | null>(null);
  const [capturedHighlight, setCapturedHighlight] = useState<string | null>(null);
  const persistCapture = opts?.persistCapture ?? false;

  useEffect(() => {
    if (persistCapture && highlightId) setCapturedHighlight(highlightId);
  }, [highlightId, persistCapture]);

  const effectiveHighlight = persistCapture ? capturedHighlight : highlightId;

  useEffect(() => {
    if (!effectiveHighlight || !rawItems) return;
    if (rawItems.some((x) => x.id === effectiveHighlight)) { setPrefetched(null); return; }
    if (prefetched?.id === effectiveHighlight) return;
    (async () => {
      const resp = await lookupEntity<T>(entityType, effectiveHighlight);
      if (resp?.item) setPrefetched(resp.item);
    })();
  }, [effectiveHighlight, rawItems, entityType, prefetched?.id]);

  const items = useMemo(() => {
    if (!rawItems) return null;
    if (!prefetched || rawItems.some((x) => x.id === prefetched.id)) return rawItems;
    return [prefetched, ...rawItems];
  }, [rawItems, prefetched]);

  return { items, prefetched, capturedHighlight: effectiveHighlight };
}
