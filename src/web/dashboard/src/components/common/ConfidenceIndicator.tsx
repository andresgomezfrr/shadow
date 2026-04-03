const DOT_STYLES = {
  high: { filled: 'bg-green', empty: 'bg-green/30', label: 'high confidence', count: 3 },
  medium: { filled: 'bg-orange', empty: 'bg-orange/30', label: 'some doubts', count: 2 },
  low: { filled: 'bg-red', empty: 'bg-red/30', label: 'needs review', count: 1 },
} as const;

const DOUBT_OVERRIDE = { filled: 'bg-orange', empty: 'bg-orange/30' };

type Props = {
  confidence: string;
  doubts?: number;
  compact?: boolean;
};

export function ConfidenceIndicator({ confidence, doubts = 0, compact }: Props) {
  const style = DOT_STYLES[confidence as keyof typeof DOT_STYLES] ?? DOT_STYLES.low;
  const hasDoubts = doubts > 0;
  const fill = hasDoubts ? DOUBT_OVERRIDE.filled : style.filled;
  const empty = hasDoubts ? DOUBT_OVERRIDE.empty : style.empty;
  const label = hasDoubts ? `${doubts} doubt${doubts > 1 ? 's' : ''}` : style.label;

  return (
    <div className="inline-flex items-center gap-1" title={label}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={`rounded-full ${i < style.count ? fill : empty} ${compact ? 'w-1.5 h-1.5' : 'w-2 h-2'}`}
        />
      ))}
      {!compact && (
        <span className="text-xs text-text-muted ml-1">{label}</span>
      )}
    </div>
  );
}
