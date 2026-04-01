type ProgressBarProps = {
  value: number;
  max: number;
  className?: string;
};

export function ProgressBar({ value, max, className = '' }: ProgressBarProps) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className={`h-1.5 bg-border rounded-full mt-2 overflow-hidden ${className}`}>
      <div
        className="h-full bg-accent rounded-full transition-[width] duration-600 ease-out"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
