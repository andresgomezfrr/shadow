/** Single source of truth for suggestion kinds — badge, filter tab, and dot colors. */
const SUG_KINDS = {
  refactor:    { label: 'Refactor',    badge: 'bg-purple-500/20 text-purple-300', dot: 'bg-purple-400', active: 'bg-purple-500/15 text-purple-300' },
  bug:         { label: 'Bug',         badge: 'bg-red-500/20 text-red-300',       dot: 'bg-red-400',    active: 'bg-red-500/15 text-red-300' },
  improvement: { label: 'Improvement', badge: 'bg-blue-500/20 text-blue-300',     dot: 'bg-blue-400',   active: 'bg-blue-500/15 text-blue-300' },
  feature:     { label: 'Feature',     badge: 'bg-green-500/20 text-green-300',   dot: 'bg-green-400',  active: 'bg-green-500/15 text-green-300' },
} as const;

/** Canonical suggestion kind → badge color map (derived). */
export const SUG_KIND_COLORS: Record<string, string> =
  Object.fromEntries(Object.entries(SUG_KINDS).map(([k, v]) => [k, v.badge]));

export const SUG_KIND_COLOR_DEFAULT = 'text-text-dim bg-border';

/** FilterTabs options for suggestion kinds (derived). */
export const SUG_KIND_OPTIONS = [
  { label: 'All', value: '' },
  ...Object.entries(SUG_KINDS).map(([k, v]) => ({
    label: v.label, value: k, dotColor: v.dot, activeClass: v.active,
  })),
];

/** Suggestion status → left border color. */
export const SUG_STATUS_BORDER: Record<string, string> = {
  open: 'border-l-orange',
  snoozed: 'border-l-blue',
  accepted: 'border-l-green',
  dismissed: 'border-l-text-muted',
  expired: 'border-l-text-muted',
};
