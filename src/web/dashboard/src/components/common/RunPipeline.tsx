import { RunSpinner } from './RunSpinner';

type StepStatus = 'done' | 'running' | 'failed' | 'pending';

type Props = {
  plan: StepStatus;
  exec: StepStatus;
  pr: StepStatus;
};

const STEP_STYLES: Record<StepStatus, { dot: string; line: string }> = {
  done: { dot: 'bg-green', line: 'bg-green/40' },
  running: { dot: '', line: 'bg-blue/40' },  // running renders RunSpinner instead of a dot
  failed: { dot: 'bg-red', line: 'bg-red/40' },
  pending: { dot: 'bg-border', line: 'bg-border' },
};

const LABELS: Record<string, string> = { plan: 'plan', exec: 'exec', pr: 'PR' };

function Step({ status, label, isLast }: { status: StepStatus; label: string; isLast?: boolean }) {
  const style = STEP_STYLES[status];
  return (
    <div className="flex items-center gap-0">
      <div className="flex flex-col items-center">
        {status === 'running'
          ? <RunSpinner size="sm" />
          : <div className={`w-2 h-2 rounded-full ${style.dot}`} title={`${label}: ${status}`} />
        }
        <span className="text-[9px] text-text-muted mt-0.5 leading-none">{label}</span>
      </div>
      {!isLast && (
        <div className={`w-5 h-[2px] ${style.line} -mt-2.5`} />
      )}
    </div>
  );
}

export function RunPipeline({ plan, exec, pr }: Props) {
  return (
    <div className="inline-flex items-start gap-0">
      <Step status={plan} label={LABELS.plan} />
      <Step status={exec} label={LABELS.exec} />
      <Step status={pr} label={LABELS.pr} isLast />
    </div>
  );
}
