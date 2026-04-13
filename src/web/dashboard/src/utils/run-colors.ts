/** Single source of truth for run status visual config. */

export const RUN_STATUS_BORDER: Record<string, string> = {
  queued: 'border-l-orange',
  running: 'border-l-blue',
  planned: 'border-l-green',
  awaiting_pr: 'border-l-fuchsia-500',
  done: 'border-l-purple',
  dismissed: 'border-l-text-muted',
  failed: 'border-l-red',
};

export const RUN_STATUS_ICON: Record<string, string> = {
  queued: '○',
  running: '⟳',
  planned: '✓',
  awaiting_pr: '⏳',
  done: '✓',
  dismissed: '—',
  failed: '✕',
};

export const RUN_STATUS_ICON_COLOR: Record<string, string> = {
  queued: 'text-orange',
  running: 'text-blue animate-spin',
  planned: 'text-green',
  awaiting_pr: 'text-fuchsia-300',
  done: 'text-purple',
  dismissed: 'text-text-muted',
  failed: 'text-red',
};
