import WebSocket from 'ws';
import type { EventBroker } from '../events/broker';

export interface HaOptions {
  url: string;
  token: string;
  /** Maps a Home Assistant entity id → our host id. */
  entityToHost: Map<string, string>;
  broker: EventBroker;
  log?: (msg: string, err?: unknown) => void;
}

interface HaStateMsg {
  entity_id: string;
  state: string;
  attributes?: Record<string, unknown>;
}

/**
 * Maintains a single Home Assistant WebSocket connection, seeds current states,
 * subscribes to state changes, and pushes power readings for the configured
 * sensors onto the SSE broker. Reconnects with backoff. Optional feature — if HA
 * is not configured, this is never started.
 */
export class HomeAssistantClient {
  private ws: WebSocket | null = null;
  private msgId = 1;
  private stopped = false;
  private reconnectDelay = 1_000;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(private readonly opts: HaOptions) {}

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }

  private log(msg: string, err?: unknown): void {
    this.opts.log?.(`[home-assistant] ${msg}`, err);
  }

  private connect(): void {
    const wsUrl = `${this.opts.url.replace(/^http/, 'ws')}/api/websocket`;
    const ws = new WebSocket(wsUrl);
    this.ws = ws;

    ws.on('message', (raw) => this.onMessage(raw.toString()));
    ws.on('error', (err) => this.log('socket error', err));
    ws.on('close', () => {
      this.ws = null;
      if (this.stopped) return;
      this.reconnectTimer = setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000);
    });
  }

  private send(obj: Record<string, unknown>): void {
    this.ws?.send(JSON.stringify(obj));
  }

  private onMessage(text: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }

    switch (msg.type) {
      case 'auth_required':
        this.send({ type: 'auth', access_token: this.opts.token });
        break;
      case 'auth_ok':
        this.reconnectDelay = 1_000;
        this.send({ id: this.msgId++, type: 'get_states' });
        this.send({ id: this.msgId++, type: 'subscribe_events', event_type: 'state_changed' });
        break;
      case 'auth_invalid':
        this.log('authentication rejected — check HA_TOKEN');
        this.stop();
        break;
      case 'result':
        if (Array.isArray(msg.result)) {
          for (const s of msg.result as HaStateMsg[]) this.emit(s);
        }
        break;
      case 'event': {
        const newState = (msg.event as { data?: { new_state?: HaStateMsg } } | undefined)?.data
          ?.new_state;
        if (newState) this.emit(newState);
        break;
      }
      default:
        break;
    }
  }

  private emit(state: HaStateMsg): void {
    const hostId = this.opts.entityToHost.get(state.entity_id);
    if (!hostId) return;
    const watts = Number(state.state);
    this.opts.broker.broadcast({
      hostId,
      type: 'power',
      data: {
        entityId: state.entity_id,
        watts: Number.isFinite(watts) ? watts : null,
        unit: (state.attributes?.unit_of_measurement as string | undefined) ?? 'W',
      },
    });
  }
}
