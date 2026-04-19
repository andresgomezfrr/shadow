import { useEffect, useRef, useState, useCallback } from 'react';

type EventHandler = (data: unknown) => void;

// Singleton EventSource — shared across all components
let sharedSource: EventSource | null = null;
let refCount = 0;
const listeners = new Map<string, Set<EventHandler>>();
let connectedState = false;
const connectedCallbacks = new Set<(v: boolean) => void>();

// Reconnect state
let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

// Staleness tracking
let lastMessageAt: number = Date.now();
const staleCallbacks = new Set<() => void>();

function notifyConnected(v: boolean) {
  connectedState = v;
  for (const cb of connectedCallbacks) cb(v);
}

function touchLastMessage() {
  lastMessageAt = Date.now();
  for (const cb of staleCallbacks) cb();
}

const MAX_RECONNECT_ATTEMPTS = 10;

function scheduleReconnect() {
  if (reconnectTimer) return;
  if (reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
    notifyConnected(false);
    return;
  }
  const delay = Math.min(1000 * Math.pow(2, reconnectAttempt), 30000);
  reconnectAttempt++;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (sharedSource) { sharedSource.close(); sharedSource = null; }
    if (refCount > 0) getOrCreateSource();
  }, delay);
}

function getOrCreateSource(): EventSource {
  if (sharedSource && sharedSource.readyState !== EventSource.CLOSED) return sharedSource;
  // Reset reconnect counter when explicitly creating a new source (e.g., tab regains focus)
  if (reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) reconnectAttempt = 0;

  const source = new EventSource('/api/events/stream');

  source.onopen = () => {
    reconnectAttempt = 0;
    notifyConnected(true);
    touchLastMessage();
  };
  source.onerror = () => {
    notifyConnected(false);
    scheduleReconnect();
  };

  // Listen for all events via the generic message handler + named events
  source.onmessage = (event) => {
    touchLastMessage();
    const handlers = listeners.get('message');
    if (handlers) for (const h of handlers) h(tryParse(event.data));
  };

  // Register listeners for specific event types
  const proxyEvent = (type: string) => {
    source.addEventListener(type, (event) => {
      touchLastMessage();
      const handlers = listeners.get(type);
      if (handlers) for (const h of handlers) h(tryParse((event as MessageEvent).data));
    });
  };

  // Pre-register known event types
  const EVENT_TYPES = [
    'connected', 'heartbeat:phase', 'heartbeat:complete',
    'observation:new', 'suggestion:new', 'memory:new',
    'run:status', 'activity:detected', 'git:event',
    'job:enqueued', 'job:started', 'job:phase', 'job:complete', 'thought:update',
    'status:update',
  ];
  for (const t of EVENT_TYPES) proxyEvent(t);

  sharedSource = source;
  return source;
}

function tryParse(data: string): unknown {
  try { return JSON.parse(data); } catch { return data; }
}

/**
 * Subscribe to specific SSE event types.
 * Returns connection status.
 */
export function useEventStream(
  eventTypes: string[],
  onEvent: (type: string, data: unknown) => void,
): { connected: boolean } {
  const [connected, setConnected] = useState(connectedState);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    refCount++;
    getOrCreateSource();

    connectedCallbacks.add(setConnected);

    const handler: EventHandler = (data) => onEventRef.current('', data);
    const handlers: Array<{ type: string; handler: EventHandler }> = [];

    for (const type of eventTypes) {
      const h: EventHandler = (data) => onEventRef.current(type, data);
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(h);
      handlers.push({ type, handler: h });
    }

    return () => {
      connectedCallbacks.delete(setConnected);
      for (const { type, handler: h } of handlers) {
        listeners.get(type)?.delete(h);
      }
      refCount--;
      if (refCount <= 0 && sharedSource) {
        sharedSource.close();
        sharedSource = null;
        refCount = 0;
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
        // Reset reconnect counter so next subscriber starts with a clean budget
        // instead of inheriting attempts from a previous (now-defunct) session
        // — fixes the "dead state after attempts exhausted" path (audit UI-04).
        reconnectAttempt = 0;
      }
    };
  }, [eventTypes.join(',')]);

  return { connected };
}

/**
 * Simple hook that just returns SSE connection status.
 */
export function useSSEConnected(): boolean {
  const [connected, setConnected] = useState(connectedState);

  useEffect(() => {
    refCount++;
    getOrCreateSource();
    connectedCallbacks.add(setConnected);
    return () => {
      connectedCallbacks.delete(setConnected);
      refCount--;
      if (refCount <= 0 && sharedSource) {
        sharedSource.close();
        sharedSource = null;
        refCount = 0;
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
        reconnectAttempt = 0;  // audit UI-04: clean budget for next subscriber
      }
    };
  }, []);

  return connected;
}

/**
 * Hook that tracks staleness — how long since the last SSE message.
 * Returns stale boolean (true if no message for > thresholdMs) and
 * seconds since last update.
 */
export function useSSEStaleness(thresholdMs = 45000): { stale: boolean; agoSec: number } {
  const [, setTick] = useState(0);

  useEffect(() => {
    // Re-render on any new message
    const cb = () => setTick(t => t + 1);
    staleCallbacks.add(cb);

    // Poll every 10s for time-based staleness updates
    const interval = setInterval(() => setTick(t => t + 1), 10000);

    return () => {
      staleCallbacks.delete(cb);
      clearInterval(interval);
    };
  }, []);

  const agoMs = Date.now() - lastMessageAt;
  return { stale: agoMs > thresholdMs, agoSec: Math.round(agoMs / 1000) };
}
