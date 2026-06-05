import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context';
import type { PowerAction } from '../nanokvm/types';

const POWER_ACTIONS: PowerAction[] = ['power', 'reset', 'longpress'];

export function registerRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/health', async () => ({ status: 'ok', hosts: ctx.registry.list().length }));

  // Inventory + live status (configured hosts) plus any mDNS-discovered units.
  app.get('/api/hosts', async () => {
    const hosts = (await ctx.registry.statuses()).map((s) => ({ ...s, configured: true }));
    const discovered = (ctx.discovery?.list() ?? []).map((u) => ({
      ...u,
      online: null,
      power: null,
      hasHa: false,
      hasLoki: false,
      configured: false,
    }));
    return { hosts, discovered };
  });

  // ATX power control.
  app.post<{ Params: { id: string }; Body: { action?: string } }>(
    '/api/hosts/:id/power',
    async (req, reply) => {
      const client = ctx.registry.client(req.params.id);
      if (!client) return reply.code(404).send({ error: 'unknown host' });
      const action = req.body?.action;
      if (!action || !POWER_ACTIONS.includes(action as PowerAction)) {
        return reply.code(400).send({ error: `action must be one of ${POWER_ACTIONS.join(', ')}` });
      }
      await client.power(action as PowerAction);
      return { ok: true };
    },
  );

  // Single JPEG still (first MJPEG frame).
  app.get<{ Params: { id: string } }>('/api/hosts/:id/snapshot', async (req, reply) => {
    const client = ctx.registry.client(req.params.id);
    if (!client) return reply.code(404).send({ error: 'unknown host' });
    try {
      const jpeg = await client.snapshot();
      return reply.header('cache-control', 'no-store').type('image/jpeg').send(jpeg);
    } catch {
      return reply.code(502).send({ error: 'snapshot failed' });
    }
  });

  // Recent Loki history for a host.
  app.get<{ Params: { id: string }; Querystring: { range?: string } }>(
    '/api/hosts/:id/logs',
    async (req, reply) => {
      const host = ctx.registry.config(req.params.id);
      if (!host) return reply.code(404).send({ error: 'unknown host' });
      if (!ctx.loki || !host.lokiSelector) return { lines: [] };
      const range = Number(req.query.range ?? 3600) || 3600;
      try {
        return { lines: await ctx.loki.history(host.lokiSelector, range) };
      } catch {
        return reply.code(502).send({ error: 'loki query failed' });
      }
    },
  );

  // Unified SSE stream (HA power + Loki log lines).
  app.get('/api/events', (_req, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    reply.raw.write('retry: 5000\n\n');
    ctx.broker.add(reply.raw);
  });
}
