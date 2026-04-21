import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Toast notification system — non-blocking feedback for actions.
 *
 * Replaces native window.alert() (see audit UI-02) and provides a building
 * block for success/info/warn feedback across the app. Rendered via React
 * Portal to document.body (consistent with Dialog) to escape ancestor
 * transforms.
 *
 * Usage:
 *   const toast = useToast();
 *   toast.error('Failed to create PR: ' + err.message);
 *   toast.success('Task created');
 *
 * Durations (default): success/info 4s, warn 5s, error 6s. Hover pauses
 * auto-dismiss. Click ✕ dismisses manually.
 */

type ToastKind = 'success' | 'error' | 'info' | 'warn';

type ToastItem = {
  id: string;
  kind: ToastKind;
  message: string;
  durationMs: number;
};

type ToastAPI = {
  success: (message: string, opts?: { durationMs?: number }) => void;
  error: (message: string, opts?: { durationMs?: number }) => void;
  info: (message: string, opts?: { durationMs?: number }) => void;
  warn: (message: string, opts?: { durationMs?: number }) => void;
};

const DEFAULT_DURATIONS: Record<ToastKind, number> = {
  success: 4000,
  info: 4000,
  warn: 5000,
  error: 6000,
};

const ToastCtx = createContext<ToastAPI | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((kind: ToastKind, message: string, durationMs?: number) => {
    const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const effective = durationMs ?? DEFAULT_DURATIONS[kind];
    setToasts((prev) => [...prev, { id, kind, message, durationMs: effective }]);
  }, []);

  const api: ToastAPI = {
    success: (m, o) => push('success', m, o?.durationMs),
    error: (m, o) => push('error', m, o?.durationMs),
    info: (m, o) => push('info', m, o?.durationMs),
    warn: (m, o) => push('warn', m, o?.durationMs),
  };

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </ToastCtx.Provider>
  );
}

export function useToast(): ToastAPI {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
  return ctx;
}

// ---------------------------------------------------------------------------

function ToastContainer({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: string) => void }) {
  if (toasts.length === 0) return null;
  const ui = (
    <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 max-w-sm pointer-events-none">
      {toasts.map((t) => (
        <ToastRow key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  );
  return createPortal(ui, document.body);
}

const KIND_STYLES: Record<ToastKind, { bg: string; border: string; icon: string; iconClass: string }> = {
  success: { bg: 'bg-green/10', border: 'border-green/40', icon: '✓', iconClass: 'text-green' },
  error: { bg: 'bg-red/10', border: 'border-red/40', icon: '✕', iconClass: 'text-red' },
  info: { bg: 'bg-blue/10', border: 'border-blue/40', icon: 'i', iconClass: 'text-blue' },
  warn: { bg: 'bg-orange/10', border: 'border-orange/40', icon: '!', iconClass: 'text-orange' },
};

function ToastRow({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  const [paused, setPaused] = useState(false);
  const remainingRef = useRef(toast.durationMs);
  const startedAtRef = useRef(Date.now());

  useEffect(() => {
    if (paused) {
      // Persist remaining time when paused
      remainingRef.current -= Date.now() - startedAtRef.current;
      return;
    }
    startedAtRef.current = Date.now();
    const timer = setTimeout(onDismiss, Math.max(0, remainingRef.current));
    return () => clearTimeout(timer);
  }, [paused, onDismiss]);

  const style = KIND_STYLES[toast.kind];

  return (
    <div
      role="alert"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className={`pointer-events-auto ${style.bg} ${style.border} border rounded-lg px-3 py-2 shadow-lg flex items-start gap-2 animate-fade-in backdrop-blur-sm`}
    >
      <span className={`${style.iconClass} text-sm font-bold shrink-0 w-4 text-center leading-5`} aria-hidden="true">{style.icon}</span>
      <span className="text-xs text-text flex-1 break-words leading-5">{toast.message}</span>
      <button
        onClick={onDismiss}
        className="text-text-muted hover:text-text bg-transparent border-none cursor-pointer text-xs shrink-0 leading-5"
        aria-label="Dismiss"
      >✕</button>
    </div>
  );
}
