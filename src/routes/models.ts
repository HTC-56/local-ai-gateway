/**
 * `GET /v1/models` — OpenAI-compatible model list (SPEC.md feature 3).
 *
 * Mirrors `src/routes/healthz.ts`: one `registerModels(app, ctx)` function,
 * one `app.get(...)` call, plain objects returned from an async handler.
 *
 * Physical model names are never exposed — clients only ever see logical
 * names resolved from config.
 */
import type { FastifyInstance } from 'fastify';
import type { GatewayContext } from '../context.ts';
import { listLogicalModels } from '../config.ts';

export function registerModels(app: FastifyInstance, ctx: GatewayContext): void {
  app.get('/v1/models', async () => {
    const names = listLogicalModels(ctx.config);
    const now = Math.floor(Date.now() / 1000);

    const data = names.map((id) => ({
      id,
      object: 'model',
      created: now,
      owned_by: 'local-ai-gateway',
    }));

    return { object: 'list', data };
  });
}
