import { timeAgo } from '../../../utils/format';
import { Badge } from '../../common/Badge';
import { ScoreBar } from '../../common/ScoreBar';
import { SUG_KIND_COLORS, SUG_KIND_COLOR_DEFAULT } from '../../../utils/suggestion-colors';
import type { Suggestion } from '../../../api/types';
import type { SelectedItem } from './WorkspaceContext';

const STATUS_BORDER: Record<string, string> = {
  pending: 'border-l-orange', backlog: 'border-l-purple', snoozed: 'border-l-blue',
  accepted: 'border-l-green', dismissed: 'border-l-text-muted',
};

type Props = {
  suggestion: Suggestion;
  selected: boolean;
  onSelect: (item: SelectedItem) => void;
  onAccept?: (id: string) => void;
  onDismiss?: (id: string) => void;
  onSnooze?: (id: string) => void;
};

export function FeedSuggestionCard({ suggestion: s, selected, onSelect, onAccept, onDismiss, onSnooze }: Props) {
  const border = STATUS_BORDER[s.status] ?? 'border-l-border';
  const isPending = s.status === 'pending';

  return (
    <div
      onClick={() => onSelect({ id: s.id, type: 'suggestion', data: s })}
      className={`bg-card border border-l-[3px] ${border} rounded-lg px-4 py-2.5 cursor-pointer transition-colors hover:border-accent/50 ${
        selected ? 'border-accent ring-1 ring-accent/30' : 'border-border'
      }`}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm">💡</span>
        <Badge className={SUG_KIND_COLORS[s.kind] ?? SUG_KIND_COLOR_DEFAULT}>{s.kind}</Badge>
        <span className="font-medium text-[13px] flex-1 min-w-0 truncate">{s.title}</span>
        <ScoreBar impact={s.impactScore} confidence={s.confidenceScore} risk={s.riskScore} compact />

        {/* Inline actions */}
        {isPending && onAccept && (
          <button
            onClick={e => { e.stopPropagation(); onAccept(s.id); }}
            className="px-3 py-1 rounded-lg text-xs font-semibold bg-green text-bg border-none cursor-pointer transition-all hover:brightness-110"
          >✓ Accept</button>
        )}
        {isPending && onSnooze && (
          <button
            onClick={e => { e.stopPropagation(); onSnooze(s.id); }}
            className="text-xs text-blue hover:underline bg-transparent border-none cursor-pointer"
          >Snooze</button>
        )}
        {isPending && onDismiss && (
          <button
            onClick={e => { e.stopPropagation(); onDismiss(s.id); }}
            className="text-xs text-text-muted hover:text-red bg-transparent border-none cursor-pointer"
          >Dismiss</button>
        )}
        <span className="text-xs text-text-muted shrink-0">{timeAgo(s.createdAt)}</span>
      </div>
    </div>
  );
}
