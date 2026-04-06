import { useState, useCallback } from 'react';
import { useNow, formatCountdown } from '../../utils/format';
import { Badge } from '../common/Badge';
import { triggerJob } from '../../api/client';

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

const TYPE_COLORS: Record<string, string> = {
  heartbeat: 'bg-purple-500/20 text-purple-300',
  suggest: 'bg-green-500/20 text-green-300',
  consolidate: 'bg-orange-500/20 text-orange-300',
  reflect: 'bg-blue-500/20 text-blue-300',
  'remote-sync': 'bg-pink-400/20 text-pink-300',
  'repo-profile': 'bg-teal-400/20 text-teal-300',
  'context-enrich': 'bg-amber-400/20 text-amber-300',
  'digest-daily': 'bg-cyan-500/20 text-cyan-300',
  'digest-weekly': 'bg-cyan-500/20 text-cyan-300',
  'digest-brag': 'bg-cyan-500/20 text-cyan-300',
};

const TRIGGER_COLORS: Record<string, string> = {
  heartbeat: 'bg-purple-500/15 text-purple-300 hover:bg-purple-500/25',
  suggest: 'bg-green-500/15 text-green-300 hover:bg-green-500/25',
  consolidate: 'bg-orange-500/15 text-orange-300 hover:bg-orange-500/25',
  reflect: 'bg-blue-500/15 text-blue-300 hover:bg-blue-500/25',
  'remote-sync': 'bg-pink-400/15 text-pink-300 hover:bg-pink-400/25',
  'repo-profile': 'bg-teal-400/15 text-teal-300 hover:bg-teal-400/25',
  'context-enrich': 'bg-amber-400/15 text-amber-300 hover:bg-amber-400/25',
  'digest-daily': 'bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25',
  'digest-weekly': 'bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25',
  'digest-brag': 'bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25',
};

const JOB_ORDER = ['heartbeat', 'suggest', 'consolidate', 'reflect', 'remote-sync', 'repo-profile', 'context-enrich', 'digest-daily', 'digest-weekly', 'digest-brag'];

const JOB_DESCRIPTIONS: Record<string, string> = {
  heartbeat: 'Discovers active projects, extracts memories, generates observations',
  suggest: 'Analyzes observations to generate code suggestions (scheduled + reactive)',
  consolidate: 'Promotes/demotes memories between layers, synthesizes meta-patterns',
  reflect: '2-phase soul reflection: extract deltas (Sonnet) → evolve soul (Opus)',
  'remote-sync': 'Lightweight git ls-remote to detect remote changes across repos',
  'repo-profile': 'Reactive: re-profiles repos when remote-sync detects new commits (2h min gap)',
  'context-enrich': 'Queries external MCP servers for deployment, CI/CD, calendar data',
  'digest-daily': 'Daily standup summary (3-5 bullets)',
  'digest-weekly': 'Weekly 1:1 summary from daily digests',
  'digest-brag': 'Quarterly brag doc for performance reviews',
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

export function ScheduleRibbon({ schedule, onTrigger }: Props) {
  const now = useNow();
  const [expanded, setExpanded] = useState(false);
  const [triggeredSet, setTriggeredSet] = useState<Set<string>>(new Set());

  const handleTriggerJob = useCallback(async (jobType: string) => {
    const result = await triggerJob(jobType);
    if (result) {
      setTriggeredSet(prev => new Set(prev).add(jobType));
      setTimeout(() => setTriggeredSet(prev => {
        const next = new Set(prev);
        next.delete(jobType);
        return next;
      }), 15_000);
      onTrigger?.();
    }
  }, [onTrigger]);

  const isTriggered = (key: string) => triggeredSet.has(key);

  if (!schedule) return null;

  // Sort entries by next-at for the collapsed preview
  const sorted = JOB_ORDER
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
            <Badge className={TYPE_COLORS[key] ?? 'text-text-dim bg-border'}>{key}</Badge>
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
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {JOB_ORDER.filter((k) => schedule[k]).map((key) => {
          const entry = schedule[key]!;
          const disabled = entry.enabled === false;
          return (
            <div key={key} className={`flex flex-col gap-0.5 ${disabled ? 'opacity-50' : ''}`}>
              <div className="flex items-center gap-2">
                <Badge className={TYPE_COLORS[key] ?? 'text-text-dim bg-border'}>{key}</Badge>
                <span className="text-text-muted">{intervalLabel(entry)}</span>
                <span className="font-mono text-text ml-auto">
                  {disabled ? 'disabled' : formatCountdown(entry.nextAt, now)}
                </span>
                <button
                  onClick={() => handleTriggerJob(key)}
                  disabled={isTriggered(key) || entry.enabled === false}
                  className={`px-2 py-0.5 rounded border-none cursor-pointer transition-colors disabled:opacity-50 text-[10px] ${TRIGGER_COLORS[key] ?? 'bg-accent-soft text-accent hover:bg-accent/25'}`}
                >
                  {isTriggered(key) ? 'Triggered' : 'Trigger'}
                </button>
              </div>
              {JOB_DESCRIPTIONS[key] && (
                <span className="text-text-muted/70 text-[10px] pl-1">{JOB_DESCRIPTIONS[key]}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
