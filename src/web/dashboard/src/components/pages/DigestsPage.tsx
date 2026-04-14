import { useState, useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fetchDigests, fetchDigestStatus, triggerDigest } from '../../api/client';
import type { DigestKindStatus } from '../../api/client';
import type { Digest } from '../../api/types';
import { EmptyState } from '../common/EmptyState';
import { Markdown } from '../common/Markdown';
import { FilterTabs } from '../common/FilterTabs';
import { formatTokens } from '../../utils/format';

type DigestKind = 'daily' | 'weekly' | 'brag';

const KIND_FILTERS = [
  { label: 'Daily', value: 'daily' },
  { label: 'Weekly', value: 'weekly' },
  { label: 'Brag Doc', value: 'brag' },
];

const KIND_LABELS: Record<string, string> = {
  daily: 'Standup',
  weekly: '1:1',
  brag: 'Brag Doc',
};

const BUSY_STATUSES = new Set(['running', 'queued']);

function statusIsBusy(st?: DigestKindStatus): boolean {
  return !!st && BUSY_STATUSES.has(st.status);
}

function formatPeriodDate(kind: string, periodStart: string, periodEnd?: string): string {
  if (kind === 'brag') {
    const year = periodStart.slice(0, 4);
    const month = parseInt(periodStart.slice(5, 7));
    const quarter = Math.ceil(month / 3);
    return `Q${quarter} ${year}`;
  }
  const start = new Date(periodStart);
  if (kind === 'weekly' && periodEnd) {
    const end = new Date(periodEnd);
    return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} \u2014 ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  }
  return start.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function formatFooterDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function DigestsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialKind = (searchParams.get('kind') as DigestKind | null) ?? 'daily';
  const initialPeriodRef = useRef<string | null>(searchParams.get('periodStart'));
  const [kind, setKind] = useState<DigestKind>(initialKind);
  const [currentDigest, setCurrentDigest] = useState<Digest | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasPrev, setHasPrev] = useState(false);
  const [hasNext, setHasNext] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [generating, setGenerating] = useState(false);

  // Track latest digest id per kind to know when "Next" should be disabled
  const latestIdRef = useRef<string | null>(null);

  // Digest status polling
  const statusRef = useRef<Record<string, DigestKindStatus> | null>(null);
  const statusTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const pollStatus = useCallback(() => {
    if (statusTimerRef.current) return; // already polling
    statusTimerRef.current = setInterval(async () => {
      const st = await fetchDigestStatus();
      if (st) statusRef.current = st;
    }, 5_000);
  }, []);

  const stopPolling = useCallback(() => {
    if (statusTimerRef.current) {
      clearInterval(statusTimerRef.current);
      statusTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  // Fetch the latest digest for this kind (used on mount and kind change)
  const fetchLatest = useCallback(async (k: DigestKind) => {
    setLoading(true);
    const result = await fetchDigests({ kind: k, limit: 1 });
    if (result && result.length > 0) {
      const digest = result[0];
      setCurrentDigest(digest);
      latestIdRef.current = digest.id;
      // Check if there's an older one
      const older = await fetchDigests({ kind: k, limit: 1, before: digest.periodStart });
      setHasPrev(!!(older && older.length > 0));
      setHasNext(false); // already at latest
    } else {
      setCurrentDigest(null);
      latestIdRef.current = null;
      setHasPrev(false);
      setHasNext(false);
    }
    setLoading(false);
  }, []);

  // Fetch a specific digest by periodStart (deep-link from Activity)
  const fetchByPeriod = useCallback(async (k: DigestKind, periodStart: string) => {
    setLoading(true);
    const result = await fetchDigests({ kind: k, limit: 1, periodStart });
    if (result && result.length > 0) {
      const digest = result[0];
      setCurrentDigest(digest);
      latestIdRef.current = digest.id;
      const [older, newer] = await Promise.all([
        fetchDigests({ kind: k, limit: 1, before: digest.periodStart }),
        fetchDigests({ kind: k, limit: 1, after: digest.periodStart }),
      ]);
      setHasPrev(!!(older && older.length > 0));
      setHasNext(!!(newer && newer.length > 0));
      setLoading(false);
      return true;
    }
    setLoading(false);
    return false;
  }, []);

  // On kind change, fetch: consume initial periodStart once, else latest
  useEffect(() => {
    const initial = initialPeriodRef.current;
    if (initial) {
      initialPeriodRef.current = null;
      fetchByPeriod(kind, initial).then((ok) => { if (!ok) fetchLatest(kind); });
    } else {
      fetchLatest(kind);
    }
  }, [kind, fetchLatest, fetchByPeriod]);

  const navigatePrev = useCallback(async () => {
    if (!currentDigest) return;
    setLoading(true);
    const result = await fetchDigests({ kind, limit: 1, before: currentDigest.periodStart });
    if (result && result.length > 0) {
      const digest = result[0];
      setCurrentDigest(digest);
      setSearchParams({ kind, periodStart: digest.periodStart }, { replace: true });
      setHasNext(true); // we came from a newer one
      // Check if there's an even older one
      const older = await fetchDigests({ kind, limit: 1, before: digest.periodStart });
      setHasPrev(!!(older && older.length > 0));
    }
    setLoading(false);
  }, [currentDigest, kind, setSearchParams]);

  const navigateNext = useCallback(async () => {
    if (!currentDigest) return;
    setLoading(true);
    // after returns ASC, so first result is the immediately-next one
    const result = await fetchDigests({ kind, limit: 1, after: currentDigest.periodStart });
    if (result && result.length > 0) {
      const digest = result[0];
      setCurrentDigest(digest);
      setSearchParams({ kind, periodStart: digest.periodStart }, { replace: true });
      setHasPrev(true); // we came from an older one
      // Check if there's a newer one
      const newer = await fetchDigests({ kind, limit: 1, after: digest.periodStart });
      setHasNext(!!(newer && newer.length > 0));
    }
    setLoading(false);
  }, [currentDigest, kind, setSearchParams]);

  const handleKindChange = useCallback((next: DigestKind) => {
    setKind(next);
    setSearchParams({ kind: next }, { replace: true });
  }, [setSearchParams]);

  // Generate new digest for current period
  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    try {
      await triggerDigest(kind);
      // Poll status until done, then refetch
      pollStatus();
      const waitForCompletion = () => new Promise<void>((resolve) => {
        const check = setInterval(async () => {
          const st = await fetchDigestStatus();
          if (!st || !statusIsBusy(st[kind])) {
            clearInterval(check);
            resolve();
          }
        }, 3_000);
      });
      await waitForCompletion();
      stopPolling();
      await fetchLatest(kind);
    } finally {
      setGenerating(false);
    }
  }, [kind, fetchLatest, pollStatus, stopPolling]);

  // Regenerate the currently viewed digest
  const handleRegenerate = useCallback(async () => {
    if (!currentDigest) return;
    setRegenerating(true);
    try {
      await triggerDigest(kind, currentDigest.periodStart);
      // Poll until done
      const waitForCompletion = () => new Promise<void>((resolve) => {
        const check = setInterval(async () => {
          const st = await fetchDigestStatus();
          if (!st || !statusIsBusy(st[kind])) {
            clearInterval(check);
            resolve();
          }
        }, 3_000);
      });
      await waitForCompletion();
      // Refetch the same period to get updated content (exact lookup)
      const result = await fetchDigests({ kind, limit: 1, periodStart: currentDigest.periodStart });
      if (result && result.length > 0) {
        setCurrentDigest(result[0]);
      } else {
        // Fallback: refetch latest
        await fetchLatest(kind);
      }
    } finally {
      setRegenerating(false);
    }
  }, [currentDigest, kind, fetchLatest]);

  return (
    <div>
      {/* Header row: title + kind tabs + generate button */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <img src="/ghost/digests.png" alt="" className="w-[80px] h-[80px] rounded-full object-cover" />
        <h1 className="text-xl font-semibold">Digests</h1>
        <FilterTabs options={KIND_FILTERS} active={kind} onChange={(v) => handleKindChange(v as DigestKind)} />
        <div className="ml-auto">
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-cyan/15 text-cyan border border-cyan/30 cursor-pointer transition-all hover:bg-cyan/25 disabled:opacity-50 disabled:cursor-wait"
          >
            {generating ? 'Generating...' : 'Generate'}
          </button>
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-border mb-5" />

      {loading ? (
        <div className="text-text-dim py-16 text-center">Loading...</div>
      ) : !currentDigest ? (
        <EmptyState
          title={`No ${KIND_LABELS[kind] ?? kind} digests yet`}
          description="Click Generate above to create the first one"
        />
      ) : (
        <div>
          {/* Navigation: Prev / Date / Next */}
          <div className="flex items-center justify-center gap-6 mb-5">
            <button
              onClick={navigatePrev}
              disabled={!hasPrev || loading}
              className={`text-sm font-medium transition-colors ${
                hasPrev ? 'text-text-muted hover:text-accent cursor-pointer' : 'opacity-30 cursor-not-allowed text-text-muted'
              }`}
            >
              &larr; Prev
            </button>
            <span className="text-base font-medium text-text">
              {formatPeriodDate(kind, currentDigest.periodStart, currentDigest.periodEnd)}
            </span>
            <button
              onClick={navigateNext}
              disabled={!hasNext || loading}
              className={`text-sm font-medium transition-colors ${
                hasNext ? 'text-text-muted hover:text-accent cursor-pointer' : 'opacity-30 cursor-not-allowed text-text-muted'
              }`}
            >
              Next &rarr;
            </button>
          </div>

          {/* Content card */}
          <div className="bg-card border border-border rounded-lg p-6">
            <Markdown>{currentDigest.contentMd}</Markdown>
          </div>

          {/* Regenerate button */}
          <div className="flex justify-end mt-3">
            <button
              onClick={handleRegenerate}
              disabled={regenerating}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-cyan/15 text-cyan border border-cyan/30 cursor-pointer transition-all hover:bg-cyan/25 disabled:opacity-50 disabled:cursor-wait"
            >
              {regenerating ? 'Regenerating...' : 'Regenerate'}
            </button>
          </div>

          {/* Footer metadata */}
          <div className="border-t border-border mt-4 pt-3">
            <div className="text-xs text-text-muted text-center">
              Created: {formatFooterDate(currentDigest.createdAt)}
              {' \u00b7 '}
              Updated: {formatFooterDate(currentDigest.updatedAt)}
              {' \u00b7 '}
              {currentDigest.model}
              {' \u00b7 '}
              {formatTokens(currentDigest.tokensUsed)} tokens
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
