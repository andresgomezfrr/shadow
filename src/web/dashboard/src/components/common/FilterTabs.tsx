type FilterTabsProps = {
  options: { label: string; value: string }[];
  active: string;
  onChange: (value: string) => void;
};

export function FilterTabs({ options, active, onChange }: FilterTabsProps) {
  return (
    <div className="flex gap-1 flex-wrap">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-3.5 py-1 rounded-2xl text-xs cursor-pointer border-none transition-all ${
            active === opt.value
              ? 'bg-accent-soft text-accent'
              : 'bg-border text-text-dim hover:text-text'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
