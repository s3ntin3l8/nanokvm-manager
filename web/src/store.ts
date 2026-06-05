import { create } from 'zustand';
import { fetchHosts } from './lib/api';
import type { AppEvent, HostStatus, LogLine, PowerInfo } from './types';

interface AppState {
  hosts: HostStatus[];
  discovered: HostStatus[];
  watts: Record<string, PowerInfo>;
  logs: Record<string, LogLine[]>;
  loading: boolean;
  error?: string;
  load: () => Promise<void>;
  applyEvent: (event: AppEvent) => void;
  prependLogs: (hostId: string, lines: LogLine[]) => void;
}

const MAX_LOG_LINES = 300;

export const useStore = create<AppState>((set) => ({
  hosts: [],
  discovered: [],
  watts: {},
  logs: {},
  loading: true,

  load: async () => {
    try {
      const data = await fetchHosts();
      set({ hosts: data.hosts, discovered: data.discovered, loading: false, error: undefined });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : String(err) });
    }
  },

  applyEvent: (event) => {
    if (event.type === 'power') {
      set((s) => ({ watts: { ...s.watts, [event.hostId]: event.data as PowerInfo } }));
    } else if (event.type === 'log') {
      set((s) => {
        const next = [...(s.logs[event.hostId] ?? []), event.data as LogLine].slice(-MAX_LOG_LINES);
        return { logs: { ...s.logs, [event.hostId]: next } };
      });
    }
  },

  prependLogs: (hostId, lines) => {
    set((s) => {
      const merged = [...lines, ...(s.logs[hostId] ?? [])].slice(-MAX_LOG_LINES);
      return { logs: { ...s.logs, [hostId]: merged } };
    });
  },
}));
