/**
 * PhasePipeline — horizontal timeline showing the sequence of phases a job
 * passed through (or is passing through). Current phase pulses in the job's
 * signature color; completed phases are dim; future phases (when `allPhases`
 * is provided) render muted.
 *
 * Extracted from ActivityEntry.tsx (audit UI-01).
 */

const PHASE_DOT: Record<string, string> = {
  observe: 'bg-blue',
  cleanup: 'bg-text-muted',
  analyze: 'bg-purple',
  suggest: 'bg-green',
  notify: 'bg-text-muted',
  consolidate: 'bg-orange',
  'layer-maintenance': 'bg-orange',
  corrections: 'bg-yellow-400',
  merge: 'bg-amber-400',
  'meta-patterns': 'bg-orange',
  reflect: 'bg-blue',
  'reflect-delta': 'bg-blue',
  'reflect-evolve': 'bg-purple',
  enrich: 'bg-amber-400',
  discover: 'bg-indigo-400',
  'remote-sync': 'bg-pink-400',
  'repo-profile': 'bg-teal-400',
  scan: 'bg-green-600',
  profile: 'bg-emerald-400',
  digest: 'bg-cyan',
  prepare: 'bg-sky-400',
  summarize: 'bg-amber-400',
  extract: 'bg-purple',
  evaluate: 'bg-sky-500',
  apply: 'bg-sky-300',
  validate: 'bg-green-400',
  'digest-daily': 'bg-cyan-400',
  'digest-weekly': 'bg-cyan-400',
  'digest-brag': 'bg-cyan-400',
  // Run phases
  preparing: 'bg-text-muted',
  planning: 'bg-indigo-400',
  evaluating: 'bg-sky-400',
  executing: 'bg-fuchsia-400',
  verifying: 'bg-green-400',
};

const PHASE_TEXT: Record<string, string> = {
  observe: 'text-blue',
  cleanup: 'text-text-muted',
  analyze: 'text-purple',
  suggest: 'text-green',
  notify: 'text-text-muted',
  consolidate: 'text-orange',
  'layer-maintenance': 'text-orange',
  corrections: 'text-yellow-400',
  merge: 'text-amber-400',
  'meta-patterns': 'text-orange',
  reflect: 'text-blue',
  'reflect-delta': 'text-blue',
  'reflect-evolve': 'text-purple',
  enrich: 'text-amber-400',
  discover: 'text-indigo-400',
  'remote-sync': 'text-pink-400',
  'repo-profile': 'text-teal-400',
  scan: 'text-green-600',
  profile: 'text-emerald-400',
  digest: 'text-cyan',
  prepare: 'text-sky-400',
  summarize: 'text-amber-400',
  extract: 'text-purple',
  evaluate: 'text-sky-500',
  apply: 'text-sky-300',
  validate: 'text-green-400',
  'digest-daily': 'text-cyan-400',
  'digest-weekly': 'text-cyan-400',
  'digest-brag': 'text-cyan-400',
  // Run phases
  preparing: 'text-text-muted',
  planning: 'text-indigo-300',
  evaluating: 'text-sky-300',
  executing: 'text-fuchsia-300',
  verifying: 'text-green-300',
};

/** Job type → active phase color (dot + text). Active phase pulses in the job's color, not its own. */
const JOB_ACTIVE_DOT: Record<string, string> = {
  heartbeat: 'bg-purple-400',
  suggest: 'bg-green-400',
  'suggest-deep': 'bg-green-500',
  'suggest-project': 'bg-emerald-400',
  consolidate: 'bg-orange-400',
  reflect: 'bg-blue-400',
  'remote-sync': 'bg-pink-400',
  'repo-profile': 'bg-teal-400',
  'project-profile': 'bg-emerald-400',
  'context-enrich': 'bg-amber-400',
  'mcp-discover': 'bg-indigo-400',
  'digest-daily': 'bg-cyan-400',
  'digest-weekly': 'bg-cyan-400',
  'digest-brag': 'bg-cyan-400',
  'revalidate-suggestion': 'bg-sky-400',
  'auto-plan': 'bg-lime-400',
  'auto-execute': 'bg-rose-400',
  // Run types
  'run:plan': 'bg-indigo-400',
  'run:execute': 'bg-fuchsia-400',
};
const JOB_ACTIVE_TEXT: Record<string, string> = {
  heartbeat: 'text-purple-300',
  suggest: 'text-green-300',
  'suggest-deep': 'text-green-400',
  'suggest-project': 'text-emerald-300',
  consolidate: 'text-orange-300',
  reflect: 'text-blue-300',
  'remote-sync': 'text-pink-300',
  'repo-profile': 'text-teal-300',
  'project-profile': 'text-emerald-300',
  'context-enrich': 'text-amber-300',
  'mcp-discover': 'text-indigo-300',
  'digest-daily': 'text-cyan-300',
  'digest-weekly': 'text-cyan-300',
  'digest-brag': 'text-cyan-300',
  'revalidate-suggestion': 'text-sky-300',
  'auto-plan': 'text-lime-300',
  'auto-execute': 'text-rose-300',
  // Run types
  'run:plan': 'text-indigo-300',
  'run:execute': 'text-fuchsia-300',
};

