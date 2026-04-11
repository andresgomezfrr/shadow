/** Single source of truth for project kind and status colors. */

export const PROJECT_KIND_COLORS: Record<string, string> = {
  'long-term': 'text-blue bg-blue/15',
  sprint: 'text-orange bg-orange/15',
  task: 'text-green bg-green/15',
};

export const PROJECT_KIND_COLOR_DEFAULT = 'text-text-dim bg-text-dim/15';

export const PROJECT_STATUS_COLORS: Record<string, string> = {
  active: 'text-green bg-green/15',
  completed: 'text-text-dim bg-text-dim/15',
  'on-hold': 'text-orange bg-orange/15',
  archived: 'text-text-dim bg-text-dim/10',
};

export const PROJECT_STATUS_COLOR_DEFAULT = 'text-text-dim bg-text-dim/15';
