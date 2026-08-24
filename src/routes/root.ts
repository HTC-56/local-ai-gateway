/**
 * `GET /` — serve the dashboard page.
 *
 * Phase E: mirrors `src/routes/metrics.ts` — one register function, one
 * `app.get()`, reply.header then return body. The dashboard is a static HTML
 * page with no framework, no build step, no external requests.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { GatewayContext } from '../context.ts';
import { dashboardHtml } from '../dashboard.ts';

export function registerRoot(app: FastifyInstance, ctx: GatewayContext): void {
  app.get('/', async (_request, reply: FastifyReply) => {
    reply.header('content-type', 'text/html; charset=utf-8');
    reply.header('cache-control', 'no-store');
    return dashboardHtml();
  });
}
