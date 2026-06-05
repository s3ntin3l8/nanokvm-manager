import Bonjour from 'bonjour-service';

type BonjourInstance = InstanceType<typeof Bonjour>;
type Service = InstanceType<typeof Bonjour.Service>;

export interface DiscoveredUnit {
  id: string;
  name: string;
  kvmUrl: string;
}

/**
 * Optional mDNS discovery of NanoKVM units on the LAN. Surfaces units that are
 * NOT already in the static config as "discovered, unconfigured".
 *
 * NOTE: multicast does not cross a Docker bridge network — this only finds units
 * when the container runs with host networking. Static config is the source of truth.
 */
export class DiscoveryService {
  private bonjour: BonjourInstance | null = null;
  private readonly found = new Map<string, DiscoveredUnit>();

  constructor(
    private readonly knownIds: Set<string>,
    private readonly serviceType = 'nanokvm',
  ) {}

  start(): void {
    this.bonjour = new Bonjour();
    this.bonjour.find({ type: this.serviceType }, (service: Service) => {
      const unit = toUnit(service);
      if (unit) this.found.set(unit.id, unit);
    });
  }

  /** Discovered units that are not already configured. */
  list(): DiscoveredUnit[] {
    return [...this.found.values()].filter((u) => !this.knownIds.has(u.id));
  }

  stop(): void {
    this.bonjour?.destroy();
    this.bonjour = null;
  }
}

function toUnit(service: Service): DiscoveredUnit | null {
  const id = service.name?.replace(/\.local\.?$/, '');
  if (!id) return null;
  const addr = service.addresses?.find((a: string) => !a.includes(':')) ?? service.host;
  if (!addr) return null;
  const port = service.port && service.port !== 80 ? `:${service.port}` : '';
  return { id, name: service.name ?? id, kvmUrl: `http://${addr}${port}` };
}
