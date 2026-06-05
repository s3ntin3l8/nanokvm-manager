import WebSocket from 'ws';
import type { EventBroker } from '../events/broker';

export interface LogLine {
  /** Unix milliseconds. */
  ts: number;
  line: string;
}

interface LokiStream {
  values?: [string, string][]; // [unixNano, line]
}

function parseStreams(streams: LokiStream[] | undefined): LogLine[] {
  const out: LogLine[] = [];
  for (const s of streams ?? []) {
    for (const [ns, line] of s.values ?? []) {
      out.push({ ts: Math.floor(Number(ns) / 1e6), line });
    }
  }
  return out.sort((a, b) => a.ts - b.ts);
}

/** Grafana Loki client: query_range history + live tail over WebSocket. */
export class LokiClient {
  constructor(
    private readonly url: string,
    private readonly fetchFn: typeof fetch = globalThis.fetch,
  ) {}

  /** Fetch the recent log history for a LogQL selector. */
  async history(selector: string, rangeSeconds = 3600, limit = 200): Promise<LogLine[]> {
    const end = Date.now() * 1e6;
    const start = (Date.now() - rangeSeconds * 1000) * 1e6;
    const params = new URLSearchParams({
      query: selector,
      start: String(start),
      end: String(end),
      limit: String(limit),
      direction: 'backward',
    });
    const res = await this.fetchFn(`${this.url}/loki/api/v1/query_range?${params}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`loki query_range: HTTP ${res.status}`);
    const json = (await res.json()) as { data?: { result?: LokiStream[] } };
    return parseStreams(json.data?.result);
  }

  /** Open a live tail for a host selector; pushes new lines onto the broker. */
  tail(
    selector: string,
    hostId: string,
    broker: EventBroker,
    log?: (m: string, e?: unknown) => void,
  ): () => void {
    let stopped = false;
    let ws: WebSocket | null = null;
    let delay = 1_000;
    let timer: NodeJS.Timeout | null = null;

    const connect = () => {
      const wsUrl = `${this.url.replace(/^http/, 'ws')}/loki/api/v1/tail?query=${encodeURIComponent(selector)}`;
      ws = new WebSocket(wsUrl);
      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString()) as { streams?: LokiStream[] };
          for (const entry of parseStreams(msg.streams)) {
            broker.broadcast({ hostId, type: 'log', data: entry });
          }
        } catch {
          /* ignore malformed frames */
        }
      });
      ws.on('error', (err) => log?.(`[loki:${hostId}] socket error`, err));
      ws.on('open', () => {
        delay = 1_000;
      });
      ws.on('close', () => {
        ws = null;
        if (stopped) return;
        timer = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 30_000);
      });
    };

    connect();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      ws?.close();
    };
  }
}

export const __test = { parseStreams };
