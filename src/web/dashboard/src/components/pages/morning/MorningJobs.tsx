import { timeAgo } from '../../../utils/format';
import { Badge } from '../../common/Badge';
import type { Job } from '../../../api/types';

const TYPE_COLORS: Record<string, string> = {
  heartbeat: 'text-purple bg-purple/15',
  suggest: 'text-green bg-green/15',
  consolidate: 'text-orange bg-orange/15',
  reflect: 'text-blue bg-blue/15',
  'digest-daily': 'text-pink bg-pink/15',
  'digest-weekly': 'text-pink bg-pink/15',
  'digest-brag': 'text-pink bg-pink/15',
};

export function MorningJobs({ jobs }: { jobs: Job[] }) {
  if (jobs.length === 0) return null;

  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold mb-3">⚙️ Recent jobs</h2>
      <div className="flex flex-col gap-1.5">
        {jobs.map((job) => {
          const phases = (job.phases ?? []).filter((p: string) => !['wake', 'idle', 'notify'].includes(p));
          const duration = job.durationMs != null ? `${(job.durationMs / 1000).toFixed(1)}s` : '';
          const isRunning = job.status === 'running' || !job.finishedAt;
          return (
            <div key={job.id} className="bg-card border border-border rounded-lg px-4 py-2.5 flex items-center gap-2 flex-wrap text-xs">
              <Badge className={TYPE_COLORS[job.type] ?? 'text-text-dim bg-border'}>{job.type}</Badge>
              {isRunning ? <><span className="text-accent animate-pulse">running</span>{job.activity && <span className="text-text-dim">· {job.activity}</span>}</> : phases.length > 0 ? phases.map((p: string, i: number) => (
                <span key={i} className="text-text-muted">{p}</span>
              )) : <span className="text-text-muted">skip</span>}
              {job.llmCalls > 0 && <span className="text-text-muted">· {job.llmCalls} LLM</span>}
              {duration && <span className="text-text-muted">· {duration}</span>}
              <span className="text-text-muted ml-auto">{timeAgo(job.startedAt)}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
