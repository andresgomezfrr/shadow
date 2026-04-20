import { useApi } from '../../hooks/useApi';
import { useEventStream } from '../../hooks/useEventStream';
import { fetchNotifications, markNotificationsRead, markAllNotificationsRead } from '../../api/client';
import { useNavigate } from 'react-router-dom';
import { useCallback, useState } from 'react';
import { timeAgo } from '../../utils/format';
import { POLL_REALTIME } from '../../constants/polling';
import type { EventRecord } from '../../api/types';

type NotificationGroup = {
  kind: string;
  label: string;
  icon: string;
  events: EventRecord[];
  navigateTo: string;
};

type KindConfig = { label: (n: number) => string; icon: string; nav: string };

const KINDS: Record<string, KindConfig> = {
  suggestion_ready: { label: n => `${n} new suggestion${n !== 1 ? 's' : ''}`, icon: '💡', nav: '/workspace?filter=suggestion' },
  observation_notable: { label: n => `${n} observation${n !== 1 ? 's' : ''}`, icon: '⚠', nav: '/workspace?filter=observation' },
  run_completed: { label: n => `${n} run${n !== 1 ? 's' : ''} ready`, icon: '▶', nav: '/workspace?filter=run' },
  run_failed: { label: n => `${n} run${n !== 1 ? 's' : ''} failed`, icon: '✕', nav: '/workspace?filter=run' },
  job_completed: { label: n => `${n} job${n !== 1 ? 's' : ''} completed`, icon: '⚙', nav: '/activity' },
  job_failed: { label: n => `${n} job${n !== 1 ? 's' : ''} failed`, icon: '✕', nav: '/activity' },
  auto_plan_complete: { label: n => `${n} auto-plan${n !== 1 ? 's' : ''} done`, icon: '📋', nav: '/activity' },
  auto_execute_complete: { label: n => `${n} auto-execute${n !== 1 ? 's' : ''} done`, icon: '▶', nav: '/activity' },
  plan_needs_review: { label: n => `${n} plan${n !== 1 ? 's' : ''} need review`, icon: '👀', nav: '/workspace?filter=run' },
  version_available: { label: () => 'Update available', icon: '🆕', nav: '/profile' },
  bond_tier_rise: { label: () => 'New bond reached', icon: '🌒', nav: '/chronicle' },
  unlock: { label: n => `${n} unlock${n !== 1 ? 's' : ''}`, icon: '✨', nav: '/chronicle' },
};

function groupEvents(events: EventRecord[]): NotificationGroup[] {
  const byKind = new Map<string, EventRecord[]>();
  for (const e of events) {
    const list = byKind.get(e.kind) ?? [];
    list.push(e);
    byKind.set(e.kind, list);
  }

  const groups: NotificationGroup[] = [];
  for (const [kind, items] of byKind) {
    items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const config = KINDS[kind];
    if (config) {
      groups.push({ kind, label: config.label(items.length), icon: config.icon, events: items, navigateTo: config.nav });
    } else {
      groups.push({ kind, label: `${items.length} ${kind.replace(/_/g, ' ')}`, icon: '📌', events: items, navigateTo: '/activity' });
    }
  }

  groups.sort((a, b) => {
    const maxA = Math.max(...a.events.map(e => e.priority));
    const maxB = Math.max(...b.events.map(e => e.priority));
    return maxB - maxA;
  });

  return groups;
}

function eventNavTarget(event: EventRecord): string | null {
  if (event.kind === 'bond_tier_rise' || event.kind === 'unlock') return '/chronicle';
  const p = event.payload as Record<string, unknown>;
  if (p.suggestionId) return `/workspace?filter=suggestion&item=${p.suggestionId}&itemType=suggestion`;
  if (p.runId) return `/workspace?filter=run&item=${p.runId}&itemType=run`;
  if (p.observationId) return `/workspace?filter=observation&item=${p.observationId}&itemType=observation`;
  if (Array.isArray(p.observationIds) && p.observationIds.length === 1) return `/workspace?filter=observation&item=${p.observationIds[0]}&itemType=observation`;
  if (p.jobId) return `/activity?highlight=${p.jobId}`;
  if (p.jobType) return '/activity';
  return null;
}

