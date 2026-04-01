type SearchInputProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
};

export function SearchInput({ value, onChange, placeholder = 'Search...' }: SearchInputProps) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="bg-bg border border-border rounded-lg px-3.5 py-2 text-text text-[13px] w-full max-w-[360px] outline-none transition-colors focus:border-accent placeholder:text-text-muted"
    />
  );
}
