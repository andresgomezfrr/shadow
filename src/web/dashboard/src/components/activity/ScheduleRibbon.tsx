import { useState, useCallback } from 'react';
import { useNow, formatCountdown } from '../../utils/format';
import { useApi } from '../../hooks/useApi';
import { useRunningJobs } from '../../hooks/useRunningJobs';
import { JOB_TYPE_COLORS, JOB_TYPE_COLOR_DEFAULT } from '../../utils/job-colors';
import { Badge } from '../common/Badge';
import { triggerJob, triggerJobWithParams, fetchRepos, fetchProjects } from '../../api/client';
import { POLL_SLOW } from '../../constants/polling';

type ScheduleEntry = {
  intervalMs?: number;
  nextAt?: string | null;
  trigger?: string;
  schedule?: string;
  enabled?: boolean;
};

type Props = {
  schedule: Record<string, ScheduleEntry> | undefined;
  onTrigger?: () => void;
};

const TRIGGER_COLORS: Record<string, string> = {
  heartbeat: 'bg-purple-500/15 text-purple-300 hover:bg-purple-500/25',
  suggest: 'bg-green-500/15 text-green-300 hover:bg-green-500/25',
  'suggest-deep': 'bg-green-600/15 text-green-400 hover:bg-green-600/25',
  'suggest-project': 'bg-emerald-400/15 text-emerald-300 hover:bg-emerald-400/25',
  consolidate: 'bg-orange-500/15 text-orange-300 hover:bg-orange-500/25',
  reflect: 'bg-blue-500/15 text-blue-300 hover:bg-blue-500/25',
  'remote-sync': 'bg-pink-400/15 text-pink-300 hover:bg-pink-400/25',
  'repo-profile': 'bg-teal-400/15 text-teal-300 hover:bg-teal-400/25',
  'project-profile': 'bg-emerald-400/15 text-emerald-300 hover:bg-emerald-400/25',
  'context-enrich': 'bg-amber-400/15 text-amber-300 hover:bg-amber-400/25',
  'mcp-discover': 'bg-indigo-400/15 text-indigo-300 hover:bg-indigo-400/25',
  'digest-daily': 'bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25',
  'digest-weekly': 'bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25',
  'digest-brag': 'bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25',
  'auto-plan': 'bg-lime-500/15 text-lime-300 hover:bg-lime-500/25',
  'auto-execute': 'bg-rose-500/15 text-rose-300 hover:bg-rose-500/25',
  cleanup: 'bg-slate-400/15 text-slate-300 hover:bg-slate-400/25',
  'pr-sync': 'bg-stone-400/15 text-stone-300 hover:bg-stone-400/25',
  'version-check': 'bg-gray-400/15 text-gray-300 hover:bg-gray-400/25',
};

const JOB_GROUPS: Array<{ label: string; jobs: string[] }> = [
  { label: 'Analysis', jobs: ['heartbeat', 'suggest', 'suggest-deep', 'suggest-project'] },
  { label: 'Knowledge', jobs: ['consolidate', 'reflect'] },
  { label: 'Sync', jobs: ['remote-sync', 'repo-profile', 'project-profile', 'context-enrich', 'mcp-discover'] },
  { label: 'Autonomy', jobs: ['auto-plan', 'auto-execute'] },
  { label: 'Digests', jobs: ['digest-daily', 'digest-weekly', 'digest-brag'] },
  { label: 'Maintenance', jobs: ['pr-sync', 'cleanup', 'version-check'] },
];

const ALL_JOBS = JOB_GROUPS.flatMap(g => g.jobs);

