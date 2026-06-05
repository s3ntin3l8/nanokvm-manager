import type { AppEvent, HostsResponse, LogLine, PowerAction } from '../types';

export async function fetchHosts(): Promise<HostsResponse> {
  const res = await fetch('/api/hosts');
  if (!res.ok) throw new Error(`GET /api/hosts: ${res.status}`);
  return (await res.json()) as HostsResponse;
}

export async function sendPower(id: string, action: PowerAction): Promise<void> {
  const res = await fetch(`/api/hosts/${id}/power`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `power ${action} failed (${res.status})`);
  }
}

export async function fetchLogs(id: string, range = 3600): Promise<LogLine[]> {
  const res = await fetch(`/api/hosts/${id}/logs?range=${range}`);
  if (!res.ok) throw new Error(`GET logs: ${res.status}`);
  const body = (await res.json()) as { lines: LogLine[] };
  return body.lines;
}

/** Snapshot URL with a cache-buster so the <img> actually refreshes. */
export function snapshotUrl(id: string, bust: number): string {
  return `/api/hosts/${id}/snapshot?t=${bust}`;
}

export function subscribeEvents(onEvent: (event: AppEvent) => void): () => void {
  const source = new EventSource('/api/events');
  source.onmessage = (msg) => {
    try {
      onEvent(JSON.parse(msg.data) as AppEvent);
    } catch {
      /* ignore malformed frames */
    }
  };
  return () => source.close();
}
