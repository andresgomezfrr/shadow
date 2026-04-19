import { useCallback, useState, useEffect } from 'react';
import { useEventStream } from '../../hooks/useEventStream';
import { useApi } from '../../hooks/useApi';
import { fetchActivity, fetchStatus } from '../../api/client';
import { useNow, formatCountdown } from '../../utils/format';
import { JOB_TYPE_COLORS } from '../../utils/job-colors';
import { Badge } from '../common/Badge';
import { POLL_FAST } from '../../constants/polling';
import type { ActivityEntry } from '../../api/types';

const SSE_EVENTS = ['job:started', 'job:phase', 'job:complete', 'job:enqueued', 'run:phase'];

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

  const { data: status } = useApi(fetchStatus, [], POLL_FAST);
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
        const colors = JOB_TYPE_COLORS[entry.type] ?? 'bg-border text-text-dim';
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