const JOB_DESCRIPTIONS: Record<string, string> = {
  heartbeat: 'Discovers active projects, extracts memories, generates observations',
  suggest: 'Incremental: analyzes recent changes in active repos (reactive post-heartbeat)',
  'suggest-deep': 'Full scan: deep codebase review — architecture, tech debt, features (20+ commits or 7d)',
  'suggest-project': 'Cross-repo: finds opportunities across project repos (reactive after deep scan)',
  consolidate: 'Promotes/demotes memories between layers, synthesizes meta-patterns',
  reflect: '2-phase soul reflection: extract deltas (Sonnet) → evolve soul (Opus)',
  'remote-sync': 'Lightweight git ls-remote to detect remote changes across repos',
  'repo-profile': 'Reactive: re-profiles repos when new commits detected — remote (via sync) or local (via heartbeat)',
  'project-profile': 'Reactive: synthesizes cross-repo project context when repos are re-profiled',
  'context-enrich': 'Queries external MCP servers for deployment, CI/CD, calendar data',
  'mcp-discover': 'Describes MCP servers from tool schemas (Sonnet, daily)',
  'digest-daily': 'Daily standup summary (3-5 bullets)',
  'digest-weekly': 'Weekly 1:1 summary from daily digests',
  'digest-brag': 'Quarterly brag doc for performance reviews',
  'auto-plan': 'Scans mature suggestions, revalidates against code, creates plan runs (every 3h)',
  'auto-execute': 'Executes planned runs with high confidence + zero doubts (every 3h, offset 1.5h)',
  cleanup: 'Purges rows > 90d from interactions/event_queue/llm_usage/jobs; rolls up llm_usage_daily first',
  'pr-sync': 'Polls gh pr view for awaiting_pr runs and finalizes parent on merge/close (batched, every 30min)',
  'version-check': 'Compares local package.json version against remote git tags; emits event on new release (every 12h)',
};

function intervalLabel(entry: ScheduleEntry): string {
  if (entry.schedule) return entry.schedule;
  if (entry.intervalMs) {
    const hours = entry.intervalMs / 3_600_000;
    if (hours >= 1) return `every ${hours}h`;
    return `every ${entry.intervalMs / 60_000}m`;
  }
  return 'on demand';
}

const REPO_JOBS = new Set(['suggest', 'suggest-deep', 'repo-profile', 'remote-sync']);
const PROJECT_JOBS = new Set(['suggest-project', 'project-profile']);

