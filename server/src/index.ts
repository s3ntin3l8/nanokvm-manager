import { buildApp } from './app';
import { loadConfig } from './config/index';
import type { AppContext } from './context';
import { DiscoveryService } from './discovery/mdns';
import { EventBroker } from './events/broker';
import { HomeAssistantClient } from './homeassistant/client';
import { HostRegistry } from './hosts/registry';
import { LokiClient } from './loki/client';

async function main(): Promise<void> {
  const config = loadConfig();
  const broker = new EventBroker();
  const registry = new HostRegistry(config.hosts, config.nanokvm);
  const loki = config.loki ? new LokiClient(config.loki.url) : undefined;

  const ctx: AppContext = { config, registry, broker, loki };

  // Home Assistant power telemetry (optional).
  let ha: HomeAssistantClient | undefined;
  if (config.homeAssistant) {
    const entityToHost = new Map<string, string>();
    for (const h of config.hosts) if (h.haEntity) entityToHost.set(h.haEntity, h.id);
    ha = new HomeAssistantClient({
      url: config.homeAssistant.url,
      token: config.homeAssistant.token,
      entityToHost,
      broker,
      log: (m, e) => console.error(m, e ?? ''),
    });
    ha.start();
  }

  // Loki live tails (optional).
  const tailStops: Array<() => void> = [];
  if (loki) {
    for (const h of config.hosts) {
      if (h.lokiSelector) {
        tailStops.push(
          loki.tail(h.lokiSelector, h.id, broker, (m, e) => console.error(m, e ?? '')),
        );
      }
    }
  }

  // Optional mDNS discovery.
  if (config.mdns.enabled) {
    ctx.discovery = new DiscoveryService(new Set(config.hosts.map((h) => h.id)));
    ctx.discovery.start();
  }

  const app = await buildApp(ctx);
  await app.listen({ port: config.port, host: '0.0.0.0' });

  const shutdown = (): void => {
    ha?.stop();
    for (const stop of tailStops) stop();
    ctx.discovery?.stop();
    broker.close();
    void app.close().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
