/** Canonical job type → badge color map. Single source of truth for all pages. */
export const JOB_TYPE_COLORS: Record<string, string> = {
  heartbeat: 'bg-purple-500/20 text-purple-300',
  suggest: 'bg-green-500/20 text-green-300',
  'suggest-deep': 'bg-green-600/20 text-green-400',
  'suggest-project': 'bg-emerald-400/20 text-emerald-300',
  consolidate: 'bg-orange-500/20 text-orange-300',
  reflect: 'bg-blue-500/20 text-blue-300',
  'remote-sync': 'bg-pink-400/20 text-pink-300',
  'repo-profile': 'bg-teal-400/20 text-teal-300',
  'project-profile': 'bg-emerald-400/20 text-emerald-300',
  'context-enrich': 'bg-amber-400/20 text-amber-300',
  'mcp-discover': 'bg-indigo-400/20 text-indigo-300',
  'digest-daily': 'bg-cyan-500/20 text-cyan-300',
  'digest-weekly': 'bg-cyan-500/20 text-cyan-300',
  'digest-brag': 'bg-cyan-500/20 text-cyan-300',
  'revalidate-suggestion': 'bg-sky-400/20 text-sky-300',
  'auto-plan': 'bg-lime-500/20 text-lime-300',
  'auto-execute': 'bg-rose-500/20 text-rose-300',
  'run:plan': 'bg-indigo-500/20 text-indigo-300',
  'run:execute': 'bg-fuchsia-500/20 text-fuchsia-300',
};

export const JOB_TYPE_COLOR_DEFAULT = 'text-text-dim bg-border';
