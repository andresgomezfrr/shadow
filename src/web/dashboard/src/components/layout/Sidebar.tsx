import { useState, useEffect, useCallback } from 'react';
import { NavLink } from 'react-router-dom';
import type { StatusResponse } from '../../api/types';
import { CorrectionPanel } from '../common/CorrectionPanel';
import { GhostTV } from '../common/GhostTV';
import { SpeechBubble } from '../common/SpeechBubble';
import { useGhostPhase, isVideo } from '../../hooks/useGhostPhase';
import { useSSEConnected } from '../../hooks/useEventStream';

type Counts = StatusResponse['counts'];

type NavItem = { to: string; icon: string; label: string; countKey?: keyof Counts };
type NavDivider = { divider: true; groupLabel?: string };
type NavEntry = NavItem | NavDivider;

const NAV: NavEntry[] = [
  // Home
  { to: '/morning', icon: '☀️', label: 'Morning' },
  { to: '/chronicle', icon: '🌒', label: 'Chronicle' },

  // Action
  { divider: true, groupLabel: 'ACTION' },
  { to: '/workspace', icon: '📥', label: 'Workspace', countKey: 'runsToReview' },
  { to: '/observations', icon: '👁', label: 'Observations', countKey: 'activeObservations' },
  { to: '/suggestions', icon: '💡', label: 'Suggestions', countKey: 'pendingSuggestions' },
  { to: '/tasks', icon: '✅', label: 'Tasks', countKey: 'activeTasks' },
  { to: '/runs', icon: '🚀', label: 'Runs' },

  // System
  { divider: true, groupLabel: 'SYSTEM' },
  { to: '/activity', icon: '⚡', label: 'Activity' },
  { to: '/digests', icon: '📝', label: 'Digests' },
  { to: '/projects', icon: '📋', label: 'Projects' },
  { to: '/memories', icon: '🧠', label: 'Memories' },

  // Configure
  { divider: true, groupLabel: 'CONFIG' },
  { to: '/repos', icon: '📦', label: 'Repos' },
  { to: '/systems', icon: '🔧', label: 'Systems' },
  { to: '/team', icon: '👥', label: 'Team' },
  { to: '/profile', icon: '⚙', label: 'Settings' },
  { to: '/guide', icon: '📖', label: 'Guide' },
];

