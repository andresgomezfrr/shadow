import { useApi } from '../../hooks/useApi';
import { useEventStream } from '../../hooks/useEventStream';
import { fetchNotifications, markNotificationsRead, markAllNotificationsRead } from '../../api/client';
import { useNavigate } from 'react-router-dom';
import { useCallback } from 'react';
import { timeAgo } from '../../utils/format';
import type { EventRecord } from '../../api/types';

type NotificationGroup = {
  kind: string;
  label: string;
  icon: string;
  events: EventRecord[];
  navigateTo: string;
};

function groupEvents(events: EventRecord[]): NotificationGroup[] {
  const byKind = new Map<string, EventRecord[]>();
  for (const e of events) {
    const list = byKind.get(e.kind) ?? [];
    list.push(e);
    byKind.set(e.kind, list);
  }

  const groups: NotificationGroup[] = [];

  const KINDS: Record<string, { label: (n: number) => string; icon: string; nav: string }> = {
    suggestion_ready: { label: n => `${n} new suggestion${n !== 1 ? 's' : ''}`, icon: '💡', nav: '/workspace?filter=suggestion' },
    observation_notable: { label: n => `${n} observation${n !== 1 ? 's' : ''}`, icon: '⚠', nav: '/workspace?filter=observation' },
    run_completed: { label: n => `${n} run${n !== 1 ? 's' : ''} ready`, icon: '▶', nav: '/workspace?filter=run' },
    run_failed: { label: n => `${n} run${n !== 1 ? 's' : ''} failed`, icon: '✕', nav: '/workspace?filter=run' },
    job_completed: { label: n => `${n} job${n !== 1 ? 's' : ''} completed`, icon: '⚙', nav: '/activity' },
    job_failed: { label: n => `${n} job${n !== 1 ? 's' : ''} failed`, icon: '✕', nav: '/activity' },
    version_available: { label: () => 'Update available', icon: '🆕', nav: '/profile' },
  };

  for (const [kind, items] of byKind) {
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

export function NotificationPanel({ onClose, onRead }: { onClose: () => void; onRead?: () => void }) {
  const { data: events, refresh } = useApi(fetchNotifications, [], 10_000);
  const navigate = useNavigate();

  useEventStream(['suggestion:new', 'observation:new', 'run:status', 'job:complete'], refresh);

  const pending = events ?? [];
  const groups = groupEvents(pending);

  const handleView = useCallback(async (group: NotificationGroup) => {
    const ids = group.events.map(e => e.id);
    await markNotificationsRead(ids);
    refresh();
    onRead?.();
    navigate(group.navigateTo);
    onClose();
  }, [navigate, onClose, refresh, onRead]);

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
              <img src="/ghost/notifications-empty.png" alt="" className="w-32 h-32 rounded-full object-cover opacity-70" />
              <span>All caught up</span>
            </div>
          ) : (
            <div className="py-2">
              {groups.map(group => (
                <div
                  key={group.kind}
                  className="px-4 py-3 hover:bg-accent-soft cursor-pointer transition-colors border-b border-border/50"
                  onClick={() => handleView(group)}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span>{group.icon}</span>
                    <span className="text-sm font-medium flex-1">{group.label}</span>
                    <span className="text-[11px] text-text-muted">{timeAgo(group.events[0].createdAt)}</span>
                  </div>
                  <div className="space-y-0.5 ml-6">
                    {group.events.slice(0, 5).map(e => {
                      const msg = (e.payload as Record<string, unknown>)?.message as string | undefined;
                      return msg ? (
                        <div key={e.id} className="text-xs text-text-dim truncate">· {msg}</div>
                      ) : null;
                    })}
                    {group.events.length > 5 && (
                      <div className="text-[11px] text-text-muted">+{group.events.length - 5} more</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
