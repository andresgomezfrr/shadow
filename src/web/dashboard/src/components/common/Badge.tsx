type BadgeProps = {
  children: React.ReactNode;
  className?: string;
  title?: string;
};

export function Badge({ children, className = 'text-accent bg-accent-soft', title }: BadgeProps) {
  if (title) {
    return (
      <span className={`relative group inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${className}`}>
        {children}
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 rounded text-[11px] font-normal bg-text text-bg whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50">
          {title}
        </span>
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${className}`}>
      {children}
    </span>
  );
}
