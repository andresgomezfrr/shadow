import { timeAgo } from '../../../utils/format';
import { Badge } from '../../common/Badge';
import { ConfidenceIndicator } from '../../common/ConfidenceIndicator';
import type { Run } from '../../../api/types';
import type { SelectedItem } from './WorkspaceContext';

function RunSpinner({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-block w-3.5 h-3.5 border-[1.5px] border-blue border-b-transparent rounded-full animate-[rotation_1s_linear_infinite] ${className}`} />
  );
}

import { RUN_STATUS_BORDER, RUN_STATUS_ICON, RUN_STATUS_ICON_COLOR } from '../../../utils/run-colors';

type Props = {
  run: Run;
  selected: boolean;
  onSelect: (item: SelectedItem) => void;
  onExecute?: (id: string) => void;
  onSession?: (id: string) => void;
  onDiscard?: (id: string) => void;
  onRetry?: (id: string) => void;
  onArchive?: (id: string) => void;
};

export function FeedRunCard({ run, selected, onSelect, onExecute, onSession, onDiscard, onRetry, onArchive }: Props) {
  const border = RUN_STATUS_BORDER[run.status] ?? 'border-l-border';
  const isPlan = run.status === 'planned' && run.kind !== 'execution';
  const isActive = run.status === 'running' || run.status === 'queued';
  const isFailed = run.status === 'failed';
  const isRunning = run.status === 'running';

  return (
    <div
      onClick={() => onSelect({ id: run.id, type: 'run', data: run })}
      className={`bg-card border border-l-[3px] ${border} rounded-lg px-4 py-2.5 cursor-pointer transition-colors hover:border-accent/50 ${
        selected ? 'border-accent ring-1 ring-accent/30' : 'border-border'
      }`}
    >
      <div className="flex items-center gap-2 flex-wrap">
        {isRunning ? (
          <RunSpinner />
        ) : (
          <span className={`text-sm font-mono w-4 text-center ${RUN_STATUS_ICON_COLOR[run.status] ?? 'text-text-muted'}`} title={run.status}>
            {RUN_STATUS_ICON[run.status] ?? '○'}
          </span>
        )}
        <Badge className="text-text-dim bg-border">{run.kind}</Badge>
        {run.status === 'done' && run.outcome && run.outcome !== 'executed' && (
          <Badge className="text-purple bg-purple/15">done:{run.outcome === 'executed_manual' ? 'manual' : run.outcome}</Badge>
        )}
        {run.confidence && <ConfidenceIndicator confidence={run.confidence} doubts={run.doubts?.length} compact />}
        <span className="text-[13px] flex-1 min-w-0 truncate">{run.prompt}</span>

        {/* Completed plan actions */}
        {isPlan && onExecute && (
          <button
            onClick={e => { e.stopPropagation(); onExecute(run.id); }}
            className="px-3 py-1 rounded-lg text-xs font-semibold bg-green text-bg border-none cursor-pointer transition-all hover:brightness-110"
          >▶ Execute</button>
        )}
        {isPlan && onSession && (
          <button
            onClick={e => { e.stopPropagation(); onSession(run.id); }}
            className="text-xs text-accent hover:underline bg-transparent border-none cursor-pointer"
          >Session</button>
        )}
        {isPlan && onArchive && (
          <button
            onClick={e => { e.stopPropagation(); onArchive(run.id); }}
            className="text-xs text-text-muted hover:text-text bg-transparent border-none cursor-pointer"
          >Archive</button>
        )}

        {/* Failed actions */}
        {isFailed && onRetry && (
          <button
            onClick={e => { e.stopPropagation(); onRetry(run.id); }}
            className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-orange/15 text-orange border-none cursor-pointer transition-all hover:bg-orange/25"
          >Retry</button>
        )}
        {isFailed && onArchive && (
          <button
            onClick={e => { e.stopPropagation(); onArchive(run.id); }}
            className="text-xs text-text-muted hover:text-text bg-transparent border-none cursor-pointer"
          >Archive</button>
        )}
        {isFailed && run.errorSummary && (
          <span className="text-xs text-red truncate max-w-[200px]" title={run.errorSummary}>{run.errorSummary}</span>
        )}

        {/* Running indicator — no Session button while active */}
        {isActive && run.startedAt && (
          <span className="text-xs text-blue font-medium">{timeAgo(run.startedAt)}</span>
        )}
        <span className="text-xs text-text-muted shrink-0">{timeAgo(run.createdAt)}</span>
      </div>
    </div>
  );
}