export function NotificationPanel({ onClose, onRead }: { onClose: () => void; onRead?: () => void }) {
  const { data: events, refresh } = useApi(fetchNotifications, [], POLL_REALTIME);
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEventStream(['suggestion:new', 'observation:new', 'run:status', 'job:complete'], refresh);

  const pending = events ?? [];
  const groups = groupEvents(pending);

  const toggleExpand = useCallback((kind: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind); else next.add(kind);
      return next;
    });
  }, []);

  const handleViewAll = useCallback(async (group: NotificationGroup) => {
    const ids = group.events.map(e => e.id);
    markNotificationsRead(ids).then(() => onRead?.());
    navigate(group.navigateTo);
    onClose();
  }, [navigate, onClose, onRead]);

  const handleViewItem = useCallback(async (event: EventRecord) => {
    const target = eventNavTarget(event);
    if (!target) return;
    markNotificationsRead([event.id]).then(() => onRead?.());
    navigate(target);
    onClose();
  }, [navigate, onClose, onRead]);

  const handleMarkAllRead = useCallback(async () => {
    await markAllNotificationsRead();
    refresh();
    onRead?.();
  }, [refresh, onRead]);

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />

      <div className="fixed top-12 right-0 bottom-0 w-[360px] z-50 bg-card border-l border-border shadow-2xl flex flex-col animate-fade-in">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-sm font-medium">Notifications</span>
          <div className="flex items-center gap-3">
            {pending.length > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="text-[11px] text-text-muted hover:text-accent bg-transparent border-none cursor-pointer"
              >mark all read</button>
            )}
            <button
              onClick={onClose}
              className="text-xs text-text-muted hover:text-text bg-transparent border-none cursor-pointer"
            >✕</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {groups.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-text-muted text-sm gap-3">
              <img src="/ghost/notifications-empty.webp" alt="" className="w-32 h-32 rounded-full object-cover opacity-70" />
              <span>All caught up</span>
            </div>
          ) : (
            <div className="py-2">
              {groups.map(group => {
                const isExpanded = expanded.has(group.kind);
                const isSingle = group.events.length === 1;
                return (
                  <div key={group.kind} className="border-b border-border/50">
                    <div
                      className="px-4 py-3 hover:bg-accent-soft cursor-pointer transition-colors flex items-center gap-2"
                      onClick={() => isSingle ? handleViewItem(group.events[0]) : toggleExpand(group.kind)}
                    >
                      <span className={`text-[10px] text-text-muted transition-transform ${isExpanded ? 'rotate-90' : ''}`}>
                        {isSingle ? '' : '▶'}
                      </span>
                      <span>{group.icon}</span>
                      <span className="text-sm font-medium flex-1">{group.label}</span>
                      <span className="text-[11px] text-text-muted">{timeAgo(group.events[0].createdAt)}</span>
                    </div>

                    {isExpanded && (
                      <div className="pb-2">
                        {group.events.map(e => {
                          const p = e.payload as Record<string, unknown>;
                          const msg = (p.title as string) || (p.message as string) || null;
                          const hasTarget = !!eventNavTarget(e);
                          return (
                            <div
                              key={e.id}
                              className={`px-4 py-1.5 ml-6 mr-2 rounded text-xs transition-colors ${hasTarget ? 'hover:bg-accent-soft cursor-pointer' : 'text-text-dim'}`}
                              onClick={hasTarget ? () => handleViewItem(e) : undefined}
                            >
                              <div className="flex items-center gap-2">
                                <span className="text-text-dim">·</span>
                                <span className={`flex-1 truncate ${hasTarget ? 'text-text' : 'text-text-dim'}`}>{msg || e.kind}</span>
                                <span className="text-[10px] text-text-muted shrink-0">{timeAgo(e.createdAt)}</span>
                              </div>
                            </div>
                          );
                        })}
                        <div
                          className="px-4 py-1 ml-6 text-[11px] text-accent hover:text-accent/80 cursor-pointer"
                          onClick={() => handleViewAll(group)}
                        >
                          View all in {group.navigateTo.startsWith('/activity') ? 'activity' : 'workspace'} →
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
