import { useRunningJobs } from '../../../hooks/useRunningJobs';
import { useApi } from '../../../hooks/useApi';
import { fetchStatus } from '../../../api/client';
import { timeAgo } from '../../../utils/format';

const JOB_LABELS: Record<string, string> = {
  heartbeat: '💓', suggest: '💡', 'suggest-deep': '💡', 'suggest-project': '💡',
  consolidate: '⚙', reflect: '~', 'remote-sync': '🔄', 'context-enrich': '🔗',
};

export function ActivityStrip() {
  const { runningTypes } = useRunningJobs();
  const { data: status } = useApi(fetchStatus, [], 15_000);

  const lastHeartbeat = status?.lastHeartbeat;

  return (
    <div className="sticky bottom-0 flex items-center gap-3 px-3 py-1.5 bg-card/80 backdrop-blur border-t border-border text-[11px] text-text-muted mt-4 -mx-6 -mb-6 px-6">
      {runningTypes.length > 0 ? (
        runningTypes.map(type => (
          <span key={type} className="flex items-center gap-1 text-accent">
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
            {JOB_LABELS[type] ?? type}
          </span>
        ))
      ) : (
        <span>{'{'}*‿*{'}'}</span>
      )}
      {lastHeartbeat && (
        <>
          <span className="text-border">·</span>
          <span>heartbeat {timeAgo(lastHeartbeat.startedAt)}</span>
        </>
      )}
    </div>
  );
}
