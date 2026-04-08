/** Canonical observation kind → badge color map. */
export const OBS_KIND_COLORS: Record<string, string> = {
  risk: 'bg-red-500/20 text-red-300',
  improvement: 'bg-blue-500/20 text-blue-300',
  opportunity: 'bg-green-500/20 text-green-300',
  pattern: 'bg-purple-500/20 text-purple-300',
  infrastructure: 'bg-orange-500/20 text-orange-300',
  cross_project: 'bg-emerald-400/20 text-emerald-300',
};

export const OBS_KIND_COLOR_DEFAULT = 'text-text-dim bg-border';

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
