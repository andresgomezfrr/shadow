import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Custom dialogs replacing native window.prompt/confirm/alert — those break the
 * dark theme, can't be styled, and are non-dismissable by JS. See audit UI-02.
 *
 * Rendered via React Portal to `document.body` to escape ancestor transforms
 * (same technique as ChronicleLightbox — AppShell wraps children in a div with
 * CSS transform which breaks `position: fixed` otherwise).
 *
 * Prefer the `useDialog()` hook in hooks/useDialog.ts over wiring these directly.
 */

type DialogShellProps = {
  title?: string;
  onClose: () => void;
  children: React.ReactNode;
};

function DialogShell({ title, onClose, children }: DialogShellProps) {
  // ESC closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const ui = (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-lg shadow-2xl p-5 w-full max-w-md mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {title && <div className="text-sm font-semibold text-text mb-3">{title}</div>}
        {children}
      </div>
    </div>
  );

  return createPortal(ui, document.body);
}

// ---------------------------------------------------------------------------
// ConfirmDialog — binary yes/no
// ---------------------------------------------------------------------------

type ConfirmProps = {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'danger';
  onResolve: (confirmed: boolean) => void;
};

export function ConfirmDialog({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', variant = 'default', onResolve }: ConfirmProps) {
  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { confirmBtnRef.current?.focus(); }, []);

  const confirmClass = variant === 'danger'
    ? 'bg-red/15 text-red hover:bg-red/25'
    : 'bg-accent/15 text-accent hover:bg-accent/25';

  return (
    <DialogShell title={title} onClose={() => onResolve(false)}>
      <div className="text-sm text-text-dim mb-4">{message}</div>
      <div className="flex justify-end gap-2">
        <button
          onClick={() => onResolve(false)}
          className="px-3 py-1.5 text-xs rounded bg-border text-text-muted hover:bg-border/60 border-none cursor-pointer"
        >
          {cancelLabel}
        </button>
        <button
          ref={confirmBtnRef}
          onClick={() => onResolve(true)}
          className={`px-3 py-1.5 text-xs rounded border-none cursor-pointer ${confirmClass}`}
        >
          {confirmLabel}
        </button>
      </div>
    </DialogShell>
  );
}

// ---------------------------------------------------------------------------
// InputDialog — prompt with text field; submit or cancel (returns null on cancel)
// ---------------------------------------------------------------------------

type InputProps = {
  title?: string;
  message: string;
  placeholder?: string;
  initialValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  multiline?: boolean;
  onResolve: (value: string | null) => void;
};

export function InputDialog({ title, message, placeholder, initialValue = '', confirmLabel = 'Submit', cancelLabel = 'Cancel', multiline = false, onResolve }: InputProps) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    onResolve(value);
  };

  return (
    <DialogShell title={title} onClose={() => onResolve(null)}>
      <form onSubmit={handleSubmit}>
        <div className="text-sm text-text-dim mb-3">{message}</div>
        {multiline ? (
          <textarea
            ref={inputRef as React.Ref<HTMLTextAreaElement>}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            rows={3}
            className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text focus:outline-none focus:border-accent resize-none mb-4"
          />
        ) : (
          <input
            ref={inputRef as React.Ref<HTMLInputElement>}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text focus:outline-none focus:border-accent mb-4"
          />
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onResolve(null)}
            className="px-3 py-1.5 text-xs rounded bg-border text-text-muted hover:bg-border/60 border-none cursor-pointer"
          >
            {cancelLabel}
          </button>
          <button
            type="submit"
            className="px-3 py-1.5 text-xs rounded bg-accent/15 text-accent hover:bg-accent/25 border-none cursor-pointer"
          >
            {confirmLabel}
          </button>
        </div>
      </form>
    </DialogShell>
  );
}
