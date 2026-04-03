type Props = {
  total: number;
  offset: number;
  limit: number;
  onChange: (offset: number) => void;
};

export function Pagination({ total, offset, limit, onChange }: Props) {
  if (total <= limit) return null;

  const page = Math.floor(offset / limit) + 1;
  const totalPages = Math.ceil(total / limit);

  return (
    <div className="flex items-center justify-center gap-3 mt-4 text-xs text-text-muted">
      <button
        disabled={page <= 1}
        onClick={() => onChange(Math.max(0, offset - limit))}
        className="px-2 py-1 rounded bg-card border border-border hover:border-accent disabled:opacity-30 disabled:cursor-default transition-colors"
      >
        Prev
      </button>
      <span>{page} / {totalPages}</span>
      <button
        disabled={page >= totalPages}
        onClick={() => onChange(offset + limit)}
        className="px-2 py-1 rounded bg-card border border-border hover:border-accent disabled:opacity-30 disabled:cursor-default transition-colors"
      >
        Next
      </button>
    </div>
  );
}
