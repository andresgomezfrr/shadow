import { timeAgo } from '../../../utils/format';
import { Badge } from '../../common/Badge';
import { ConfidenceIndicator } from '../../common/ConfidenceIndicator';
import { RunPipeline } from '../../common/RunPipeline';
import type { Run } from '../../../api/types';
import type { SelectedItem } from './WorkspaceContext';

const STATUS_ICON: Record<string, string> = {
  queued: '○', running: '⟳', completed: '✓', executed: '✓',
  executed_manual: '✓', discarded: '—', failed: '✕', closed: '●',
};
const STATUS_ICON_COLOR: Record<string, string> = {
  queued: 'text-orange', running: 'text-blue animate-spin', completed: 'text-green',
  executed: 'text-purple', executed_manual: 'text-blue', discarded: 'text-text-muted',
  failed: 'text-red', closed: 'text-text-muted',
};
const STATUS_BORDER: Record<string, string> = {
  queued: 'border-l-orange', running: 'border-l-blue', completed: 'border-l-green',
  executed: 'border-l-purple', executed_manual: 'border-l-blue', discarded: 'border-l-text-muted',
  failed: 'border-l-red', closed: 'border-l-text-muted',
};

type Props = {
  run: Run;
  selected: boolean;
  onSelect: (item: SelectedItem) => void;
  onExecute?: (id: string) => void;
  onSession?: (id: string) => void;
  onDiscard?: (id: string) => void;
};

export function FeedRunCard({ run, selected, onSelect, onExecute, onSession, onDiscard }: Props) {
  const icon = STATUS_ICON[run.status] ?? '○';
  const iconColor = STATUS_ICON_COLOR[run.status] ?? 'text-text-muted';
  const border = STATUS_BORDER[run.status] ?? 'border-l-border';
  const isPlan = run.status === 'completed' && run.kind !== 'execution';

  return (
    <div
      onClick={() => onSelect({ id: run.id, type: 'run', data: run })}
      className={`bg-card border border-l-[3px] ${border} rounded-lg px-4 py-2.5 cursor-pointer transition-colors hover:border-accent/50 ${
        selected ? 'border-accent ring-1 ring-accent/30' : 'border-border'
      }`}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-sm font-mono w-4 text-center ${iconColor}`} title={run.status}>{icon}</span>
        <Badge className="text-text-dim bg-border">{run.kind}</Badge>
        {run.confidence && <ConfidenceIndicator confidence={run.confidence} doubts={run.doubts?.length} compact />}
        <span className="text-[13px] flex-1 min-w-0 truncate">{run.prompt}</span>

        {/* Inline actions */}
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
        {isPlan && onDiscard && (
          <button
            onClick={e => { e.stopPropagation(); onDiscard(run.id); }}
            className="text-xs text-text-muted hover:text-red bg-transparent border-none cursor-pointer"
          >Discard</button>
        )}
        <span className="text-xs text-text-muted shrink-0">{timeAgo(run.createdAt)}</span>
      </div>
    </div>
  );
}
