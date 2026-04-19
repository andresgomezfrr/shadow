import type { ServerResponse } from 'node:http';

export type SSEEvent = {
  type: string;
  data: unknown;
  id?: string;
};

export class EventBus {
  private clients = new Set<ServerResponse>();
  private keepaliveTimers = new Map<ServerResponse, NodeJS.Timeout>();

  addClient(res: ServerResponse): void {
    this.clients.add(res);

    // Keepalive every 30s — detects dead connections via write error
    const timer = setInterval(() => {
      try {
        res.write(': keepalive\n\n');
      } catch {
        this.removeClient(res);
      }
    }, 30_000);
    this.keepaliveTimers.set(res, timer);
  }

  removeClient(res: ServerResponse): void {
    this.clients.delete(res);
    const timer = this.keepaliveTimers.get(res);
    if (timer) {
      clearInterval(timer);
      this.keepaliveTimers.delete(res);
    }
  }

  emit(event: SSEEvent): void {
    const lines = [`event: ${event.type}`, `data: ${JSON.stringify(event.data)}`];
    if (event.id) lines.push(`id: ${event.id}`);
    const payload = lines.join('\n') + '\n\n';

    for (const client of this.clients) {
      try {
        const ok = client.write(payload);
        if (!ok) {
          // TCP send buffer is full — client is slow or stalled. Kick it;
          // EventSource will reconnect cleanly instead of us holding an
          // unbounded in-memory queue (audit W-06).
          console.error('[event-bus] dropping slow SSE client (write backpressure)');
          try { client.end(); } catch { /* best-effort */ }
          this.removeClient(client);
        }
      } catch {
        this.removeClient(client);
      }
    }
  }

  shutdown(): void {
    for (const timer of this.keepaliveTimers.values()) {
      clearInterval(timer);
    }
    this.keepaliveTimers.clear();

    for (const client of this.clients) {
      try { client.end(); } catch { /* best-effort */ }
    }
    this.clients.clear();
  }

  get clientCount(): number {
    return this.clients.size;
  }
}
