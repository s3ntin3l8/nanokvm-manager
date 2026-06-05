export interface HostStatus {
  id: string;
  name: string;
  /** NanoKVM base URL — opened for full interactive control. */
  kvmUrl: string;
  online: boolean | null;
  power: boolean | null;
  hasHa: boolean;
  hasLoki: boolean;
  configured: boolean;
}

export interface HostsResponse {
  hosts: HostStatus[];
  discovered: HostStatus[];
}

export interface PowerInfo {
  watts: number | null;
  unit: string;
}

export interface LogLine {
  ts: number;
  line: string;
}

export type PowerAction = 'power' | 'reset' | 'longpress';

export interface AppEvent {
  hostId: string;
  type: 'power' | 'log' | 'status';
  data: unknown;
}
