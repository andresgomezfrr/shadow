import { useState } from 'react';
import { timeAgo } from '../../utils/format';
import { num } from '../../utils/job-results';
import { JOB_TYPE_COLORS, JOB_TYPE_COLOR_DEFAULT } from '../../utils/job-colors';
import { Badge } from '../common/Badge';
import { ActivityEntryHeader } from './ActivityEntryHeader';
import { ActivityEntryExpandedDetail } from './ActivityEntryExpandedDetail';
import { PhasePipeline, RUN_PLAN_PHASES, RUN_EXEC_PHASES, JOB_PHASES } from './ActivityEntryPhases';
import { triggerJobWithParams } from '../../api/client';
import type { ActivityEntry as ActivityEntryType } from '../../api/types';

/**
 * ActivityEntryCard — row in the Activity feed representing one job or run.
 *
 * Dispatches to dedicated layouts for queued/running/skip, falls through to
 * the common header + expanded detail for completed/failed. Sub-components
 * live in ActivityEntryHeader.tsx, ActivityEntryExpandedDetail.tsx, and
 * ActivityEntryPhases.tsx — split during audit UI-01 (was 941 lines).
 */

function isSkip(entry: ActivityEntryType): boolean {
  if (entry.status === 'running' || entry.status === 'queued') return false;
  if (entry.source === 'run') return false;
  if (entry.llmCalls > 0) return false;
  const result = entry.result ?? {};
  return !Object.values(result).some(v => v !== null && v !== undefined && v !== 0 && v !== false && v !== '');
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '--';
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

// --- Main Component ---

type Props = {
  entry: ActivityEntryType;
  defaultExpanded?: boolean;
};

export function ActivityEntryCard({ entry, defaultExpanded = false }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const isQueued = entry.status === 'queued';
  const isRunning = entry.status === 'running';
  const isFailed = entry.status === 'failed';
  const skip = isSkip(entry);
  const isRun = entry.source === 'run';
  const typeColor = JOB_TYPE_COLORS[entry.type] ?? JOB_TYPE_COLOR_DEFAULT;

  const borderClass = isRunning
    ? 'border-l-blue animate-pulse'
    : isFailed
    ? 'border-l-red'
    : 'border-l-transparent';

  // Queued state: orange left border
  if (isQueued) {
    return (
      <div className="bg-card border border-l-[3px] border-l-orange border-border rounded-lg px-4 py-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge className={typeColor}>{entry.type}</Badge>
          <span className="text-xs text-orange">queued</span>
          {entry.startedAt && <span className="text-xs text-text-muted ml-auto">{timeAgo(entry.startedAt)}</span>}
        </div>
      </div>
    );
  }

  // Skip rows: dimmed, collapsed
  if (skip && !expanded) {
    return (
      <div
        onClick={() => setExpanded(true)}
        className="bg-card/50 border border-l-[3px] border-l-transparent border-border/50 rounded px-4 py-2 cursor-pointer flex items-center gap-2 text-text-muted hover:border-border transition-colors"
      >
        <Badge className={typeColor}>{entry.type}</Badge>
        <Badge className="text-text-muted bg-text-muted/10">skip</Badge>
        <span className="text-xs flex-1">{formatDuration(entry.durationMs)}</span>
        {entry.startedAt && <span className="text-xs">{timeAgo(entry.startedAt)}</span>}
      </div>
    );
  }

  // Running state — shows phases as they progress
  if (isRunning) {
    const expectedPhases = isRun
      ? (entry.type === 'run:execute' ? RUN_EXEC_PHASES : RUN_PLAN_PHASES)
      : JOB_PHASES[entry.type];
    return (
      <div className="bg-accent/5 border border-l-[3px] border-l-blue border-accent/30 rounded-lg px-4 py-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge className={typeColor}>{entry.type}</Badge>
          {isRun && entry.repoName && <Badge className="text-text-dim bg-border">{entry.repoName}</Badge>}
          {entry.startedAt && <span className="text-xs text-text-muted ml-auto">{timeAgo(entry.startedAt)}</span>}
        </div>
        {expectedPhases && (
          <div className="mt-2">
            <PhasePipeline phases={entry.phases} currentPhase={entry.activity ?? undefined} jobType={entry.type} allPhases={expectedPhases} />
          </div>
        )}
      </div>
    );
  }

  // Completed / failed — expandable card
  return (
    <div
      onClick={() => setExpanded(!expanded)}
      className={`bg-card border border-l-[3px] ${borderClass} rounded-lg px-4 py-3 cursor-pointer transition-colors hover:border-accent/50 ${
        skip ? 'border-border/50' : 'border-border'
      }`}
    >
      <ActivityEntryHeader entry={entry} />

      {expanded && (
        <div className="mt-3 animate-fade-in bg-bg rounded p-3 text-xs text-text-dim space-y-1.5" onClick={(e) => e.stopPropagation()}>
          {/* Per-type detail */}
          <ActivityEntryExpandedDetail entry={entry} />

          {/* Common metadata */}
          {entry.llmCalls > 0 && (
            <div className="pt-1 border-t border-border/30 mt-2">
              <span className="text-text-muted">{entry.llmCalls} LLM call{entry.llmCalls !== 1 ? 's' : ''}</span>
              {entry.tokensUsed > 0 && <span className="text-text-muted"> · {entry.tokensUsed.toLocaleString()} tokens</span>}
              <span className="text-text-muted"> · {formatDuration(entry.durationMs)}</span>
            </div>
          )}

          {/* Failed: error + retry */}
          {isFailed && entry.result?.error && (
            <div className="pt-1 border-t border-border/30 mt-2">
              <span className="text-red text-xs">{String(entry.result.error)}</span>
              {num(entry.result, 'retryCount') > 0 && (
                <span className="text-text-muted text-xs ml-2">
                  (attempt {num(entry.result, 'retryCount') + 1})
                </span>
              )}
            </div>
          )}

          {/* Timestamps + retry button */}
          <div className="text-text-muted flex items-center">
            {entry.startedAt && <span>{new Date(entry.startedAt).toLocaleString()}</span>}
            {entry.finishedAt && <span> → {new Date(entry.finishedAt).toLocaleTimeString()}</span>}
            <span className="ml-2 text-text-muted/50">{entry.id.slice(0, 8)}</span>
            {isFailed && entry.source === 'job' && <RetryButton entry={entry} />}
          </div>
        </div>
      )}
    </div>
  );
}

// --- Retry button for failed jobs ---

function RetryButton({ entry }: { entry: ActivityEntryType }) {
  const [triggered, setTriggered] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRetry = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const params = (entry.result ?? {}) as Record<string, unknown>;
    // Remove the error field from params before retry
    const cleanParams = { ...params };
    delete cleanParams.error;

    try {
      await triggerJobWithParams(entry.type, cleanParams);
      setTriggered(true);
      setTimeout(() => setTriggered(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'retry failed');
      setTimeout(() => setError(null), 3000);
    }
  };

  if (triggered) return <span className="ml-auto text-green text-xs">✓ retried</span>;
  if (error) return <span className="ml-auto text-red text-xs">✗ {error}</span>;

  return (
    <button
      onClick={handleRetry}
      className="ml-auto text-accent text-xs bg-accent/10 hover:bg-accent/20 px-2 py-0.5 rounded border-none cursor-pointer"
    >
      retry
    </button>
  );
}