export const RUN_PLAN_PHASES = ['preparing', 'planning', 'evaluating'];
export const RUN_EXEC_PHASES = ['preparing', 'executing', 'verifying'];

export const JOB_PHASES: Record<string, string[]> = {
  heartbeat: ['prepare', 'summarize', 'extract', 'cleanup', 'observe', 'notify'],
  suggest: ['suggest', 'notify'],
  consolidate: ['layer-maintenance', 'meta-patterns', 'knowledge-summary', 'corrections', 'merge'],
  reflect: ['reflect-delta', 'reflect-evolve'],
  'remote-sync': ['remote-sync'],
  'repo-profile': ['repo-profile'],
  'suggest-deep': ['scan', 'validate', 'notify'],
  'suggest-project': ['analyze', 'validate', 'notify'],
  'project-profile': ['profile'],
  'context-enrich': ['enrich'],
  'mcp-discover': ['discover'],
  'digest-daily': ['digest'],
  'digest-weekly': ['digest'],
  'digest-brag': ['digest'],
  'revalidate-suggestion': ['prepare', 'evaluate', 'apply'],
  'auto-plan': ['filtering', 'revalidating', 'planning'],
  'auto-execute': ['filtering', 'executing', 'verifying'],
  'pr-sync': ['pr-sync'],
};

function interestingPhases(phases: string[]): string[] {
  return phases.filter((p) => !['wake', 'idle', 'notify'].includes(p));
}

export function PhasePipeline({ phases, currentPhase, allPhases, jobType }: { phases: string[]; currentPhase?: string; allPhases?: string[]; jobType?: string }) {
  const displayPhases = allPhases ?? interestingPhases(phases);
  if (displayPhases.length === 0) return null;

  return (
    <div className="flex items-center gap-0 mb-2">
      {displayPhases.map((phase, i) => {
        // Match "remote-sync: shadow (1/13)" against "remote-sync"
        const isCurrent = currentPhase === phase || (currentPhase?.startsWith(phase + ':') ?? false) || (currentPhase?.startsWith(phase + ' ') ?? false);
        const isCompleted = !allPhases || phases.includes(phase);
        const isFuture = allPhases && !isCompleted && !isCurrent;
        // Extract detail from phase like "enrich: Flyte (2/3)" → "Flyte (2/3)"
        const detail = isCurrent && currentPhase && currentPhase !== phase
          ? currentPhase.slice(phase.length).replace(/^[:\s]+/, '')
          : undefined;
        // Active phase: job color. Completed (no active phase): uniform dim. Future: muted.
        const jobDone = !currentPhase;
        const dotColor = isCurrent && jobType
          ? (JOB_ACTIVE_DOT[jobType] ?? 'bg-text-muted')
          : isFuture ? 'bg-border'
          : jobDone ? 'bg-text-muted' : (PHASE_DOT[phase] ?? 'bg-text-muted');
        const textColor = isCurrent && jobType
          ? (JOB_ACTIVE_TEXT[jobType] ?? 'text-text-muted')
          : isFuture ? 'text-text-muted/40'
          : jobDone ? 'text-text-muted' : (PHASE_TEXT[phase] ?? 'text-text-muted');
        return (
          <div key={phase} className="flex items-center">
            {i > 0 && <div className={`w-4 h-px ${isFuture ? 'bg-border/50' : 'bg-border'} mx-0.5`} />}
            <div className={`flex items-center gap-1 ${isCurrent ? 'animate-pulse' : ''}`}>
              <div className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
              <span className={`text-[10px] ${textColor}`}>{phase}{detail ? ` (${detail})` : ''}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
