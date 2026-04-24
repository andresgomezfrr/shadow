import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BOND_TIER_NAMES } from '../../api/types';
import type { StatusResponse } from '../../api/types';
import { useSSEConnected, useSSEStaleness } from '../../hooks/useEventStream';
import { useApi } from '../../hooks/useApi';
import { fetchNotifications } from '../../api/client';
import { NotificationPanel } from './NotificationPanel';
import { POLL_REALTIME } from '../../constants/polling';

function formatAgo(sec: number): string {
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  return min < 60 ? `${min}m ago` : `${Math.floor(min / 60)}h ago`;
}

export function Topbar({ status }: { status?: StatusResponse | null }) {
  const sseConnected = useSSEConnected();
  const { stale, agoSec } = useSSEStaleness();
  const profile = status?.profile;
  const bondTier = profile?.bondTier ?? 1;
  const bondName = BOND_TIER_NAMES[bondTier] ?? 'observer';
  const focusActive = profile?.focusMode === 'focus';
  const [panelOpen, setPanelOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  const { data: notifications, refresh } = useApi(fetchNotifications, [], POLL_REALTIME);
  const pendingCount = notifications?.length ?? 0;

  // Deep-link: ?notifications=open forces the panel open (used by the
  // statusline 📬 hyperlink). Consume the param so refreshes don't re-open
  // the panel after the user closes it.
  useEffect(() => {
    if (searchParams.get('notifications') === 'open') {
      setPanelOpen(true);
      const next = new URLSearchParams(searchParams);
      next.delete('notifications');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  return (
    <>
      <header className="fixed top-0 left-[60px] right-0 h-12 bg-card border-b border-border flex items-center justify-between px-5 z-40">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold text-accent tracking-wide">Shadow</h1>
          <span className="text-[13px] bg-accent-soft text-accent px-2.5 py-0.5 rounded-xl flex items-center gap-1">
            Lv.{bondTier} {bondName}
          </span>
        </div>
        <div className="flex items-center gap-3.5 text-[13px] text-text-dim">
          <span className="flex items-center gap-1.5" title={!sseConnected ? 'Offline — reconnecting' : stale ? `Stale — last update ${formatAgo(agoSec)}` : 'Live'}>
            <span className={`w-2 h-2 rounded-full ${!sseConnected ? 'bg-orange animate-pulse' : stale ? 'bg-yellow' : 'bg-green'}`} />
            {!sseConnected && <span className="text-[11px] text-orange">Offline</span>}
            {sseConnected && stale && <span className="text-[11px] text-yellow">{formatAgo(agoSec)}</span>}
          </span>
          {focusActive && (
            <span className="text-[11px] px-2 py-0.5 rounded-xl bg-green/15 text-green">
              Focus
            </span>
          )}
          <button
            onClick={() => setPanelOpen(!panelOpen)}
            className={`relative bg-transparent border-none cursor-pointer p-0 rounded-full transition-all ${
              pendingCount > 0 ? 'ring-2 ring-orange/60 animate-pulse' : ''
            }`}
            title={pendingCount > 0 ? `${pendingCount} notifications` : 'No notifications'}
          >
            <img
              src={pendingCount > 0 ? '/ghost/notifications-active.webp' : '/ghost/notifications-empty.webp'}
              alt=""
              className={`w-9 h-9 rounded-full object-cover transition-opacity ${pendingCount > 0 ? 'opacity-100' : 'opacity-50 hover:opacity-80'}`}
            />
            {pendingCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-accent text-bg text-[10px] font-bold px-1">
                {pendingCount > 99 ? '99+' : pendingCount}
              </span>
            )}
          </button>
        </div>
      </header>
      {panelOpen && <NotificationPanel onClose={() => setPanelOpen(false)} onRead={refresh} />}
    </>
  );
}
