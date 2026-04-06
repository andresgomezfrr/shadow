import { TRUST_NAMES, MOOD_EMOJIS } from '../../api/types';
import type { StatusResponse } from '../../api/types';
import { useSSEConnected, useSSEStaleness } from '../../hooks/useEventStream';

function formatAgo(sec: number): string {
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  return min < 60 ? `${min}m ago` : `${Math.floor(min / 60)}h ago`;
}

export function Topbar({ status }: { status?: StatusResponse | null }) {
  const sseConnected = useSSEConnected();
  const { stale, agoSec } = useSSEStaleness();
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
        <span className="flex items-center gap-1.5" title={!sseConnected ? 'Offline — reconnecting' : stale ? `Stale — last update ${formatAgo(agoSec)}` : 'Live'}>
          <span className={`w-2 h-2 rounded-full ${!sseConnected ? 'bg-orange animate-pulse' : stale ? 'bg-yellow' : 'bg-green'}`} />
          {!sseConnected && <span className="text-[11px] text-orange">Offline</span>}
          {sseConnected && stale && <span className="text-[11px] text-yellow">{formatAgo(agoSec)}</span>}
        </span>
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
