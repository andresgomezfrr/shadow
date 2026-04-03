const DOT_STYLES = {
  high: { filled: 'bg-green', empty: 'bg-green/30', label: 'high confidence', count: 3 },
  medium: { filled: 'bg-orange', empty: 'bg-orange/30', label: 'some doubts', count: 2 },
  low: { filled: 'bg-red', empty: 'bg-red/30', label: 'needs review', count: 1 },
} as const;

type Props = {
  confidence: string;
  compact?: boolean;
};

export function ConfidenceIndicator({ confidence, compact }: Props) {
  const style = DOT_STYLES[confidence as keyof typeof DOT_STYLES] ?? DOT_STYLES.low;

  return (
    <div className="inline-flex items-center gap-1" title={style.label}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={`rounded-full ${i < style.count ? style.filled : style.empty} ${compact ? 'w-1.5 h-1.5' : 'w-2 h-2'}`}
        />
      ))}
      {!compact && (
        <span className="text-xs text-text-muted ml-1">{style.label}</span>
      )}
    </div>
  );
}
