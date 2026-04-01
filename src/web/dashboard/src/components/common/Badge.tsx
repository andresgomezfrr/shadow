type BadgeProps = {
  children: React.ReactNode;
  className?: string;
};

export function Badge({ children, className = 'text-accent bg-accent-soft' }: BadgeProps) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${className}`}>
      {children}
    </span>
  );
}
