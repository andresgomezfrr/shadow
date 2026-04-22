import { useState, useEffect, useCallback, useRef } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import type { StatusResponse } from '../../api/types';
import { CorrectionPanel } from '../common/CorrectionPanel';
import { GhostTV } from '../common/GhostTV';
import { SpeechBubble } from '../common/SpeechBubble';
import { useGhostPhase, isVideo } from '../../hooks/useGhostPhase';
import { useSSEConnected } from '../../hooks/useEventStream';

type Counts = StatusResponse['counts'];

type NavItem = { to: string; icon: string; label: string; countKey?: keyof Counts };
type NavGroup = { group: true; icon: string; label: string; items: NavItem[] };
type NavDivider = { divider: true; groupLabel?: string };
type NavEntry = NavItem | NavGroup | NavDivider;

const NAV: NavEntry[] = [
  { to: '/morning', icon: '/icons/morning.webp', label: 'Morning' },
  { to: '/chronicle', icon: '/icons/chronicle.webp', label: 'Chronicle' },
  { to: '/workspace', icon: '/icons/workspace.webp', label: 'Workspace', countKey: 'runsToReview' },
  { to: '/activity', icon: '/icons/activity.webp', label: 'Activity' },
  {
    group: true,
    icon: '/icons/work.webp',
    label: 'Work',
    items: [
      { to: '/observations', icon: '/icons/observations.webp', label: 'Observations', countKey: 'activeObservations' },
      { to: '/suggestions', icon: '/icons/suggestions.webp', label: 'Suggestions', countKey: 'pendingSuggestions' },
      { to: '/tasks', icon: '/icons/tasks.webp', label: 'Tasks', countKey: 'activeTasks' },
      { to: '/runs', icon: '/icons/runs.webp', label: 'Runs' },
    ],
  },
  {
    group: true,
    icon: '/icons/entities.webp',
    label: 'Entities',
    items: [
      { to: '/projects', icon: '/icons/projects.webp', label: 'Projects' },
      { to: '/repos', icon: '/icons/repos.webp', label: 'Repos' },
      { to: '/systems', icon: '/icons/systems.webp', label: 'Systems' },
    ],
  },
  {
    group: true,
    icon: '/icons/knowledge.webp',
    label: 'Knowledge',
    items: [
      { to: '/digests', icon: '/icons/digests.webp', label: 'Digests' },
      { to: '/memories', icon: '/icons/memories.webp', label: 'Memories' },
    ],
  },
  { to: '/team', icon: '/icons/team.webp', label: 'Team' },
];

const ADMIN_GROUP: NavGroup = {
  group: true,
  icon: '/icons/admin.webp',
  label: 'Admin',
  items: [
    { to: '/profile', icon: '/icons/settings.webp', label: 'Settings' },
    { to: '/logs', icon: '/icons/logs.webp', label: 'Logs' },
    { to: '/guide', icon: '/icons/guide.webp', label: 'Guide' },
  ],
};

