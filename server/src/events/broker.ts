import type { ServerResponse } from 'node:http';

export interface AppEvent {
  hostId: string;
  type: 'power' | 'log' | 'status';
  data: unknown;
}

/**
 * Server-Sent Events broker. The frontend opens a single `/api/events` stream;
 * HA state changes and Loki log lines are fanned out to every connected client,
 * each tagged with the host id.
 */
export class EventBroker {
  private readonly clients = new Set<ServerResponse>();
  private readonly heartbeat: NodeJS.Timeout;

  constructor() {
    // Comment line keeps proxies/browsers from closing an idle connection.
    this.heartbeat = setInterval(() => this.write(':\n\n'), 25_000);
    this.heartbeat.unref();
  }

  add(res: ServerResponse): void {
    this.clients.add(res);
    res.on('close', () => this.clients.delete(res));
  }

  broadcast(event: AppEvent): void {
    this.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  private write(payload: string): void {
    for (const res of this.clients) {
      if (!res.writableEnded) res.write(payload);
    }
  }

  get size(): number {
    return this.clients.size;
  }

  close(): void {
    clearInterval(this.heartbeat);
    for (const res of this.clients) res.end();
    this.clients.clear();
  }
}
