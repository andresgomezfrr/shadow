/** Single source of truth for run status visual config. */

export const RUN_STATUS_BORDER: Record<string, string> = {
  queued: 'border-l-orange',
  running: 'border-l-blue',
  planned: 'border-l-green',
  done: 'border-l-purple',
  dismissed: 'border-l-text-muted',
  failed: 'border-l-red',
};

export const RUN_STATUS_ICON: Record<string, string> = {
  queued: '○',
  running: '⟳',
  planned: '✓',
  done: '✓',
  dismissed: '—',
  failed: '✕',
};

export const RUN_STATUS_ICON_COLOR: Record<string, string> = {
  queued: 'text-orange',
  running: 'text-blue animate-spin',
  planned: 'text-green',
  done: 'text-purple',
  dismissed: 'text-text-muted',
  failed: 'text-red',
};
