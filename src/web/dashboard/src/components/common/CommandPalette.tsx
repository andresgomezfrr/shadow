import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { searchAll, type SearchGroup, type SearchGroupType } from '../../api/client';
import { useRecents, type RecentItem } from '../../hooks/useRecents';

const SEARCH_DEBOUNCE_MS = 300;

type TypeStyle = { icon: string; badge: string; dot: string };

const TYPE_STYLES: Record<SearchGroupType, TypeStyle> = {
  memory:      { icon: '🧠', badge: 'text-purple bg-purple/15',  dot: 'bg-purple' },
  observation: { icon: '👁',  badge: 'text-orange bg-orange/15', dot: 'bg-orange' },
  suggestion:  { icon: '💡', badge: 'text-blue bg-blue/15',      dot: 'bg-blue' },
  task:        { icon: '✅', badge: 'text-green bg-green/15',    dot: 'bg-green' },
  run:         { icon: '🚀', badge: 'text-cyan bg-cyan/15',      dot: 'bg-cyan' },
  project:     { icon: '📋', badge: 'text-accent bg-accent/15',  dot: 'bg-accent' },
  system:      { icon: '🔧', badge: 'text-red bg-red/15',        dot: 'bg-red' },
  repo:        { icon: '📦', badge: 'text-green bg-green/15',    dot: 'bg-green' },
  contact:     { icon: '👤', badge: 'text-blue bg-blue/15',      dot: 'bg-blue' },
};

const TYPE_LABELS: Record<SearchGroupType, string> = {
  memory: 'Memories',
  observation: 'Observations',
  suggestion: 'Suggestions',
  task: 'Tasks',
  run: 'Runs',
  project: 'Projects',
  system: 'Systems',
  repo: 'Repos',
  contact: 'Team',
};

type FlatItem = {
  type: SearchGroupType;
  id: string;
  title: string;
  subtitle: string;
  route: string;
};

