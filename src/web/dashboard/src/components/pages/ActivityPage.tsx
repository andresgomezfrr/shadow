import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApi } from '../../hooks/useApi';
import { useFilterParams } from '../../hooks/useFilterParams';
import { fetchActivity, fetchActivitySummary, fetchStatus } from '../../api/client';
import { formatTokens } from '../../utils/format';
import { MetricCard } from '../common/MetricCard';
import { EmptyState } from '../common/EmptyState';
import { FilterTabs } from '../common/FilterTabs';
import { Pagination } from '../common/Pagination';
import { LiveStatusBar } from '../activity/LiveStatusBar';
import { ScheduleRibbon } from '../activity/ScheduleRibbon';
import { ActivityEntryCard } from '../activity/ActivityEntry';
import { PlayOnceVideo } from '../common/PlayOnceVideo';
import { POLL_FAST, POLL_NORMAL } from '../../constants/polling';

const TYPE_FILTERS = [
  { label: 'All', value: '' },
  { label: 'Active now', value: '_running', dotColor: 'bg-blue', activeClass: 'bg-blue/15 text-blue' },
  { label: 'Heartbeat', value: 'heartbeat', dotColor: 'bg-purple', activeClass: 'bg-purple/15 text-purple' },
  { label: 'Suggest', value: 'suggest', dotColor: 'bg-green', activeClass: 'bg-green/15 text-green' },
  { label: 'Consolidate', value: 'consolidate', dotColor: 'bg-orange', activeClass: 'bg-orange/15 text-orange' },
  { label: 'Reflect', value: 'reflect', dotColor: 'bg-blue', activeClass: 'bg-blue/15 text-blue' },
  { label: 'Sync', value: 'remote-sync', dotColor: 'bg-pink-400', activeClass: 'bg-pink-400/15 text-pink-400' },
  { label: 'Repo profile', value: 'repo-profile', dotColor: 'bg-teal-400', activeClass: 'bg-teal-400/15 text-teal-400' },
  { label: 'Enrich', value: 'context-enrich', dotColor: 'bg-amber-400', activeClass: 'bg-amber-400/15 text-amber-400' },
  { label: 'Deep scan', value: 'suggest-deep', dotColor: 'bg-green-600', activeClass: 'bg-green-600/15 text-green-600' },
  { label: 'Project suggest', value: 'suggest-project', dotColor: 'bg-emerald-400', activeClass: 'bg-emerald-400/15 text-emerald-400' },
  { label: 'Project profile', value: 'project-profile', dotColor: 'bg-emerald-400', activeClass: 'bg-emerald-400/15 text-emerald-400' },
  { label: 'Auto-plan', value: 'auto-plan', dotColor: 'bg-lime-500', activeClass: 'bg-lime-500/15 text-lime-300' },
  { label: 'Auto-execute', value: 'auto-execute', dotColor: 'bg-rose-500', activeClass: 'bg-rose-500/15 text-rose-300' },
  { label: 'Digest', value: '_digest', dotColor: 'bg-cyan', activeClass: 'bg-cyan/15 text-cyan' },
  { label: 'Runs', value: '_runs', dotColor: 'bg-indigo-400', activeClass: 'bg-indigo-400/15 text-indigo-400' },
];

const PERIOD_OPTIONS = [
  { label: 'Today', value: 'today' },
  { label: '7d', value: '7d' },
  { label: '30d', value: '30d' },
  { label: '90d', value: 'all' },
];

const PAGE_SIZE = 30;

function buildFetchParams(params: Record<string, string>) {
  const base: Record<string, string | undefined> = {
    limit: String(PAGE_SIZE),
    offset: params.offset || '0',
    period: params.period !== 'all' ? params.period : undefined,
  };

  const filter = params.type;
  if (filter === '_running') {
    base.status = 'running';
  } else if (filter === '_runs') {
    base.source = 'run';
  } else if (filter === '_digest') {
    base.type = 'digest';
  } else if (filter) {
    base.type = filter;
  }

  return base as Parameters<typeof fetchActivity>[0];
}

