import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { requireUser } from '../session.js';

export async function streamRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { store, realtime } = ctx;

  app.get('/api/stream', { config: { rateLimit: false } }, async (request, reply) => {
    const user = requireUser(store, request);

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write(`data: ${JSON.stringify({ type: 'hello', at: Date.now() })}\n\n`);

    realtime.add(user.id, reply);
    request.raw.on('close', () => realtime.remove(user.id, reply));

    // Keep the request open; the reply is written to by Realtime.publish.
    return reply;
  });
}