export function ScheduleRibbon({ schedule, onTrigger }: Props) {
  const now = useNow();
  const [expanded, setExpanded] = useState(false);
  const [selectorFor, setSelectorFor] = useState<string | null>(null);
  const { isRunning, refresh: refreshRunning } = useRunningJobs();

  const { data: repos } = useApi(fetchRepos, [], POLL_SLOW);
  const { data: projects } = useApi(() => fetchProjects(), [], POLL_SLOW);

  const handleTriggerJob = useCallback(async (jobType: string, params?: Record<string, string>) => {
    const result = params
      ? await triggerJobWithParams(jobType, params)
      : await triggerJob(jobType);
    if (result) {
      setSelectorFor(null);
      // Refresh running jobs immediately so the button flips to "Running..." without waiting
      // for the 30s poll. /api/jobs/running includes status='queued', so newly-enqueued
      // jobs are picked up right away (status becomes running once the queue tick claims them).
      await refreshRunning();
      onTrigger?.();
    }
  }, [onTrigger, refreshRunning]);

  const handleTriggerClick = useCallback((jobType: string) => {
    if (REPO_JOBS.has(jobType) || PROJECT_JOBS.has(jobType)) {
      setSelectorFor(prev => prev === jobType ? null : jobType);
    } else {
      handleTriggerJob(jobType);
    }
  }, [handleTriggerJob]);

  if (!schedule) return null;

  // Sort entries by next-at for the collapsed preview
  const sorted = ALL_JOBS
    .filter((k) => schedule[k]?.nextAt)
    .sort((a, b) => {
      const ta = new Date(schedule[a]!.nextAt!).getTime();
      const tb = new Date(schedule[b]!.nextAt!).getTime();
      return ta - tb;
    });

  const preview = sorted.slice(0, 3);

  if (!expanded) {
    return (
      <div className="bg-card border border-border rounded-lg px-4 py-2 text-xs flex items-center gap-3 flex-wrap">
        <span className="text-text-muted">Next:</span>
        {preview.map((key) => (
          <span key={key} className="inline-flex items-center gap-1.5">
            <Badge className={JOB_TYPE_COLORS[key] ?? JOB_TYPE_COLOR_DEFAULT}>{key}</Badge>
            <span className="font-mono text-text">{formatCountdown(schedule[key]?.nextAt, now)}</span>
          </span>
        ))}
        <button
          onClick={() => setExpanded(true)}
          className="text-text-muted hover:text-text bg-transparent border-none cursor-pointer ml-auto text-xs"
        >
          expand &#x25BE;
        </button>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-lg p-3 text-xs space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-text-dim font-medium">Job Schedule</span>
        <button
          onClick={() => setExpanded(false)}
          className="text-text-muted hover:text-text bg-transparent border-none cursor-pointer text-xs"
        >
          collapse &#x25B4;
        </button>
      </div>
      <div className="space-y-3">
        {JOB_GROUPS.map((group, gi) => {
          const visibleJobs = group.jobs.filter(k => schedule[k]);
          if (visibleJobs.length === 0) return null;
          return (
            <div key={group.label}>
              {gi > 0 && <div className="border-t border-border/30 mb-2" />}
              <div className="text-[10px] text-text-muted uppercase tracking-wide mb-1.5">{group.label}</div>
              <div className="space-y-1.5">
                {visibleJobs.map((key) => {
                  const entry = schedule[key]!;
                  const disabled = entry.enabled === false;
                  return (
                    <div key={key} className={`flex flex-col gap-0.5 ${disabled ? 'opacity-50' : ''}`}>
                      <div className="flex items-center gap-2">
                        <Badge className={JOB_TYPE_COLORS[key] ?? JOB_TYPE_COLOR_DEFAULT}>{key}</Badge>
                        <span className="text-text-muted">{intervalLabel(entry)}</span>
                        <span className="font-mono text-text ml-auto">
                          {disabled ? 'disabled' : formatCountdown(entry.nextAt, now)}
                        </span>
                        <button
                          onClick={() => handleTriggerClick(key)}
                          disabled={isRunning(key) || entry.enabled === false}
                          className={`px-2 py-0.5 rounded border-none cursor-pointer transition-colors disabled:opacity-50 text-[10px] ${TRIGGER_COLORS[key] ?? 'bg-accent-soft text-accent hover:bg-accent/25'}`}
                        >
                          {isRunning(key) ? 'Running...' : 'Trigger'}
                        </button>
                      </div>
                      {/* Entity selector for repo/project jobs */}
                      {selectorFor === key && REPO_JOBS.has(key) && repos && (
                        <div className="flex items-center gap-1.5 pl-1 mt-1 animate-fade-in">
                          <span className="text-[10px] text-text-muted">Repo:</span>
                          {repos.length <= 6 ? (
                            repos.map(r => (
                              <button
                                key={r.id}
                                onClick={() => handleTriggerJob(key, { repoId: r.id })}
                                className={`px-2 py-0.5 rounded text-[10px] border-none cursor-pointer transition-colors ${TRIGGER_COLORS[key] ?? 'bg-accent-soft text-accent'}`}
                              >
                                {r.name}
                              </button>
                            ))
                          ) : (
                            <select
                              onChange={(e) => { if (e.target.value) handleTriggerJob(key, { repoId: e.target.value }); }}
                              defaultValue=""
                              className="bg-bg border border-border rounded px-2 py-0.5 text-[10px] text-text"
                            >
                              <option value="" disabled>Select repo...</option>
                              {repos.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                            </select>
                          )}
                        </div>
                      )}
                      {selectorFor === key && PROJECT_JOBS.has(key) && projects && (
                        <div className="flex items-center gap-1.5 pl-1 mt-1 animate-fade-in">
                          <span className="text-[10px] text-text-muted">Project:</span>
                          {projects.length <= 6 ? (
                            projects.map(p => (
                              <button
                                key={p.id}
                                onClick={() => handleTriggerJob(key, { projectId: p.id })}
                                className={`px-2 py-0.5 rounded text-[10px] border-none cursor-pointer transition-colors ${TRIGGER_COLORS[key] ?? 'bg-accent-soft text-accent'}`}
                              >
                                {p.name}
                              </button>
                            ))
                          ) : (
                            <select
                              onChange={(e) => { if (e.target.value) handleTriggerJob(key, { projectId: e.target.value }); }}
                              defaultValue=""
                              className="bg-bg border border-border rounded px-2 py-0.5 text-[10px] text-text"
                            >
                              <option value="" disabled>Select project...</option>
                              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                          )}
                        </div>
                      )}
                      {JOB_DESCRIPTIONS[key] && (
                        <span className="text-text-muted/70 text-[10px] pl-1">{JOB_DESCRIPTIONS[key]}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
