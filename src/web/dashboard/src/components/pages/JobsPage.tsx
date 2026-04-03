import { timeAgo, formatTokens, useNow, formatCountdown } from '../../utils/format';
import { useApi } from '../../hooks/useApi';
import { useFilterParams } from '../../hooks/useFilterParams';
import { fetchJobs, fetchStatus, triggerHeartbeat } from '../../api/client';
import { Badge } from '../common/Badge';
import { MetricCard } from '../common/MetricCard';
import { EmptyState } from '../common/EmptyState';
import { FilterTabs } from '../common/FilterTabs';
import { Pagination } from '../common/Pagination';
import { useState, useEffect, useCallback } from 'react';
import type { Job } from '../../api/types';

const PHASE_STYLES: Record<string, string> = {
  wake: 'text-text-dim bg-border',
  observe: 'text-blue bg-blue/15',
  analyze: 'text-purple bg-purple/15',
  suggest: 'text-accent bg-accent-soft',
  consolidate: 'text-orange bg-orange/15',
  notify: 'text-text-dim bg-border',
  idle: 'text-text-muted bg-text-muted/10',
  skip: 'text-text-muted bg-text-muted/10',
};


function isActive(hb: Job): boolean {
  const phases = hb.phases ?? [];
  return phases.some((p) => ['analyze', 'suggest', 'consolidate'].includes(p));
}

function interestingPhases(phases: string[]): string[] {
  const interesting = phases.filter((p) => !['wake', 'idle', 'notify'].includes(p));
  return interesting.length > 0 ? interesting : ['skip'];
}




const TYPE_FILTERS = [
  { label: 'All', value: '' },
  { label: 'Heartbeat', value: 'heartbeat' },
  { label: 'Suggest', value: 'suggest' },
  { label: 'Reflect', value: 'reflect' },
  { label: 'Consolidate', value: 'consolidate' },
];

const TYPE_COLORS: Record<string, string> = {
  heartbeat: 'text-purple bg-purple/15',
  suggest: 'text-green bg-green/15',
  consolidate: 'text-orange bg-orange/15',
  reflect: 'text-blue bg-blue/15',
};

const PAGE_SIZE = 30;