export function Sidebar({ counts }: { counts?: Counts | null }) {
  const [showCorrection, setShowCorrection] = useState(false);
  const [showGhostTV, setShowGhostTV] = useState(false);
  const [showBubble, setShowBubble] = useState(false);
  const ghost = useGhostPhase();
  const sseConnected = useSSEConnected();
  const isOffline = !sseConnected;
  const [ghostImgError, setGhostImgError] = useState(false);

  // Preload offline image as blob URL so it works without server
  const [offlineBlobUrl, setOfflineBlobUrl] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    fetch('/ghost/offline.png')
      .then(r => r.blob())
      .then(blob => { url = URL.createObjectURL(blob); setOfflineBlobUrl(url); })
      .catch(() => {});
    return () => { if (url) URL.revokeObjectURL(url); };
  }, []);

  // Reset image error when source changes
  useEffect(() => { setGhostImgError(false); }, [isOffline, ghost.imagePath]);

  // Offline overrides
  const ghostImage = isOffline ? (offlineBlobUrl ?? '/ghost/offline.png') : ghost.imagePath;
  const ghostMood = isOffline ? 'offline' : ghost.mood;
  const ghostLabel = isOffline ? 'offline' : ghost.label;

  // Show speech bubble when mood phrase changes
  useEffect(() => {
    if (ghost.moodPhraseChanged && ghost.moodPhrase) {
      setShowBubble(true);
    }
  }, [ghost.moodPhraseChanged, ghost.moodPhrase]);

  const handleBubbleDone = useCallback(() => setShowBubble(false), []);

  return (
    <aside className="fixed top-0 left-0 w-[60px] h-full bg-card border-r border-border flex flex-col items-center z-50 pt-2 gap-0.5">
      {/* Ghost avatar — top of sidebar */}
      <div className="relative py-1 pb-2">
        <button
          onClick={() => setShowGhostTV(v => !v)}
          className="group relative w-[44px] h-[44px] flex items-center justify-center rounded-full cursor-pointer transition-all duration-150 hover:scale-110 bg-transparent border-none"
          data-mood={ghostMood}
          data-energy={ghost.energy}
        >
          {ghostImgError ? (
            <span className="text-sm font-mono ghost-pulse text-accent" data-mood={ghostMood} data-energy={ghost.energy}>
              {isOffline ? '{-_-}z' : '{•‿•}'}
            </span>
          ) : isVideo(ghostImage) ? (
            <video
              src={ghostImage}
              autoPlay loop muted playsInline
              className="w-[40px] h-[40px] rounded-full object-cover ghost-pulse"
              data-mood={ghostMood}
              data-energy={ghost.energy}
              onError={() => setGhostImgError(true)}
            />
          ) : (
            <img
              src={ghostImage}
              alt="Shadow"
              className="w-[40px] h-[40px] rounded-full object-cover ghost-pulse"
              data-mood={ghostMood}
              data-energy={ghost.energy}
              onError={() => setGhostImgError(true)}
            />
          )}
          <span className="absolute left-[calc(60px+4px)] top-1/2 -translate-y-1/2 bg-card-hover text-text px-2.5 py-1 rounded text-xs whitespace-nowrap pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity z-[200] border border-border">
            Shadow TV — {ghostLabel}
          </span>
        </button>
        <SpeechBubble text={ghost.moodPhrase ?? ''} visible={showBubble} onDone={handleBubbleDone} mood={ghost.mood} />
      </div>

      {NAV.map((entry, i) => {
        if ('divider' in entry) {
          return (
            <div key={`div-${i}`} className="flex flex-col items-center my-1">
              <div className="border-t border-border/30 w-8" />
              {entry.groupLabel && (
                <span className="text-[7px] tracking-[0.1em] text-text-muted/50 mt-1 select-none">{entry.groupLabel}</span>
              )}
            </div>
          );
        }
        const item = entry;
        const count = item.countKey && counts ? counts[item.countKey] : 0;
        return (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `group relative w-[44px] h-[44px] flex items-center justify-center rounded-lg cursor-pointer text-[18px] transition-all duration-150 hover:bg-border hover:scale-105 ${
                isActive ? 'bg-accent-soft' : ''
              }`
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <span className="absolute left-0 top-1/4 h-1/2 w-[3px] bg-accent rounded-r" />
                )}
                <span>{item.icon}</span>
                {count > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] flex items-center justify-center rounded-full bg-accent text-bg text-[9px] font-bold leading-none px-1">
                    {count > 99 ? '99+' : count}
                  </span>
                )}
                <span className="absolute left-[calc(60px+4px)] top-1/2 -translate-y-1/2 bg-card-hover text-text px-2.5 py-1 rounded text-xs whitespace-nowrap pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity z-[200] border border-border">
                  {item.label}{count > 0 ? ` (${count})` : ''}
                </span>
              </>
            )}
          </NavLink>
        );
      })}
      <div className="mt-auto pb-2">
        <button
          onClick={() => setShowCorrection(true)}
          className="group relative w-[44px] h-[44px] flex items-center justify-center rounded-lg cursor-pointer text-[18px] transition-all duration-150 hover:bg-border hover:scale-105 bg-transparent border-none"
        >
          <span>✏️</span>
          <span className="absolute left-[calc(60px+4px)] top-1/2 -translate-y-1/2 bg-card-hover text-text px-2.5 py-1 rounded text-xs whitespace-nowrap pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity z-[200] border border-border">
            Correct Shadow
          </span>
        </button>
      </div>
      <CorrectionPanel open={showCorrection} onClose={() => setShowCorrection(false)} />
      <GhostTV open={showGhostTV} onClose={() => setShowGhostTV(false)} {...ghost} imagePath={ghostImage} mood={ghostMood} label={ghostLabel} />
    </aside>
  );
}