export function Sidebar({ counts }: { counts?: Counts | null }) {
  const [showCorrection, setShowCorrection] = useState(false);
  const [showGhostTV, setShowGhostTV] = useState(false);
  const [showBubble, setShowBubble] = useState(false);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [groupAnchorTop, setGroupAnchorTop] = useState(0);
  const [flyoutVisible, setFlyoutVisible] = useState(false);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const location = useLocation();

  // Helpers for hover open/close with a short grace period so the cursor
  // can cross the gap between trigger and flyout without the menu collapsing.
  const cancelClose = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);
  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimerRef.current = setTimeout(() => setOpenGroup(null), 180);
  }, [cancelClose]);
  const openGroupByHover = useCallback((label: string, anchorTop: number) => {
    cancelClose();
    setGroupAnchorTop(anchorTop);
    setOpenGroup(label);
  }, [cancelClose]);
  const ghost = useGhostPhase();
  const sseConnected = useSSEConnected();
  const isOffline = !sseConnected;
  const [ghostImgError, setGhostImgError] = useState(false);

  // Trigger slide-in after mount. requestAnimationFrame ensures the starting
  // transform is painted first, so the transition actually animates rather
  // than snap-rendering at the end state.
  useEffect(() => {
    if (openGroup) {
      setFlyoutVisible(false);
      const id = requestAnimationFrame(() => setFlyoutVisible(true));
      return () => cancelAnimationFrame(id);
    }
    setFlyoutVisible(false);
  }, [openGroup]);

  // Close flyout on route change or Escape
  useEffect(() => {
    setOpenGroup(null);
  }, [location.pathname, location.search]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenGroup(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // Close flyout on click outside the sidebar+flyout
  useEffect(() => {
    if (!openGroup) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (sidebarRef.current?.contains(target)) return;
      const panel = document.getElementById('sidebar-flyout');
      if (panel?.contains(target)) return;
      setOpenGroup(null);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [openGroup]);

  // Preload offline image as blob URL so it works without server
  const [offlineBlobUrl, setOfflineBlobUrl] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    fetch('/ghost/offline.webp')
      .then(r => r.blob())
      .then(blob => { url = URL.createObjectURL(blob); setOfflineBlobUrl(url); })
      .catch(() => {});
    return () => { if (url) URL.revokeObjectURL(url); };
  }, []);

  // Reset image error when source changes
  useEffect(() => { setGhostImgError(false); }, [isOffline, ghost.imagePath]);

  // Offline overrides
  const ghostImage = isOffline ? (offlineBlobUrl ?? '/ghost/offline.webp') : ghost.imagePath;
  const ghostMood = isOffline ? 'offline' : ghost.mood;
  const ghostLabel = isOffline ? 'offline' : ghost.label;

  // Show speech bubble when mood phrase changes
  useEffect(() => {
    if (ghost.moodPhraseChanged && ghost.moodPhrase) {
      setShowBubble(true);
    }
  }, [ghost.moodPhraseChanged, ghost.moodPhrase]);

  const handleBubbleDone = useCallback(() => setShowBubble(false), []);

  const allGroups: NavGroup[] = [
    ...NAV.filter((e): e is NavGroup => 'group' in e),
    ADMIN_GROUP,
  ];
  const openGroupEntry = openGroup
    ? (allGroups.find(g => g.label === openGroup) ?? null)
    : null;

  const renderGroupTrigger = (group: NavGroup) => {
    const activeItem = group.items.find(it => location.pathname === it.to || location.pathname.startsWith(it.to + '/'));
    const isActive = Boolean(activeItem);
    const isOpen = openGroup === group.label;
    // Active: the trigger impersonates the active item (icon + its own count).
    // Inactive: the trigger shows the aggregate total across the group.
    const aggregateCount = counts
      ? (activeItem
          ? (activeItem.countKey ? counts[activeItem.countKey] ?? 0 : 0)
          : group.items.reduce((acc, it) => acc + (it.countKey ? counts[it.countKey] ?? 0 : 0), 0))
      : 0;
    // When the user is on a route inside the group, the trigger morphs to
    // show that specific item's icon — feedback about *where inside* the
    // container you are. The pill background stays so it still reads as a
    // container, not a direct link.
    const displayIcon = activeItem ? activeItem.icon : group.icon;
    return (
      <button
        key={`group-${group.label}`}
        type="button"
        onClick={(e) => {
          const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
          setGroupAnchorTop(rect.top);
          setOpenGroup(isOpen ? null : group.label);
        }}
        onMouseEnter={(e) => {
          const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
          openGroupByHover(group.label, rect.top);
        }}
        onMouseLeave={scheduleClose}
        className={`group/trigger relative w-[44px] h-[44px] flex items-center justify-center rounded-xl cursor-pointer transition-all duration-150 hover:scale-105 border-none ${
          isActive || isOpen
            ? 'bg-accent-soft ring-1 ring-accent/40'
            : 'bg-border/40 hover:bg-border/60 ring-1 ring-border'
        }`}
      >
        {(isActive || isOpen) && (
          <span className="absolute left-0 top-1/4 h-1/2 w-[3px] bg-accent rounded-r" />
        )}
        <img
          src={displayIcon}
          alt=""
          className="w-11 h-11 object-cover rounded-full transition-all duration-200"
          style={isActive ? { filter: 'drop-shadow(0 0 4px rgba(188,140,255,0.55))' } : undefined}
        />
        {aggregateCount > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] flex items-center justify-center rounded-full bg-accent text-bg text-[9px] font-bold leading-none px-1"
            title={`${aggregateCount} pending across ${group.label}`}
          >
            {aggregateCount > 99 ? '99+' : aggregateCount}
          </span>
        )}
        {/* No tooltip on the trigger itself — hover opens the flyout row so
            the child icons (with their own tooltips) serve the same role. */}
      </button>
    );
  };

  return (
    <aside ref={sidebarRef} className="fixed top-0 left-0 w-[60px] h-full bg-card border-r border-border flex flex-col items-center z-50 pt-2 gap-1.5">
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

      {/* Breathing room — one-icon gap between the ghost avatar and the nav */}
      <div className="h-10" aria-hidden />

      {NAV.map((entry, i) => {
        if ('divider' in entry) {
          // Silent spacer — keeps semantic grouping without a visible rule.
          return <div key={`div-${i}`} className="h-3" aria-hidden />;
        }

        if ('group' in entry) {
          return renderGroupTrigger(entry);
        }

        const item = entry;
        const count = item.countKey && counts ? counts[item.countKey] : 0;
        return (
          <NavLink
            key={item.to}
            to={item.to}
            className="group relative w-[44px] h-[44px] flex items-center justify-center rounded-lg cursor-pointer text-[18px] transition-all duration-150 hover:scale-105"
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <span
                    className="absolute left-0 top-[20%] h-[60%] w-[3px] rounded-r"
                    style={{
                      backgroundColor: 'rgba(188,140,255,0.8)',
                      boxShadow: '0 0 10px rgba(188,140,255,0.9), 0 0 16px rgba(188,140,255,0.45)',
                    }}
                  />
                )}
                {item.icon.startsWith('/')
                  ? (
                    <img
                      src={item.icon}
                      alt=""
                      className="w-11 h-11 object-cover rounded-full transition-all duration-150"
                      style={isActive ? { filter: 'drop-shadow(0 0 4px rgba(188,140,255,0.6))' } : undefined}
                    />
                  )
                  : <span>{item.icon}</span>}
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
      <div className="mt-auto pb-2 flex flex-col items-center gap-0.5">
        {renderGroupTrigger(ADMIN_GROUP)}
        <button
          onClick={() => setShowCorrection(true)}
          className="group relative w-[44px] h-[44px] flex items-center justify-center rounded-lg cursor-pointer transition-all duration-150 hover:bg-border hover:scale-105 bg-transparent border-none"
        >
          <img src="/icons/correct.webp" alt="" className="w-11 h-11 object-cover rounded-full" />
          <span className="absolute left-[calc(60px+4px)] top-1/2 -translate-y-1/2 bg-card-hover text-text px-2.5 py-1 rounded text-xs whitespace-nowrap pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity z-[200] border border-border">
            Correct Shadow
          </span>
        </button>
      </div>
      {openGroupEntry && (
        <div
          id="sidebar-flyout"
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          style={{ top: Math.max(8, groupAnchorTop - 2) }}
          className={`fixed left-[60px] z-50 flex items-center gap-0.5 px-1 py-1 bg-card border border-border border-l-0 rounded-r-lg shadow-lg transition-all duration-200 ease-out ${
            flyoutVisible ? 'translate-x-0 opacity-100' : '-translate-x-6 opacity-0'
          }`}
        >
          {openGroupEntry.items.map(sub => {
            const subCount = sub.countKey && counts ? counts[sub.countKey] : 0;
            return (
              <NavLink
                key={sub.to}
                to={sub.to}
                onClick={() => setOpenGroup(null)}
                className={({ isActive }) =>
                  `group relative w-[44px] h-[44px] flex items-center justify-center rounded-lg cursor-pointer transition-all duration-150 hover:bg-border hover:scale-105 ${isActive ? 'bg-accent-soft' : ''}`
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <span className="absolute bottom-0 left-1/4 w-1/2 h-[3px] bg-accent rounded-t" />
                    )}
                    <img src={sub.icon} alt="" className="w-11 h-11 object-cover rounded-full" />
                    {subCount > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] flex items-center justify-center rounded-full bg-accent text-bg text-[9px] font-bold leading-none px-1">
                        {subCount > 99 ? '99+' : subCount}
                      </span>
                    )}
                    <span className="absolute top-full mt-1 left-1/2 -translate-x-1/2 bg-card-hover text-text px-2 py-0.5 rounded text-[10px] whitespace-nowrap pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity z-[200] border border-border">
                      {sub.label}{subCount > 0 ? ` (${subCount})` : ''}
                    </span>
                  </>
                )}
              </NavLink>
            );
          })}
        </div>
      )}
      <CorrectionPanel open={showCorrection} onClose={() => setShowCorrection(false)} />
      <GhostTV open={showGhostTV} onClose={() => setShowGhostTV(false)} {...ghost} imagePath={ghostImage} mood={ghostMood} label={ghostLabel} />
    </aside>
  );
}
