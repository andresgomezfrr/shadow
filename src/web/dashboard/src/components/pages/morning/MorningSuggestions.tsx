import { useState } from 'react';
import { timeAgo } from '../../../utils/format';
import { Badge } from '../../common/Badge';
import { Markdown } from '../../common/Markdown';
import { EmptyState } from '../../common/EmptyState';
import { ScoreBar } from '../../common/ScoreBar';
import type { Suggestion } from '../../../api/types';

const SNOOZE_OPTIONS = [
  { label: '3h', hours: 3 },
  { label: '6h', hours: 6 },
  { label: '1d', hours: 24 },
  { label: '3d', hours: 72 },
  { label: '7d', hours: 168 },
];

function SuggestionReviewCard({
  suggestion,
  onAccept,
  onDismiss,
  onSnooze,
}: {
  suggestion: Suggestion;
  onAccept: (id: string) => void;
  onDismiss: (id: string) => void;
  onSnooze: (id: string, hours: number) => void;
}) {
  const [leaving, setLeaving] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);

  const handleAction = (action: 'accept' | 'dismiss') => {
    setLeaving(true);
    setTimeout(() => {
      if (action === 'accept') onAccept(suggestion.id);
      else onDismiss(suggestion.id);
    }, 350);
  };

  return (
    <div className={`bg-card border border-l-[3px] border-l-orange border-border rounded-lg p-4 transition-all ${leaving ? 'animate-slide-out' : ''}`}>
      <div className="flex items-center gap-2.5 mb-2">
        <span className="font-medium text-[15px] flex-1 min-w-0">{suggestion.title}</span>
        <Badge className="text-text-dim bg-border">{suggestion.kind}</Badge>
        <ScoreBar impact={suggestion.impactScore} confidence={suggestion.confidenceScore} risk={suggestion.riskScore} compact />
        <span className="text-xs text-text-muted shrink-0">{timeAgo(suggestion.createdAt)}</span>
      </div>
      <div className="mb-3"><Markdown>{suggestion.summaryMd}</Markdown></div>
      <div className="flex items-center gap-3">
        <button
          onClick={() => handleAction('accept')}
          className="px-4 py-2 rounded-lg text-xs font-semibold bg-green text-bg border-none cursor-pointer transition-all hover:brightness-110"
        >✓ Accept</button>
        <div className="relative">
          <button
            onClick={() => setSnoozeOpen(!snoozeOpen)}
            className="text-xs text-blue hover:underline bg-transparent border-none cursor-pointer"
          >Snooze</button>
          {snoozeOpen && (
            <div className="absolute top-full left-0 mt-1 bg-card border border-border rounded-lg shadow-lg z-10 overflow-hidden">
              {SNOOZE_OPTIONS.map((opt) => (
                <button
                  key={opt.hours}
                  onClick={() => { setLeaving(true); setTimeout(() => onSnooze(suggestion.id, opt.hours), 350); setSnoozeOpen(false); }}
                  className="block w-full px-4 py-1.5 text-xs text-left hover:bg-accent-soft cursor-pointer border-none bg-transparent"
                >{opt.label}</button>
              ))}
            </div>
          )}
        </div>
        <span className="text-text-muted">·</span>
        <button
          onClick={() => handleAction('dismiss')}
          className="text-xs text-text-muted hover:text-red bg-transparent border-none cursor-pointer"
        >Dismiss</button>
      </div>
    </div>
  );
}

export function MorningSuggestions({
  suggestions,
  onAccept,
  onDismiss,
  onSnooze,
}: {
  suggestions: Suggestion[];
  onAccept: (id: string) => void;
  onDismiss: (id: string) => void;
  onSnooze: (id: string, hours: number) => void;
}) {
  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
        💡 Pending suggestions
        {suggestions.length > 0 && <Badge>{suggestions.length}</Badge>}
      </h2>
      {suggestions.length === 0 ? (
        <EmptyState icon="✓" title="All caught up" description="No pending suggestions to review" />
      ) : (
        <div className="flex flex-col gap-2">
          {suggestions.map((s) => (
            <SuggestionReviewCard key={s.id} suggestion={s} onAccept={onAccept} onDismiss={onDismiss} onSnooze={onSnooze} />
          ))}
        </div>
      )}
    </section>
  );
}
