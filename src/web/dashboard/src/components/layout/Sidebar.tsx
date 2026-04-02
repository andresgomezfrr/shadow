import { NavLink } from 'react-router-dom';
import type { StatusResponse } from '../../api/types';

type Counts = StatusResponse['counts'];

const NAV_ITEMS: { to: string; icon: string; label: string; countKey?: keyof Counts }[] = [
  { to: '/morning', icon: '🌅', label: 'Good morning' },
  { to: '/dashboard', icon: '📊', label: 'Dashboard' },
  { to: '/suggestions', icon: '💡', label: 'Suggestions', countKey: 'pendingSuggestions' },
  { to: '/memories', icon: '🧠', label: 'Memories' },
  { to: '/observations', icon: '👀', label: 'Observations', countKey: 'activeObservations' },
  { to: '/repos', icon: '📁', label: 'Repos' },
  { to: '/team', icon: '👥', label: 'Team' },
  { to: '/systems', icon: '🔧', label: 'Systems' },
  { to: '/usage', icon: '📈', label: 'Usage' },
  { to: '/jobs', icon: '⚙️', label: 'Jobs' },
  { to: '/runs', icon: '▶', label: 'Runs', countKey: 'runsToReview' },
  { to: '/profile', icon: '👾', label: 'Settings' },
  { to: '/emoji-guide', icon: '📖', label: 'Emoji Guide' },
];

export function Sidebar({ counts }: { counts?: Counts | null }) {
  return (
    <aside className="fixed top-0 left-0 w-[60px] h-full bg-card border-r border-border flex flex-col items-center z-50 pt-2 gap-0.5">
      <div className="text-[22px] py-2 pb-3 cursor-default select-none">👤</div>
      {NAV_ITEMS.map((item) => {
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
    </aside>
  );
}
