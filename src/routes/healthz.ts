/**
 * `GET /healthz` — per-backend state from the live health registry.
 *
 * Phase B: replaces the Phase A placeholder (every backend `unknown`) with
 * real data from `ctx.health.snapshot()`.
 */
import type { FastifyInstance } from 'fastify';
import type { GatewayContext } from '../context.ts';
import type { BackendHealth } from '../health.ts';

export type { BackendHealth } from '../health.ts';

export function registerHealthz(app: FastifyInstance, ctx: GatewayContext): void {
  app.get('/healthz', async () => {
    const backends = ctx.health.snapshot();
    const status = backends.some((b) => b.state === 'unhealthy') ? 'degraded' : 'ok';
    return { status, backends };
  });
}
