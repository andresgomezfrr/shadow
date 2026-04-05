import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import type { StatusResponse } from '../../api/types';
import { CorrectionPanel } from '../common/CorrectionPanel';

type Counts = StatusResponse['counts'];

type NavItem = { to: string; icon: string; label: string; countKey?: keyof Counts };
type NavDivider = { divider: true };
type NavEntry = NavItem | NavDivider;

const NAV: NavEntry[] = [
  // Home
  { to: '/morning', icon: '☀️', label: 'Morning' },

  // Action
  { divider: true },
  { to: '/workspace', icon: '▶', label: 'Workspace', countKey: 'runsToReview' },
  { to: '/suggestions', icon: '💡', label: 'Suggestions', countKey: 'pendingSuggestions' },
  { to: '/observations', icon: '👁', label: 'Observations', countKey: 'activeObservations' },

  // System
  { divider: true },
  { to: '/activity', icon: '⚡', label: 'Activity' },
  { to: '/digests', icon: '📝', label: 'Digests' },
  { to: '/projects', icon: '📋', label: 'Projects' },
  { to: '/memories', icon: '🧠', label: 'Memories' },

  // Configure
  { divider: true },
  { to: '/repos', icon: '📦', label: 'Repos' },
  { to: '/systems', icon: '🔧', label: 'Systems' },
  { to: '/team', icon: '👥', label: 'Team' },
  { to: '/profile', icon: '⚙', label: 'Settings' },
  { to: '/guide', icon: '📖', label: 'Guide' },
];

export function Sidebar({ counts }: { counts?: Counts | null }) {
  const [showCorrection, setShowCorrection] = useState(false);

  return (
    <aside className="fixed top-0 left-0 w-[60px] h-full bg-card border-r border-border flex flex-col items-center z-50 pt-2 gap-0.5">
      <div className="text-[22px] py-2 pb-3 cursor-default select-none">👤</div>
      {NAV.map((entry, i) => {
        if ('divider' in entry) {
          return <div key={`div-${i}`} className="border-t border-border/30 w-8 my-1" />;
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
    </aside>
  );
}
