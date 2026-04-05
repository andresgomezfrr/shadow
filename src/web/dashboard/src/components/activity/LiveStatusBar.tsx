import { useCallback, useState, useEffect } from 'react';
import { useEventStream } from '../../hooks/useEventStream';
import { useApi } from '../../hooks/useApi';
import { fetchActivity, fetchStatus } from '../../api/client';
import { useNow, formatCountdown } from '../../utils/format';
import { Badge } from '../common/Badge';
import type { ActivityEntry } from '../../api/types';

const TYPE_COLORS: Record<string, string> = {
  heartbeat: 'bg-purple-500/20 text-purple-300',
  suggest: 'bg-green-500/20 text-green-300',
  consolidate: 'bg-orange-500/20 text-orange-300',
  reflect: 'bg-blue-500/20 text-blue-300',
  'remote-sync': 'bg-pink-400/20 text-pink-300',
  'repo-profile': 'bg-teal-400/20 text-teal-300',
  'context-enrich': 'bg-cyan-400/20 text-cyan-300',
};

const SSE_EVENTS = ['job:started', 'job:phase', 'job:complete', 'job:enqueued'];

export function LiveStatusBar() {
  const now = useNow();
  const [running, setRunning] = useState<ActivityEntry[]>([]);

  const { data: polled, refresh } = useApi(
    () => fetchActivity({ status: 'running', limit: 5 }),
    [],
    5_000,
  );

  useEffect(() => {
    if (polled?.items) setRunning(polled.items);
  }, [polled]);

  const handleSSE = useCallback((_type: string, _data: unknown) => {
    refresh();
  }, [refresh]);

  useEventStream(SSE_EVENTS, handleSSE);

  const { data: status } = useApi(fetchStatus, [], 15_000);
  const nextHb = (status as Record<string, unknown>)?.nextHeartbeatAt as string | null | undefined;

  if (running.length === 0) {
    return (
      <div className="bg-card border border-border rounded-lg px-4 py-2.5 text-sm text-text-dim flex items-center gap-2">
        <span className="text-text-muted">Shadow is idle</span>
        <span className="text-text-muted">—</span>
        <span>Next: heartbeat in <span className="font-mono text-text">{formatCountdown(nextHb, now)}</span></span>
      </div>
    );
  }

  return (
    <div className="bg-card border border-accent/30 rounded-lg px-4 py-2.5 flex items-center gap-3 flex-wrap">
      {running.map((entry) => {
        const elapsed = entry.startedAt
          ? Math.floor((now - new Date(entry.startedAt).getTime()) / 1000)
          : 0;
        const mins = Math.floor(elapsed / 60);
        const secs = elapsed % 60;
        const colors = TYPE_COLORS[entry.type] ?? 'bg-border text-text-dim';
        return (
          <div key={entry.id} className="flex items-center gap-2 text-sm">
            <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
            <Badge className={colors}>{entry.type}</Badge>
            {entry.activity && <span className="text-text-dim text-xs">{entry.activity}</span>}
            <span className="font-mono text-xs text-text-muted">
              {mins}:{String(secs).padStart(2, '0')}s
            </span>
          </div>
        );
      })}
    </div>
  );
}
