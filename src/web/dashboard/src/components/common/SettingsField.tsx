import type { ReactNode } from 'react';

type SettingsFieldProps = {
  label: string;
  description?: string;
  saved: string | null;
  fieldKey: string;
  children: ReactNode;
};

export function SaveIndicator({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span className="text-xs text-green ml-2 animate-fade-in">✓ Saved</span>
  );
}

export function SettingsField({ label, description, saved, fieldKey, children }: SettingsFieldProps) {
  return (
    <div>
      <label className="text-sm font-medium block mb-1">
        {label}
        <SaveIndicator show={saved === fieldKey} />
      </label>
      {description && <p className="text-xs text-text-dim mb-2">{description}</p>}
      {children}
    </div>
  );
}
