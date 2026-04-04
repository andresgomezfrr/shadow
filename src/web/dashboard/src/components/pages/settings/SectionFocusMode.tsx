import type { UserProfile } from '../../../api/types';
import { setFocusMode } from '../../../api/client';
import { FOCUS_DURATIONS } from './settings-data';

type Props = {
  profile: UserProfile;
  onRefresh: () => void;
  visible: boolean;
};

export function SectionFocusMode({ profile, onRefresh, visible }: Props) {
  const focusActive = profile.focusMode === 'focus';

  return (
    <section
      id="section-focus"
      className={`bg-card border border-border rounded-lg p-5 mb-6 transition-opacity ${
        visible ? '' : 'opacity-20 pointer-events-none'
      }`}
    >
      <h2 className="text-base font-semibold mb-4 flex items-center gap-2">
        Focus Mode
        {focusActive && (
          <span className="text-xs px-2 py-0.5 rounded-xl bg-green/15 text-green">Active</span>
        )}
      </h2>

      {focusActive ? (
        <div>
          {profile.focusUntil && (
            <p className="text-sm text-text-dim mb-3">
              Until: {new Date(profile.focusUntil).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
          <button
            onClick={async () => {
              await setFocusMode('available');
              onRefresh();
            }}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-border text-text border border-border cursor-pointer transition-all hover:bg-red/15 hover:text-red hover:border-red/30"
          >
            Disable Focus
          </button>
        </div>
      ) : (
        <div className="flex gap-2 flex-wrap">
          {FOCUS_DURATIONS.map((d) => (
            <button
              key={d.value}
              onClick={async () => {
                await setFocusMode('focus', d.value || undefined);
                onRefresh();
              }}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-green/10 text-green border border-green/20 cursor-pointer transition-all hover:bg-green/20"
            >
              {d.label}
            </button>
          ))}
        </div>
      )}

      <p className="text-xs text-text-muted mt-3">
        In focus mode, Shadow only responds to direct questions.
      </p>
    </section>
  );
}
