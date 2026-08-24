/**
 * `GET /attest` — egress allowlist, refusal counters, and backend destinations.
 *
 * Phase C: mirrors `src/routes/healthz.ts` — one register function, one
 * `app.get()`, a plain object built from `ctx.egress.snapshot()`.
 */
import type { FastifyInstance } from 'fastify';
import type { GatewayContext } from '../context.ts';
import { destinationOf } from '../egress.ts';

export function registerAttest(app: FastifyInstance, ctx: GatewayContext): void {
  app.get('/attest', async () => {
    const snap = ctx.egress.snapshot();
    const backends = ctx.config.backends.map((b) => ({
      name: b.name,
      destination: destinationOf(new URL(b.baseUrl)),
    }));
    return { ...snap, backends };
  });
}