export function ActivityPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const highlightId = searchParams.get('highlight');
  const [pulseId, setPulseId] = useState<string | null>(null);
  const scrolledRef = useRef(false);

  useEffect(() => {
    if (!highlightId) return;
    setPulseId(highlightId);
    scrolledRef.current = false;
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('highlight');
      return next;
    }, { replace: true });
    const timer = setTimeout(() => setPulseId(null), 3000);
    return () => clearTimeout(timer);
  }, [highlightId, setSearchParams]);

  const scrollRef = (id: string) => (el: HTMLElement | null) => {
    if (el && id === pulseId && !scrolledRef.current) {
      scrolledRef.current = true;
      setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
    }
  };

  const { params, setParam } = useFilterParams({ type: '', period: 'today', offset: '0' });

  const fetchParams = buildFetchParams(params);
  const { data: rawData, refresh } = useApi(
    () => fetchActivity(fetchParams),
    [params.type, params.period, params.offset],
    POLL_FAST,
  );
  const items = rawData?.items ?? null;
  const total = rawData?.total ?? 0;

  const { data: summary } = useApi(
    () => fetchActivitySummary(params.period),
    [params.period],
    POLL_NORMAL,
  );

  const { data: status } = useApi(fetchStatus, [], POLL_FAST);
  const schedule = (status as Record<string, unknown>)?.jobSchedule as Record<string, { intervalMs?: number; nextAt?: string | null; trigger?: string; schedule?: string; enabled?: boolean }> | undefined;

  const itemsProduced = (summary?.observationsCreated ?? 0)
    + (summary?.memoriesCreated ?? 0)
    + (summary?.suggestionsCreated ?? 0);

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <PlayOnceVideo
          src="/ghost/activity.mp4"
          poster="/ghost/activity.png"
          className="w-[80px] h-[80px] rounded-full object-cover"
        />
        <h1 className="text-xl font-semibold">Activity</h1>
      </div>

      {/* Live status bar */}
      <div className="mb-4">
        <LiveStatusBar />
      </div>

      {/* Summary metrics + schedule */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <MetricCard label="Jobs" value={summary?.jobCount ?? 0}>
          {(summary?.runCount ?? 0) > 0 && (
            <span className="text-xs text-text-muted">{summary!.runCount} runs</span>
          )}
        </MetricCard>
        <MetricCard label="LLM calls" value={summary?.llmCalls ?? 0} />
        <MetricCard label="Tokens" value={formatTokens(summary?.tokensUsed ?? 0)} />
        <MetricCard label="Items produced" value={itemsProduced} accent={itemsProduced > 0}>
          <span className="text-xs text-text-muted">{summary?.observationsCreated ?? 0}o {summary?.memoriesCreated ?? 0}m {summary?.suggestionsCreated ?? 0}s</span>
        </MetricCard>
      </div>

      <div className="mb-4">
        <ScheduleRibbon schedule={schedule} onTrigger={refresh} />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <FilterTabs options={TYPE_FILTERS} active={params.type} onChange={(v) => setParam('type', v)} />
        <div className="ml-auto flex gap-1">
          {PERIOD_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setParam('period', opt.value)}
              className={`px-2.5 py-1 rounded text-xs border-none cursor-pointer transition-colors ${
                params.period === opt.value
                  ? 'bg-accent-soft text-accent'
                  : 'bg-transparent text-text-muted hover:text-text'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Timeline */}
      {!items ? (
        <div className="text-text-dim">Loading...</div>
      ) : items.length === 0 ? (
        <EmptyState
          title="No activity"
          description={params.type === '_running' ? 'Nothing running right now' : 'No matching activity in this period'}
        />
      ) : (
        <div className="flex flex-col gap-1.5">
          {items.map((entry) => (
            <div
              key={entry.id}
              ref={scrollRef(entry.id)}
              className={pulseId === entry.id ? 'rounded-lg ring-2 ring-accent/30 transition-all' : ''}
            >
              <ActivityEntryCard entry={entry} defaultExpanded={entry.id === pulseId} />
            </div>
          ))}
        </div>
      )}

      <Pagination
        total={total}
        offset={Number(params.offset) || 0}
        limit={PAGE_SIZE}
        onChange={(o) => setParam('offset', String(o))}
      />
    </div>
  );
}
