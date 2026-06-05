import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import type { AppContext } from './context';
import { registerRoutes } from './routes/index';

/** Build the Fastify app: API routes + (in production) the built static frontend. */
export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  registerRoutes(app, ctx);

  // Serve the built SPA when present (production image). In dev, Vite serves it
  // and proxies /api here, so the directory may not exist — that's fine.
  if (existsSync(ctx.config.webDir)) {
    await app.register(fastifyStatic, { root: ctx.config.webDir });
    app.setNotFoundHandler((req, reply) => {
      if (req.raw.url?.startsWith('/api')) {
        return reply.code(404).send({ error: 'not found' });
      }
      return reply.sendFile('index.html');
    });
  }

  return app;
}
