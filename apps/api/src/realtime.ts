import type { FastifyReply } from 'fastify';
import type { StreamEvent } from '@solder/shared';

/**
 * Server-sent events: one long-lived GET per signed-in tab. Simpler than a
 * WebSocket, survives proxies, and reconnects on its own.
 */
export class Realtime {
  private readonly clients = new Map<string, Set<FastifyReply>>();
  private readonly heartbeat: NodeJS.Timeout;

  constructor() {
    this.heartbeat = setInterval(() => {
      for (const replies of this.clients.values()) {
        for (const reply of replies) reply.raw.write(': ping\n\n');
      }
    }, 25_000);
    this.heartbeat.unref?.();
  }

  add(userId: string, reply: FastifyReply): void {
    const replies = this.clients.get(userId) ?? new Set<FastifyReply>();
    replies.add(reply);
    this.clients.set(userId, replies);
  }

  remove(userId: string, reply: FastifyReply): void {
    const replies = this.clients.get(userId);
    if (!replies) return;
    replies.delete(reply);
    if (replies.size === 0) this.clients.delete(userId);
  }

  publish(userId: string, event: StreamEvent): void {
    const replies = this.clients.get(userId);
    if (!replies) return;
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const reply of replies) {
      try {
        reply.raw.write(payload);
      } catch {
        this.remove(userId, reply);
      }
    }
  }

  close(): void {
    clearInterval(this.heartbeat);
    for (const replies of this.clients.values()) {
      for (const reply of replies) {
        try { reply.raw.end(); } catch { /* already gone */ }
      }
    }
    this.clients.clear();
  }
}
