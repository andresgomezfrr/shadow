type MetricCardProps = {
  label: string;
  value: React.ReactNode;
  accent?: boolean;
  href?: string;
  trend?: number;
  children?: React.ReactNode;
};

export function MetricCard({ label, value, accent, href, trend, children }: MetricCardProps) {
  const Tag = href ? 'a' : 'div';
  const linkProps = href ? { href, className: 'no-underline' } : {};
  return (
    <Tag {...linkProps}>
      <div className={`bg-card border border-border rounded-lg p-4.5 transition-colors hover:border-accent ${href ? 'cursor-pointer' : ''}`}>
        <div className="text-xs text-text-dim uppercase tracking-wider mb-1.5">{label}</div>
        <div className="flex items-baseline gap-2 flex-wrap">
          <div className={`text-2xl font-semibold ${accent ? 'text-accent' : 'text-text'}`}>{value}</div>
          {trend !== undefined && trend !== 0 && (
            <span className={`text-xs font-medium ${trend > 0 ? 'text-green' : 'text-red'}`}>
              {trend > 0 ? '↑' : '↓'}{Math.abs(trend)}
            </span>
          )}
          {children}
        </div>
      </div>
    </Tag>
  );
}