function groupsFromRecents(recents: RecentItem[]): SearchGroup[] {
  if (recents.length === 0) return [];
  return [{
    type: 'memory', // placeholder, not used for rendering
    label: 'Recent',
    items: recents.map(r => ({
      id: r.id,
      title: r.title,
      subtitle: r.subtitle,
      route: r.route,
      _recentType: r.type,
    })),
  } as unknown as SearchGroup];
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { recents, addRecent } = useRecents();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  // Autofocus when opening, reset state when closing
  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      setActiveIndex(0);
    } else {
      setQuery('');
      setDebouncedQuery('');
      setGroups([]);
    }
  }, [open]);

  // Debounce query
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query, open]);

  // Fetch results when debounced query changes
  useEffect(() => {
    if (!open) return;
    if (!debouncedQuery) {
      setGroups([]);
      setLoading(false);
      setActiveIndex(0);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const data = await searchAll(debouncedQuery, 4);
      if (cancelled) return;
      setGroups(data?.groups ?? []);
      setLoading(false);
      setActiveIndex(0);
    })();
    return () => { cancelled = true; };
  }, [debouncedQuery, open]);

  // Compute flat list of items for keyboard navigation
  const { displayGroups, flatItems } = useMemo(() => {
    // If no query, show recents as a single group
    if (!debouncedQuery) {
      if (recents.length === 0) return { displayGroups: [] as Array<{ type: SearchGroupType; label: string; items: FlatItem[] }>, flatItems: [] as FlatItem[] };
      const items: FlatItem[] = recents.map(r => ({
        type: r.type, id: r.id, title: r.title, subtitle: r.subtitle, route: r.route,
      }));
      return {
        displayGroups: [{ type: 'memory' as SearchGroupType, label: 'Recent', items }],
        flatItems: items,
      };
    }
    // Otherwise show search results
    const dg = groups.map(g => ({
      type: g.type,
      label: g.label,
      items: g.items.map(i => ({
        type: g.type, id: i.id, title: i.title, subtitle: i.subtitle, route: i.route,
      })),
    }));
    return { displayGroups: dg, flatItems: dg.flatMap(g => g.items) };
  }, [debouncedQuery, groups, recents]);

  const handleSelect = useCallback((item: FlatItem) => {
    addRecent({ type: item.type, id: item.id, title: item.title, subtitle: item.subtitle, route: item.route });
    navigate(item.route);
    onClose();
  }, [addRecent, navigate, onClose]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (flatItems.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => (i + 1) % flatItems.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => (i - 1 + flatItems.length) % flatItems.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = flatItems[activeIndex];
      if (item) handleSelect(item);
    }
  }, [flatItems, activeIndex, handleSelect, onClose]);

  // Scroll active item into view
  useEffect(() => {
    if (!resultsRef.current) return;
    const active = resultsRef.current.querySelector<HTMLElement>(`[data-idx="${activeIndex}"]`);
    active?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (!open) return null;

  // Build global index lookup for keyboard highlight
  let globalIdx = 0;

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/60 flex items-start justify-center pt-[15vh] animate-fade-in"
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      <div
        className="w-[600px] max-w-[92vw] bg-card border border-border rounded-xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center px-4 py-3 border-b border-border gap-3">
          <span className="text-text-dim text-lg">⌕</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search memories, observations, suggestions, runs, tasks, projects..."
            className="flex-1 bg-transparent text-text placeholder:text-text-muted outline-none text-base"
          />
          {loading && <span className="text-text-muted text-xs">searching…</span>}
          <kbd className="text-[10px] text-text-muted bg-bg border border-border rounded px-1.5 py-0.5">esc</kbd>
        </div>

        {/* Results */}
        <div ref={resultsRef} className="max-h-[420px] overflow-y-auto">
          {/* Empty state: no query and no recents */}
          {!debouncedQuery && recents.length === 0 && (
            <div className="px-4 py-10 text-center text-text-muted text-sm">
              <div className="text-3xl mb-2">🔍</div>
              <div>Start typing to search across Shadow</div>
              <div className="text-xs mt-1">Memories · Observations · Suggestions · Runs · Tasks · Projects · Systems · Repos · Team</div>
            </div>
          )}

          {/* Empty state: query but no results */}
          {debouncedQuery && !loading && flatItems.length === 0 && (
            <div className="px-4 py-10 text-center text-text-muted text-sm">
              <div className="text-2xl mb-2">∅</div>
              <div>No results for <span className="text-text-dim">"{debouncedQuery}"</span></div>
            </div>
          )}

          {/* Grouped results */}
          {displayGroups.map((group) => (
            <div key={group.label} className="py-1">
              <div className="px-4 py-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                {group.label}
              </div>
              {group.items.map((item) => {
                const idx = globalIdx++;
                const isActive = idx === activeIndex;
                const style = TYPE_STYLES[item.type];
                return (
                  <button
                    key={`${item.type}-${item.id}`}
                    data-idx={idx}
                    onClick={() => handleSelect(item)}
                    onMouseEnter={() => setActiveIndex(idx)}
                    className={`w-full text-left px-4 py-2.5 flex items-center gap-3 transition-colors border-l-2 ${
                      isActive
                        ? 'bg-accent-soft border-l-accent'
                        : 'border-l-transparent hover:bg-card-hover'
                    }`}
                  >
                    <span className="text-base flex-shrink-0 w-5 text-center">{style.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-text text-sm truncate">{item.title}</div>
                      <div className="text-text-muted text-xs truncate mt-0.5">{item.subtitle}</div>
                    </div>
                    <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${style.badge}`}>
                      {TYPE_LABELS[item.type]}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-border text-[10px] text-text-muted bg-bg-soft">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="bg-bg border border-border rounded px-1 py-0.5">↑↓</kbd>
              navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="bg-bg border border-border rounded px-1 py-0.5">↵</kbd>
              open
            </span>
            <span className="flex items-center gap-1">
              <kbd className="bg-bg border border-border rounded px-1 py-0.5">esc</kbd>
              close
            </span>
          </div>
          <div className="flex items-center gap-1">
            <kbd className="bg-bg border border-border rounded px-1 py-0.5">⌘K</kbd>
            <span>toggle</span>
          </div>
        </div>
      </div>
    </div>
  );
}
