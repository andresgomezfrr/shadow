import { timeAgo } from '../../../utils/format';
import { Badge } from '../../common/Badge';
import type { Task } from '../../../api/types';
import type { SelectedItem } from './WorkspaceContext';

const STATUS_COLORS: Record<string, string> = {
  todo: 'text-teal-300 bg-teal-500/15',
  in_progress: 'text-teal-300 bg-teal-500/15',
  blocked: 'text-red bg-red/15',
  closed: 'text-teal-600 bg-teal-500/10',
};

const STATUS_BORDER: Record<string, string> = {
  todo: 'border-l-teal-500/50',
  in_progress: 'border-l-teal-400',
  blocked: 'border-l-red',
  closed: 'border-l-teal-600/40',
};

type Props = {
  task: Task;
  selected: boolean;
  onSelect: (item: SelectedItem) => void;
};

export function FeedTaskCard({ task, selected, onSelect }: Props) {
  const border = STATUS_BORDER[task.status] ?? 'border-l-border';

  return (
    <div
      onClick={() => onSelect({ id: task.id, type: 'task', data: task })}
      className={`bg-card border border-l-[3px] ${border} rounded-lg px-4 py-2.5 cursor-pointer transition-colors hover:border-accent/50 ${
        selected ? 'border-accent ring-1 ring-accent/30' : 'border-border'
      }`}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm">📋</span>
        <Badge className={STATUS_COLORS[task.status] ?? 'text-text-dim bg-border'}>{task.status.replace('_', ' ')}</Badge>
        {task.externalRefs.map((ref, i) => (
          <Badge key={i} className="text-purple bg-purple/15">{ref.source.toUpperCase()} {ref.key}</Badge>
        ))}
        <span className="font-medium text-[13px] flex-1 min-w-0 truncate">{task.title}</span>
        {task.sessionId && (
          <span className="text-[11px] text-accent" title="Has session">⟳</span>
        )}
        {task.prUrls.length > 0 && (
          <span className="text-[11px] text-purple" title={`${task.prUrls.length} PR(s)`}>PR</span>
        )}
        <span className="text-xs text-text-muted shrink-0">{timeAgo(task.updatedAt)}</span>
      </div>
    </div>
  );
}
