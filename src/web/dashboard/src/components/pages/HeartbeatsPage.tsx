import { useApi } from '../../hooks/useApi';
import { fetchHeartbeats, fetchStatus, triggerHeartbeat } from '../../api/client';
import { Badge } from '../common/Badge';
import { MetricCard } from '../common/MetricCard';
import { EmptyState } from '../common/EmptyState';
import { useState, useEffect, useCallback } from 'react';
import type { Heartbeat } from '../../api/types';

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

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function isActive(hb: Heartbeat): boolean {
  const phases = hb.phases ?? [];
  return phases.some((p) => ['analyze', 'suggest', 'consolidate'].includes(p));
}

function interestingPhases(phases: string[]): string[] {
  const interesting = phases.filter((p) => !['wake', 'idle', 'notify'].includes(p));
  return interesting.length > 0 ? interesting : ['skip'];
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function useCountdown(targetIso: string | null | undefined): string {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (!targetIso) return '--:--';
  const diff = new Date(targetIso).getTime() - now;
  if (diff <= 0) return 'now';
  const mins = Math.floor(diff / 60000);
  const secs = Math.floor((diff % 60000) / 1000);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function HeartbeatsPage() {
  const { data, refresh } = useApi(fetchHeartbeats, [], 30_000);
  const { data: status } = useApi(fetchStatus, [], 15_000);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const countdown = useCountdown(status?.nextHeartbeatAt);

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
  const todayObs = todayBeats.reduce((sum, hb) => sum + hb.observationsCreated, 0);

  const hasRunning = data?.some((hb) => !hb.finishedAt) ?? false;
  const canTrigger = !triggered && !hasRunning;

  return (
    <div>
      <div className="flex items-center gap-4 mb-4">
        <h1 className="text-xl font-semibold">Heartbeats</h1>
        <div className="flex items-center gap-3 ml-auto">
          <span className="text-sm text-text-muted">Next in <span className="text-text font-mono">{countdown}</span></span>
          <button
            onClick={handleTrigger}
            disabled={!canTrigger}
            className="px-3 py-1.5 text-xs rounded-lg bg-accent-soft text-accent border-none cursor-pointer hover:bg-accent/25 transition-colors disabled:opacity-50"
          >
            {hasRunning ? 'Running...' : triggered ? 'Triggered...' : 'Trigger now'}
          </button>
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
        <EmptyState icon="💜" title="No heartbeats" description="Shadow hasn't executed any cycles yet" />
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
                    <Badge className="text-accent bg-accent-soft">running</Badge>
                    <Badge className={PHASE_STYLES[hb.phase] ?? PHASE_STYLES.idle}>{hb.phase}</Badge>
                    {hb.activity && <span className="text-xs text-text-dim">{hb.activity}</span>}
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
                  {phases.map((p, i) => (
                    <Badge key={i} className={PHASE_STYLES[p] ?? PHASE_STYLES.idle}>{p}</Badge>
                  ))}
                  <span className="text-xs text-text-muted">{duration}</span>
                  {hb.llmCalls > 0 && (
                    <span className="text-xs text-purple">{hb.llmCalls} LLM</span>
                  )}
                  {hb.tokensUsed > 0 && (
                    <span className="text-xs text-text-muted">{formatTokens(hb.tokensUsed)} tok</span>
                  )}
                  <span className="text-xs text-text-muted ml-auto shrink-0">{timeAgo(hb.startedAt)}</span>
                </div>

                {active && (
                  <div className="flex gap-4 mt-2 text-xs text-text-dim">
                    {hb.observationsCreated > 0 && <span>{hb.observationsCreated} obs</span>}
                    {hb.suggestionsCreated > 0 && <span>{hb.suggestionsCreated} sug</span>}
                    {hb.memoriesPromoted > 0 && <span>{hb.memoriesPromoted} mem promoted</span>}
                    {hb.memoriesDemoted > 0 && <span>{hb.memoriesDemoted} mem demoted</span>}
                    {hb.eventsQueued > 0 && <span>{hb.eventsQueued} events</span>}
                  </div>
                )}

                {isOpen && (
                  <div className="mt-3 animate-fade-in bg-bg rounded p-3 text-xs text-text-dim space-y-1">
                    <div><span className="text-accent">id:</span> {hb.id}</div>
                    <div><span className="text-accent">phases:</span> {(hb.phases ?? []).join(' → ')}</div>
                    <div><span className="text-accent">duration:</span> {duration}</div>
                    <div><span className="text-accent">llm calls:</span> {hb.llmCalls}</div>
                    <div><span className="text-accent">tokens:</span> {hb.tokensUsed.toLocaleString()}</div>
                    <div><span className="text-accent">observations:</span> {hb.observationsCreated}</div>
                    <div><span className="text-accent">suggestions:</span> {hb.suggestionsCreated}</div>
                    <div><span className="text-accent">memories promoted:</span> {hb.memoriesPromoted}</div>
                    <div><span className="text-accent">memories demoted:</span> {hb.memoriesDemoted}</div>
                    <div><span className="text-accent">events queued:</span> {hb.eventsQueued}</div>
                    <div><span className="text-accent">started:</span> {new Date(hb.startedAt).toLocaleString()}</div>
                    {hb.finishedAt && <div><span className="text-accent">finished:</span> {new Date(hb.finishedAt).toLocaleString()}</div>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
