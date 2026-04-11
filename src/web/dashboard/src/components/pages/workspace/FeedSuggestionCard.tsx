import { useState, useRef, useEffect } from 'react';
import { timeAgo } from '../../../utils/format';
import { Badge } from '../../common/Badge';
import { ScoreBar } from '../../common/ScoreBar';
import { SUG_KIND_COLORS, SUG_KIND_COLOR_DEFAULT } from '../../../utils/suggestion-colors';
import type { Suggestion } from '../../../api/types';
import type { SelectedItem } from './WorkspaceContext';

const STATUS_BORDER: Record<string, string> = {
  open: 'border-l-orange', snoozed: 'border-l-blue',
  accepted: 'border-l-green', dismissed: 'border-l-text-muted',
};

const ACCEPT_OPTIONS = [
  { label: 'Execute', category: 'execute' },
  { label: 'Already done', category: 'manual' },
  { label: 'Plan', category: 'planned' },
];

type Props = {
  suggestion: Suggestion;
  selected: boolean;
  onSelect: (item: SelectedItem) => void;
  onAccept?: (id: string, category?: string) => void;
  onDismiss?: (id: string) => void;
  onSnooze?: (id: string) => void;
};

export function FeedSuggestionCard({ suggestion: s, selected, onSelect, onAccept, onDismiss, onSnooze }: Props) {
  const border = STATUS_BORDER[s.status] ?? 'border-l-border';
  const isOpen = s.status === 'open';
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  const options = ACCEPT_OPTIONS;
  const buttonLabel = '✓ Accept';

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
        {s.revalidationVerdict === 'outdated' && <Badge className="text-red bg-red/15">outdated</Badge>}
        <span className="font-medium text-[13px] flex-1 min-w-0 truncate">{s.title}</span>
        <ScoreBar impact={s.impactScore} confidence={s.confidenceScore} risk={s.riskScore} compact />

        {isOpen && onAccept && (
          <div className="relative" ref={menuRef}>
            <button
              onClick={e => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
              className="px-3 py-1 rounded-lg text-xs font-semibold bg-green text-bg border-none cursor-pointer transition-all hover:brightness-110"
            >{buttonLabel}</button>
            {menuOpen && (
              <div className="absolute top-full right-0 mt-1 bg-card border border-border rounded-lg shadow-lg z-10 overflow-hidden min-w-36">
                {options.map(opt => (
                  <button
                    key={opt.category}
                    onClick={e => { e.stopPropagation(); onAccept(s.id, opt.category); setMenuOpen(false); }}
                    className="block w-full px-4 py-1.5 text-xs text-left hover:bg-accent-soft cursor-pointer border-none bg-transparent"
                  >{opt.label}</button>
                ))}
              </div>
            )}
          </div>
        )}
        {isOpen && onSnooze && (
          <button
            onClick={e => { e.stopPropagation(); onSnooze(s.id); }}
            className="text-xs text-blue hover:underline bg-transparent border-none cursor-pointer"
          >Snooze</button>
        )}
        {isOpen && onDismiss && (
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
