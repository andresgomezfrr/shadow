import { useEffect, useRef, useState, useCallback } from 'react';

type EventHandler = (data: unknown) => void;

// Singleton EventSource — shared across all components
let sharedSource: EventSource | null = null;
let refCount = 0;
const listeners = new Map<string, Set<EventHandler>>();
let connectedState = false;
const connectedCallbacks = new Set<(v: boolean) => void>();

function notifyConnected(v: boolean) {
  connectedState = v;
  for (const cb of connectedCallbacks) cb(v);
}

function getOrCreateSource(): EventSource {
  if (sharedSource && sharedSource.readyState !== EventSource.CLOSED) return sharedSource;

  const source = new EventSource('/api/events/stream');

  source.onopen = () => notifyConnected(true);
  source.onerror = () => notifyConnected(false);

  // Listen for all events via the generic message handler + named events
  source.onmessage = (event) => {
    const handlers = listeners.get('message');
    if (handlers) for (const h of handlers) h(tryParse(event.data));
  };

  // Register listeners for specific event types
  const proxyEvent = (type: string) => {
    source.addEventListener(type, (event) => {
      const handlers = listeners.get(type);
      if (handlers) for (const h of handlers) h(tryParse((event as MessageEvent).data));
    });
  };

  // Pre-register known event types
  const EVENT_TYPES = [
    'connected', 'heartbeat:phase', 'heartbeat:complete',
    'observation:new', 'suggestion:new', 'memory:new',
    'run:status', 'activity:detected', 'git:event',
    'job:enqueued', 'job:complete', 'thought:update',
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
      }
    };
  }, []);

  return connected;
}
