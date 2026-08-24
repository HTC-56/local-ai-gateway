/**
 * `GET /metrics` — Prometheus text exposition of the gateway state.
 *
 * Phase C: mirrors `src/routes/attest.ts` — one register function, one
 * `app.get()`, text response. No formatting logic lives here; the metrics
 * registry does all the work.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { GatewayContext } from '../context.ts';

export function registerMetrics(app: FastifyInstance, ctx: GatewayContext): void {
  app.get('/metrics', async (_request, reply: FastifyReply) => {
    const body = ctx.metrics.render({
      egress: ctx.egress.snapshot(),
      backends: ctx.health.snapshot(),
    });
    reply.header('content-type', 'text/plain; version=0.0.4; charset=utf-8');
    return body;
  });
}
