import type { AppConfig } from './config/index';
import type { DiscoveryService } from './discovery/mdns';
import type { EventBroker } from './events/broker';
import type { HostRegistry } from './hosts/registry';
import type { LokiClient } from './loki/client';

export interface AppContext {
  config: AppConfig;
  registry: HostRegistry;
  broker: EventBroker;
  loki?: LokiClient;
  discovery?: DiscoveryService;
}
