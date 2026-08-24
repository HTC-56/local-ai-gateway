/**
 * `GET /healthz` — per-backend state from the live health registry.
 *
 * Phase B: replaces the Phase A placeholder (every backend `unknown`) with
 * real data from `ctx.health.snapshot()`.
 *
 * Phase E: each row also carries `models`, the physical models config routes
 * to that backend, so a dashboard fleet card can name them without a second
 * endpoint.
 */
import type { FastifyInstance } from 'fastify';
import type { GatewayContext } from '../context.ts';
import { modelsFor } from '../config.ts';
import type { BackendHealth } from '../health.ts';

export type { BackendHealth } from '../health.ts';

/** One `/healthz` row: live health plus the models routed to that backend. */
export type BackendHealthRow = BackendHealth & { models: string[] };

export function registerHealthz(app: FastifyInstance, ctx: GatewayContext): void {
  app.get('/healthz', async () => {
    const backends: BackendHealthRow[] = ctx.health
      .snapshot()
      .map((backend) => ({ ...backend, models: modelsFor(ctx.config, backend.name) }));
    const status = backends.some((b) => b.state === 'unhealthy') ? 'degraded' : 'ok';
    return { status, backends };
  });
}
