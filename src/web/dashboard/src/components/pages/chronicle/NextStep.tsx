import { useEffect, useState } from 'react';
import type { ChronicleResponse } from '../../../api/types';
import { fetchNextStepHint } from '../../../api/client';

type Props = {
  nextStep: ChronicleResponse['nextStep'];
};

export function NextStep({ nextStep }: Props) {
  const [hint, setHint] = useState<string>(nextStep?.hint ?? '');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!nextStep || hint) return;
    setLoading(true);
    fetchNextStepHint()
      .then((r) => setHint(r.body))
      .catch(() => setHint(''))
      .finally(() => setLoading(false));
  }, [nextStep, hint]);

  if (!nextStep) {
    return (
      <section className="bg-card border border-border rounded-lg p-5 mb-6">
        <h2 className="text-base font-semibold mb-2">Next Step</h2>
        <p className="text-text-muted italic text-sm">
          You've reached the final bond. The path is complete.
        </p>
      </section>
    );
  }

  const { requirements } = nextStep;
  const timeMet = requirements.daysElapsed >= requirements.minDays;
  const qualityMet = requirements.currentQuality >= requirements.qualityFloor;

  return (
    <section className="bg-card border border-border rounded-lg p-5 mb-6">
      <h2 className="text-base font-semibold mb-3">
        Next Step <span className="text-text-dim font-normal">→ {nextStep.name}</span>
      </h2>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="flex items-center gap-2">
          <span className={`text-lg ${timeMet ? 'text-green' : 'text-text-dim'}`}>
            {timeMet ? '✓' : '○'}
          </span>
          <div>
            <p className="text-xs text-text-dim">Days together</p>
            <p className="text-sm">
              <span className={timeMet ? 'text-text' : 'text-text-muted'}>
                {requirements.daysElapsed}
              </span>
              <span className="text-text-muted"> / {requirements.minDays}</span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-lg ${qualityMet ? 'text-green' : 'text-text-dim'}`}>
            {qualityMet ? '✓' : '○'}
          </span>
          <div>
            <p className="text-xs text-text-dim">Bond quality</p>
            <p className="text-sm">
              <span className={qualityMet ? 'text-text' : 'text-text-muted'}>
                {requirements.currentQuality}
              </span>
              <span className="text-text-muted"> / {requirements.qualityFloor}</span>
            </p>
          </div>
        </div>
      </div>

      {loading && <p className="text-xs text-text-muted italic">Shadow is thinking...</p>}
      {hint && (
        <blockquote className="pl-3 border-l-2 border-accent/40 italic text-sm text-text-dim">
          {hint}
        </blockquote>
      )}
    </section>
  );
}
