import { timeAgo, formatTokens } from '../../utils/format';
import { JOB_TYPE_COLORS, JOB_TYPE_COLOR_DEFAULT } from '../../utils/job-colors';
import { Badge } from '../common/Badge';
import { ConfidenceIndicator } from '../common/ConfidenceIndicator';
import { JobOutputSummary } from './JobOutputSummary';
import type { ActivityEntry as ActivityEntryType } from '../../api/types';

/**
 * Collapsed row of an ActivityEntry — badge + title + output summary + meta.
 * Extracted from ActivityEntry.tsx (audit UI-01).
 *
 * This is the single row the user sees when the entry is NOT expanded. Running/
 * queued/skip states have their own dedicated layouts and don't use this.
 */

const STATUS_BADGE: Record<string, string> = {
  completed: 'text-green bg-green/15',
  running: 'text-blue bg-blue/15',
  failed: 'text-red bg-red/15',
  planned: 'text-indigo-300 bg-indigo-400/15',
  awaiting_pr: 'text-fuchsia-300 bg-fuchsia-400/15',
  done: 'text-green bg-green/15',
  dismissed: 'text-text-muted bg-border',
};

function formatDuration(ms: number | null): string {
  if (ms == null) return '--';
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

type Props = {
  entry: ActivityEntryType;
};

export function ActivityEntryHeader({ entry }: Props) {
  const isRun = entry.source === 'run';
  const isFailed = entry.status === 'failed';
  const typeColor = JOB_TYPE_COLORS[entry.type] ?? JOB_TYPE_COLOR_DEFAULT;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Badge className={typeColor}>{entry.type}</Badge>
      {isRun && entry.repoName && <Badge className="text-text-dim bg-border">{entry.repoName}</Badge>}
      {isRun && entry.confidence && (
        <ConfidenceIndicator confidence={entry.confidence} compact />
      )}
      {isRun && entry.status && (
        <Badge className={STATUS_BADGE[entry.status] ?? 'text-text-dim bg-border'}>{entry.status.replace('_', ' ')}</Badge>
      )}
      <span className="flex-1 min-w-0">
        <JobOutputSummary entry={entry} />
      </span>
      {isFailed && !!entry.result?.error && (
        <span className="text-red text-xs truncate max-w-60">
          {String(entry.result.error).slice(0, 60)}
        </span>
      )}
      {entry.tokensUsed > 0 && (
        <span className="font-mono text-xs text-text-muted">{formatTokens(entry.tokensUsed)} tok</span>
      )}
      <span className="font-mono text-xs text-text-muted">{formatDuration(entry.durationMs)}</span>
      {entry.startedAt && <span className="text-xs text-text-muted shrink-0">{timeAgo(entry.startedAt)}</span>}
    </div>
  );
}
