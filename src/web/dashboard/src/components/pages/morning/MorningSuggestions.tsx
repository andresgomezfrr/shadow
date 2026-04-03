import { useState } from 'react';
import { timeAgo } from '../../../utils/format';
import { Badge } from '../../common/Badge';
import { Markdown } from '../../common/Markdown';
import { EmptyState } from '../../common/EmptyState';
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
    <div className={`bg-card border border-border rounded-lg p-5 transition-all ${leaving ? 'animate-slide-out' : ''}`}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1 min-w-0">
          <div className="font-medium text-[15px]">{suggestion.title}</div>
          <div className="flex items-center gap-2 text-xs text-text-muted mt-0.5 flex-wrap">
            <span>{suggestion.kind}</span>
            <span>·</span>
            <span>{timeAgo(suggestion.createdAt)}</span>
            {suggestion.sourceObservationId && (
              <><span>·</span><a href={`/observations?highlight=${suggestion.sourceObservationId}`} className="text-accent hover:underline">from observation</a></>
            )}
          </div>
        </div>
        <div className="flex gap-1.5 shrink-0">
          <Badge title="Impact: how much value (1=low, 5=high)" className="text-green bg-green/15">↑{suggestion.impactScore}</Badge>
          <Badge title="Confidence (0-100%)" className="text-blue bg-blue/15">{Math.round(suggestion.confidenceScore)}%</Badge>
          {suggestion.riskScore > 1 && (
            <Badge title="Risk: breaking potential (1=safe, 5=dangerous)" className="text-orange bg-orange/15">⚠ {suggestion.riskScore}</Badge>
          )}
        </div>
      </div>
      <div className="mb-4"><Markdown>{suggestion.summaryMd}</Markdown></div>
      <div className="flex gap-2">
        <button
          onClick={() => handleAction('accept')}
          className="px-4 py-1.5 rounded-lg text-xs font-medium bg-green/15 text-green border border-green/30 cursor-pointer transition-all hover:bg-green/25"
        >
          Accept
        </button>
        <div className="relative">
          <button
            onClick={() => setSnoozeOpen(!snoozeOpen)}
            className="px-4 py-1.5 rounded-lg text-xs font-medium bg-blue/15 text-blue border border-blue/30 cursor-pointer transition-all hover:bg-blue/25"
          >
            Snooze
          </button>
          {snoozeOpen && (
            <div className="absolute top-full left-0 mt-1 bg-card border border-border rounded-lg shadow-lg z-10 overflow-hidden">
              {SNOOZE_OPTIONS.map((opt) => (
                <button
                  key={opt.hours}
                  onClick={() => { setLeaving(true); setTimeout(() => onSnooze(suggestion.id, opt.hours), 350); setSnoozeOpen(false); }}
                  className="block w-full px-4 py-1.5 text-xs text-left hover:bg-accent-soft cursor-pointer"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={() => handleAction('dismiss')}
          className="px-4 py-1.5 rounded-lg text-xs font-medium bg-border text-text-dim border border-border cursor-pointer transition-all hover:bg-red/15 hover:text-red hover:border-red/30"
        >
          Dismiss
        </button>
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
        {suggestions.length > 0 && (
          <Badge>{suggestions.length}</Badge>
        )}
      </h2>
      {suggestions.length === 0 ? (
        <EmptyState
          icon="✅"
          title="All caught up"
          description="No pending suggestions to review"
        />
      ) : (
        <div className="flex flex-col gap-3">
          {suggestions.map((s) => (
            <SuggestionReviewCard
              key={s.id}
              suggestion={s}
              onAccept={onAccept}
              onDismiss={onDismiss}
              onSnooze={onSnooze}
            />
          ))}
        </div>
      )}
    </section>
  );
}
