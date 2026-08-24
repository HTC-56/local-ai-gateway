/**
 * `GET /events` — the ledger tail over HTTP.
 *
 * Phase E: mirrors `src/routes/attest.ts` — one register function, one
 * `app.get()`, a plain object built from `ctx.ledger.tail()`.
 */
import type { FastifyInstance } from 'fastify';
import type { GatewayContext } from '../context.ts';

export function registerEvents(app: FastifyInstance, ctx: GatewayContext): void {
  app.get('/events', async (request) => {
    const raw = request.query as Record<string, string | undefined>;
    const parsed = Number(raw.limit);
    const limit = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 200) : 50;
    return { events: ctx.ledger.tail(limit) };
  });
}
