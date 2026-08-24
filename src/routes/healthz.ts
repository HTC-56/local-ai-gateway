/**
 * `GET /healthz` — per-backend state (SPEC.md feature 6).
 *
 * This is also the pattern file for every other route: one `register<Name>`
 * function taking (app, ctx), one `app.<verb>` call, plain objects returned
 * from an async handler.
 *
 * Phase A reports every backend as `unknown`; the health prober that fills in
 * real states and probe timestamps lands in a later phase.
 */
import type { FastifyInstance } from 'fastify';
import type { GatewayContext } from '../context.ts';

export type BackendHealth = {
  name: string;
  baseUrl: string;
  state: 'unknown' | 'healthy' | 'unhealthy';
  lastProbe: string | null;
};

export function registerHealthz(app: FastifyInstance, ctx: GatewayContext): void {
  app.get('/healthz', async () => {
    const backends: BackendHealth[] = ctx.config.backends.map((backend) => ({
      name: backend.name,
      baseUrl: backend.baseUrl,
      state: 'unknown',
      lastProbe: null,
    }));

    return { status: 'ok', backends };
  });
}
