import type { HostConfig } from '../config/index';
import { NanoKvmClient } from '../nanokvm/client';

export interface HostStatus {
  id: string;
  name: string;
  /** NanoKVM base URL — the frontend opens this for full interactive control. */
  kvmUrl: string;
  /** Whether the unit responded. */
  online: boolean;
  /** Host power state (pwr LED); null when offline/unknown. */
  power: boolean | null;
  hasHa: boolean;
  hasLoki: boolean;
}

/** Holds one NanoKvmClient per configured host and exposes aggregate status. */
export class HostRegistry {
  private readonly clients = new Map<string, NanoKvmClient>();
  private readonly byId = new Map<string, HostConfig>();

  constructor(hosts: HostConfig[], creds: { user: string; password: string }) {
    for (const host of hosts) {
      this.byId.set(host.id, host);
      this.clients.set(
        host.id,
        new NanoKvmClient({
          baseUrl: host.kvmUrl,
          username: host.user ?? creds.user,
          password: host.password ?? creds.password,
        }),
      );
    }
  }

  list(): HostConfig[] {
    return [...this.byId.values()];
  }

  config(id: string): HostConfig | undefined {
    return this.byId.get(id);
  }

  client(id: string): NanoKvmClient | undefined {
    return this.clients.get(id);
  }

  /** Probe every host's power state in parallel; offline hosts degrade gracefully. */
  async statuses(): Promise<HostStatus[]> {
    return Promise.all(
      this.list().map(async (host): Promise<HostStatus> => {
        const base: HostStatus = {
          id: host.id,
          name: host.name,
          kvmUrl: host.kvmUrl,
          online: false,
          power: null,
          hasHa: Boolean(host.haEntity),
          hasLoki: Boolean(host.lokiSelector),
        };
        try {
          const gpio = await this.clients.get(host.id)!.getGpio();
          return { ...base, online: true, power: gpio.pwr };
        } catch {
          return base;
        }
      }),
    );
  }
}
