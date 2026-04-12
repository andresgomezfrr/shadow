type Props = {
  impact: number;       // 1-5
  confidence: number;   // 0-100
  risk: number;         // 1-5
  compact?: boolean;
};

function segment(value: number, max: number, color: string, label: string) {
  const pct = Math.round((value / max) * 100);
  return (
    <div
      className={`h-1.5 rounded-full ${color}`}
      style={{ width: `${pct}%`, minWidth: '4px' }}
      title={`${label}: ${value}${max === 100 ? '%' : '/' + max}`}
    />
  );
}

export function ScoreBar({ impact, confidence, risk, compact }: Props) {
  if (compact) {
    return (
      <div className="flex items-center gap-1" title={`Impact ${impact}/5 · Confidence ${confidence}% · Risk ${risk}/5`}>
        <div className="flex gap-[2px] w-10 h-1.5">
          {segment(impact, 5, 'bg-green', 'Impact')}
          {segment(confidence, 100, 'bg-blue', 'Confidence')}
          {segment(risk, 5, 'bg-orange', 'Risk')}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-xs">
      <div className="flex items-center gap-1" title={`Impact: ${impact}/5`}>
        <span className="text-green">↑{impact}</span>
      </div>
      <div className="flex items-center gap-1" title={`Confidence: ${confidence}%`}>
        <span className="text-blue">{Math.round(confidence)}%</span>
      </div>
      <div className="flex items-center gap-1" title={`Risk: ${risk}/5`}>
        <span className="text-orange">⚠{risk}</span>
      </div>
    </div>
  );
}
