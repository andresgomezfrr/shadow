import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useToast, ToastProvider } from './Toast';

/**
 * Tests for the Toast system (audit obs 6052e0a9).
 *
 * The provider renders via a Portal to document.body, so the toast row lives
 * outside the component tree returned by render(). Queries use `screen.*`
 * which searches the whole document, matching the Portal-rendered subtree.
 *
 * Timers are faked (vi.useFakeTimers) so auto-dismiss + hover-pause can be
 * verified deterministically without sleeps.
 */

function TriggerButton({ kind, message, durationMs }: { kind: 'success' | 'error' | 'info' | 'warn'; message: string; durationMs?: number }) {
  const toast = useToast();
  return (
    <button onClick={() => toast[kind](message, durationMs ? { durationMs } : undefined)}>
      fire {kind}
    </button>
  );
}

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders a toast in the portal when useToast.error() is called', () => {
    render(
      <ToastProvider>
        <TriggerButton kind="error" message="failed to create PR" />
      </ToastProvider>,
    );
    expect(screen.queryByRole('alert')).toBeNull();
    act(() => {
      screen.getByRole('button', { name: /fire error/ }).click();
    });
    const toast = screen.getByRole('alert');
    expect(toast).toBeInTheDocument();
    expect(toast).toHaveTextContent('failed to create PR');
  });

  it('auto-dismisses after durationMs elapses', () => {
    render(
      <ToastProvider>
        <TriggerButton kind="info" message="session ready" durationMs={2000} />
      </ToastProvider>,
    );
    act(() => {
      screen.getByRole('button', { name: /fire info/ }).click();
    });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1999); });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(2); });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('dismisses immediately when the ✕ button is clicked', () => {
    render(
      <ToastProvider>
        <TriggerButton kind="warn" message="degraded fallback" durationMs={10000} />
      </ToastProvider>,
    );
    act(() => {
      screen.getByRole('button', { name: /fire warn/ }).click();
    });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    act(() => {
      screen.getByRole('button', { name: /Dismiss/ }).click();
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('stacks multiple toasts and they dismiss independently', () => {
    render(
      <ToastProvider>
        <TriggerButton kind="success" message="task created" durationMs={4000} />
        <TriggerButton kind="error" message="PR failed" durationMs={6000} />
      </ToastProvider>,
    );
    act(() => {
      screen.getByRole('button', { name: /fire success/ }).click();
      screen.getByRole('button', { name: /fire error/ }).click();
    });
    expect(screen.getAllByRole('alert')).toHaveLength(2);

    // After 4s, only the success toast dismissed; error still up.
    act(() => { vi.advanceTimersByTime(4001); });
    const remaining = screen.getAllByRole('alert');
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toHaveTextContent('PR failed');
  });
});
