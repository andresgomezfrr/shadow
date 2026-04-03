type FilterOption = {
  label: string;
  value: string;
  activeClass?: string;   // custom active style (e.g. 'bg-green/15 text-green')
  dotColor?: string;      // colored dot before label (e.g. 'bg-green')
};

type FilterTabsProps = {
  options: FilterOption[];
  active: string;
  onChange: (value: string) => void;
};

export function FilterTabs({ options, active, onChange }: FilterTabsProps) {
  return (
    <div className="flex gap-1 flex-wrap">
      {options.map((opt) => {
        const isActive = active === opt.value;
        const activeStyle = opt.activeClass ?? 'bg-accent-soft text-accent';
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`px-3.5 py-1 rounded-2xl text-xs cursor-pointer border-none transition-all inline-flex items-center gap-1.5 ${
              isActive ? activeStyle : 'bg-border text-text-dim hover:text-text'
            }`}
          >
            {opt.dotColor && <span className={`w-1.5 h-1.5 rounded-full ${opt.dotColor}`} />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
