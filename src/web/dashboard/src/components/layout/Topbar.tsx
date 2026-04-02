import { TRUST_NAMES, MOOD_EMOJIS } from '../../api/types';
import type { StatusResponse } from '../../api/types';

export function Topbar({ status }: { status?: StatusResponse | null }) {
  const profile = status?.profile;
  const trustLevel = profile?.trustLevel ?? 1;
  const trustName = TRUST_NAMES[trustLevel] ?? 'Unknown';
  const mood = profile?.moodHint ?? 'neutral';
  const moodEmoji = MOOD_EMOJIS[mood] ?? '😐';
  const focusActive = profile?.focusMode === 'focus';

  return (
    <header className="fixed top-0 left-[60px] right-0 h-12 bg-card border-b border-border flex items-center justify-between px-5 z-40">
      <div className="flex items-center gap-3">
        <h1 className="text-base font-semibold text-accent tracking-wide">Shadow</h1>
        <span className="text-[13px] bg-accent-soft text-accent px-2.5 py-0.5 rounded-xl flex items-center gap-1">
          Lv.{trustLevel} {trustName}
        </span>
      </div>
      <div className="flex items-center gap-3.5 text-[13px] text-text-dim">
        <span className="text-[15px]" title={`Mood: ${mood}`}>{moodEmoji}</span>
        {focusActive && (
          <span className="text-[11px] px-2 py-0.5 rounded-xl bg-green/15 text-green">
            Focus
          </span>
        )}
        {profile?.displayName && (
          <span className="text-text-dim">{profile.displayName}</span>
        )}
      </div>
    </header>
  );
}
