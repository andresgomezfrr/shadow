/** Single source of truth for observation kinds — badge, filter tab, and dot colors. */
const OBS_KINDS = {
  risk:           { label: 'Risk',           badge: 'bg-red-500/20 text-red-300',     dot: 'bg-red-400',     active: 'bg-red-500/15 text-red-300' },
  improvement:    { label: 'Improvement',    badge: 'bg-blue-500/20 text-blue-300',    dot: 'bg-blue-400',    active: 'bg-blue-500/15 text-blue-300' },
  opportunity:    { label: 'Opportunity',    badge: 'bg-green-500/20 text-green-300',   dot: 'bg-green-400',   active: 'bg-green-500/15 text-green-300' },
  pattern:        { label: 'Pattern',        badge: 'bg-purple-500/20 text-purple-300', dot: 'bg-purple-400',  active: 'bg-purple-500/15 text-purple-300' },
  infrastructure: { label: 'Infrastructure', badge: 'bg-orange-500/20 text-orange-300', dot: 'bg-orange-400',  active: 'bg-orange-500/15 text-orange-300' },
  cross_project:  { label: 'Cross-project',  badge: 'bg-emerald-400/20 text-emerald-300', dot: 'bg-emerald-400', active: 'bg-emerald-400/15 text-emerald-300' },
} as const;

/** Canonical observation kind → badge color map (derived). */
export const OBS_KIND_COLORS: Record<string, string> =
  Object.fromEntries(Object.entries(OBS_KINDS).map(([k, v]) => [k, v.badge]));

export const OBS_KIND_COLOR_DEFAULT = 'text-text-dim bg-border';

/** FilterTabs options for observation kinds (derived). */
export const OBS_KIND_OPTIONS = [
  { label: 'All', value: '' },
  ...Object.entries(OBS_KINDS).map(([k, v]) => ({
    label: v.label, value: k, dotColor: v.dot, activeClass: v.active,
  })),
];

/** Severity → left border color. */
export const OBS_SEVERITY_BORDER: Record<string, string> = {
  high: 'border-l-red',
  warning: 'border-l-orange',
  info: 'border-l-blue',
};

/** Severity → icon character. */
export const OBS_SEVERITY_ICON: Record<string, string> = {
  high: '●',
  warning: '▲',
  info: '○',
};

/** Severity → icon text color. */
export const OBS_SEVERITY_ICON_COLOR: Record<string, string> = {
  high: 'text-red',
  warning: 'text-orange',
  info: 'text-blue',
};
