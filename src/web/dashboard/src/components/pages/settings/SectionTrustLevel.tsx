import type { UserProfile } from '../../../api/types';
import { TRUST_NAMES } from '../../../api/types';
import { ProgressBar } from '../../common/ProgressBar';

type Props = {
  profile: UserProfile;
  visible: boolean;
};

export function SectionTrustLevel({ profile, visible }: Props) {
  const trustName = TRUST_NAMES[profile.trustLevel] ?? 'Unknown';

  return (
    <section
      id="section-trust"
      className={`bg-card border border-border rounded-lg p-5 mb-6 transition-opacity ${
        visible ? '' : 'opacity-20 pointer-events-none'
      }`}
    >
      <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
        Trust Level
        <span className="text-accent text-sm">Lv.{profile.trustLevel} {trustName}</span>
      </h2>
      <ProgressBar value={profile.trustLevel} max={5} />
      <div className="grid grid-cols-2 gap-4 mt-4 text-sm">
        <div>
          <span className="text-text-dim">Score:</span>{' '}
          <span className="text-text">{profile.trustScore.toFixed(1)}/100</span>
        </div>
        <div>
          <span className="text-text-dim">Interactions:</span>{' '}
          <span className="text-text">{profile.totalInteractions.toLocaleString()}</span>
        </div>
      </div>
      <p className="text-xs text-text-muted mt-3">
        Trust level increases automatically with usage. It cannot be changed manually.
      </p>
    </section>
  );
}