export function JobsPage() {
  const { params, setParam } = useFilterParams({ type: '', offset: '0' });
  const { data: rawData, refresh } = useApi(() => fetchJobs({ type: params.type || undefined, limit: PAGE_SIZE, offset: Number(params.offset) || 0 }), [params.type, params.offset], 15_000);
  const data = rawData?.items ?? null;
  const total = rawData?.total ?? 0;
  const { data: status } = useApi(fetchStatus, [], 15_000);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const now = useNow();
  const schedule = (status as Record<string, unknown>)?.jobSchedule as Record<string, { intervalMs?: number; nextAt?: string | null; trigger?: string }> | undefined;

  const toggle = (id: string) => {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const [triggered, setTriggered] = useState(false);
  const handleTrigger = useCallback(async () => {
    const result = await triggerHeartbeat();
    if (!result) {
      // 409 or error — heartbeat already running/queued
      refresh();
      return;
    }
    setTriggered(true);
    const poll = setInterval(refresh, 3000);
    setTimeout(() => { clearInterval(poll); setTriggered(false); }, 30_000);
  }, [refresh]);

  // Today's summary
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayIso = todayStart.toISOString();
  const todayBeats = data?.filter((hb) => hb.startedAt > todayIso) ?? [];
  const todayActive = todayBeats.filter(isActive);
  const todayLlmCalls = todayBeats.reduce((sum, hb) => sum + hb.llmCalls, 0);
  const todayTokens = todayBeats.reduce((sum, hb) => sum + hb.tokensUsed, 0);
  const todayObs = todayBeats.reduce((sum, hb) => sum + (((hb.result ?? {}) as Record<string, number>).observationsCreated ?? 0), 0);

  const hasRunning = data?.some((hb) => !hb.finishedAt) ?? false;
  const canTrigger = !triggered && !hasRunning;

  return (
    <div>
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <h1 className="text-xl font-semibold">Jobs</h1>
        <FilterTabs options={TYPE_FILTERS} active={params.type} onChange={(v) => setParam('type', v)} />
      </div>

      {/* Job schedule */}
      <div className="bg-card border border-border rounded-lg p-3 mb-4 text-xs space-y-1.5">
        <div className="flex items-center gap-3 flex-wrap">
          <Badge title="Extracts memories and generates observations from your conversations and activity" tooltipBelow className={TYPE_COLORS.heartbeat}>heartbeat</Badge>
          <span className="text-text-muted">every 15m · </span>
          <span className="text-text font-mono">{formatCountdown(schedule?.heartbeat?.nextAt, now)}</span>
          <span className="text-text-muted">→ if activity →</span>
          <Badge title="Generates actionable technical suggestions based on observations" tooltipBelow className={TYPE_COLORS.suggest}>suggest</Badge>
          <button
            onClick={handleTrigger}
            disabled={!canTrigger}
            className="px-2 py-0.5 text-xs rounded bg-accent-soft text-accent border-none cursor-pointer hover:bg-accent/25 transition-colors disabled:opacity-50 ml-auto"
          >
            {hasRunning ? 'Running...' : triggered ? 'Triggered...' : 'Trigger'}
          </button>
        </div>
        <div className="flex items-center gap-3">
          <Badge title="Promotes and demotes memories between layers based on access patterns" tooltipBelow className={TYPE_COLORS.consolidate}>consolidate</Badge>
          <span className="text-text-muted">every 6h</span>
          <span className="text-text-muted">·</span>
          <span className="text-text font-mono">{formatCountdown(schedule?.consolidate?.nextAt, now)}</span>
        </div>
        <div className="flex items-center gap-3">
          <Badge title="Synthesizes all feedback and memories into Shadow's soul — understanding of you" tooltipBelow className={TYPE_COLORS.reflect}>reflect</Badge>
          <span className="text-text-muted">every 24h</span>
          <span className="text-text-muted">·</span>
          <span className="text-text font-mono">{formatCountdown(schedule?.reflect?.nextAt, now)}</span>
        </div>
      </div>

      {data && data.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <MetricCard label="Today" value={todayBeats.length}>
            <div className="text-xs text-text-muted mt-1">{todayActive.length} active</div>
          </MetricCard>
          <MetricCard label="LLM calls" value={todayLlmCalls} />
          <MetricCard label="Tokens" value={formatTokens(todayTokens)} />
          <MetricCard label="Observations" value={todayObs} />
        </div>
      )}

      {!data ? (
        <div className="text-text-dim">Loading...</div>
      ) : data.length === 0 ? (
        <EmptyState icon="⚙️" title="No jobs" description="Shadow hasn't executed any cycles yet" />
      ) : (
        <div className="flex flex-col gap-1.5">
          {data.map((hb) => {
            const isRunning = !hb.finishedAt;
            const active = isActive(hb);
            const phases = interestingPhases(hb.phases ?? []);
            const duration = hb.durationMs != null ? `${(hb.durationMs / 1000).toFixed(1)}s` : '--';
            const isOpen = expanded.has(hb.id);

            if (isRunning) {
              return (
                <div
                  key={hb.id}
                  className="bg-accent/5 border border-accent/30 rounded-lg px-4 py-3 animate-pulse"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge className={TYPE_COLORS[hb.type] ?? 'text-text-dim bg-border'}>{hb.type}</Badge>
                    <span className="text-xs text-accent">running</span>
                    {hb.activity && <span className="text-xs text-text-dim">· {hb.activity}</span>}
                    <span className="text-xs text-text-muted ml-auto">{timeAgo(hb.startedAt)}</span>
                  </div>
                </div>
              );
            }

            if (!active && !isOpen) {
              return (
                <div
                  key={hb.id}
                  onClick={() => toggle(hb.id)}
                  className="bg-card/50 border border-border/50 rounded px-4 py-2 cursor-pointer flex items-center gap-2 text-text-muted hover:border-border transition-colors"
                >
                  <Badge className={PHASE_STYLES.skip}>skip</Badge>
                  <span className="text-xs flex-1">{duration}</span>
                  <span className="text-xs">{timeAgo(hb.startedAt)}</span>
                </div>
              );
            }

            return (
              <div
                key={hb.id}
                onClick={() => toggle(hb.id)}
                className={`bg-card border rounded-lg px-4 py-3 cursor-pointer transition-colors hover:border-accent ${
                  active ? 'border-border' : 'border-border/50'
                }`}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge className={TYPE_COLORS[hb.type] ?? 'text-text-dim bg-border'}>{hb.type}</Badge>
                  <span className="text-xs text-text-muted">{phases.join(' → ')}</span>
                  <span className="text-xs text-text-muted">{duration}</span>
                  {hb.llmCalls > 0 && (
                    <span className="text-xs text-purple">{hb.llmCalls} LLM</span>
                  )}
                  {hb.tokensUsed > 0 && (
                    <span className="text-xs text-text-muted">{formatTokens(hb.tokensUsed)} tok</span>
                  )}
                  <span className="text-xs text-text-muted ml-auto shrink-0">{timeAgo(hb.startedAt)}</span>
                </div>

                {active && hb.result && (
                  <div className="flex gap-4 mt-2 text-xs text-text-dim">
                    {Object.entries(hb.result as Record<string, unknown>)
                      .filter(([, v]) => typeof v === 'number' && v > 0)
                      .map(([k, v]) => <span key={k}>{String(v)} {k.replace(/([A-Z])/g, ' $1').toLowerCase()}</span>)}
                  </div>
                )}

                {isOpen && (
                  <div className="mt-3 animate-fade-in bg-bg rounded p-3 text-xs text-text-dim space-y-1">
                    <div><span className="text-accent">phases:</span> {(hb.phases ?? []).join(' → ')}</div>
                    <div><span className="text-accent">duration:</span> {duration}</div>
                    {hb.llmCalls > 0 && <div><span className="text-accent">llm calls:</span> {hb.llmCalls}</div>}
                    {hb.tokensUsed > 0 && <div><span className="text-accent">tokens:</span> {hb.tokensUsed.toLocaleString()}</div>}
                    {hb.result && Object.entries(hb.result as Record<string, unknown>)
                      .filter(([, v]) => v != null && v !== 0 && v !== '')
                      .map(([k, v]) => (
                        <div key={k}><span className="text-accent">{k.replace(/([A-Z])/g, ' $1').toLowerCase()}:</span> {String(v)}</div>
                      ))}
                    <div><span className="text-accent">started:</span> {new Date(hb.startedAt).toLocaleString()}</div>
                    {hb.finishedAt && <div><span className="text-accent">finished:</span> {new Date(hb.finishedAt).toLocaleString()}</div>}
                    <div className="text-text-muted pt-1">{hb.id}</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <Pagination total={total} offset={Number(params.offset) || 0} limit={PAGE_SIZE} onChange={(o) => setParam('offset', String(o))} />
    </div>
  );
}
