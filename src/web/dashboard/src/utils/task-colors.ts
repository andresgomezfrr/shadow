/** Single source of truth for task status colors. */

export const TASK_STATUS_COLORS: Record<string, string> = {
  open: 'text-text-muted bg-border',
  active: 'text-blue bg-blue/15',
  blocked: 'text-red bg-red/15',
  done: 'text-green bg-green/15',
};

export const TASK_STATUS_COLOR_DEFAULT = 'text-text-dim bg-border';

/** Feed variant — teal palette for workspace feed cards. */
export const TASK_FEED_STATUS_COLORS: Record<string, string> = {
  open: 'text-teal-300 bg-teal-500/15',
  active: 'text-teal-300 bg-teal-500/15',
  blocked: 'text-red bg-red/15',
  done: 'text-teal-600 bg-teal-500/10',
};

export const TASK_FEED_STATUS_BORDER: Record<string, string> = {
  open: 'border-l-teal-500/50',
  active: 'border-l-teal-400',
  blocked: 'border-l-red',
  done: 'border-l-teal-600/40',
};
