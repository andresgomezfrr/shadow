type MetricCardProps = {
  label: string;
  value: React.ReactNode;
  accent?: boolean;
  children?: React.ReactNode;
};

export function MetricCard({ label, value, accent, children }: MetricCardProps) {
  return (
    <div className="bg-card border border-border rounded-lg p-4.5 transition-colors hover:border-accent">
      <div className="text-xs text-text-dim uppercase tracking-wider mb-1.5">{label}</div>
      <div className={`text-2xl font-semibold ${accent ? 'text-accent' : 'text-text'}`}>{value}</div>
      {children}
    </div>
  );
}
