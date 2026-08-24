/**
 * `POST /v1/chat/completions` — non-streaming chat completion proxy
 * (SPEC.md feature 1).
 *
 * Mirrors `src/routes/models.ts`: one `registerChat(app, ctx)` function,
 * one `app.post(...)` call, plain objects returned from an async handler.
 *
 * The logical model name from the request is resolved to a physical name
 * the upstream backend understands. Only the first target is used —
 * failover is a later phase.
 */
import type { FastifyInstance } from 'fastify';
import type { GatewayContext } from '../context.ts';
import { resolveLogical } from '../config.ts';

export function registerChat(app: FastifyInstance, ctx: GatewayContext): void {
  app.post('/v1/chat/completions', async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const logicalModel = body.model as string | undefined;

    // Missing model → 404
    if (!logicalModel) {
      return reply.status(404).send({
        error: {
          message: `Model '${logicalModel}' not found`,
          type: 'invalid_request_error',
          code: 'model_not_found',
        },
      });
    }

    const targets = resolveLogical(ctx.config, logicalModel);

    // Unknown logical model → 404
    if (targets.length === 0) {
      return reply.status(404).send({
        error: {
          message: `Model '${logicalModel}' not found`,
          type: 'invalid_request_error',
          code: 'model_not_found',
        },
      });
    }

    // Streaming not implemented → 501
    if (body.stream === true) {
      return reply.status(501).send({
        error: {
          message: 'Streaming is not implemented',
          type: 'invalid_request_error',
          code: 'streaming_not_implemented',
        },
      });
    }

    const target = targets[0]!;
    const upstreamUrl = `${target.backend.baseUrl}/chat/completions`;

    // Replace logical model with physical model for the upstream
    const upstreamBody = { ...body, model: target.model };

    try {
      const response = await ctx.egress.fetch(upstreamUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(upstreamBody),
      });

      const responseBody = await response.json();
      return reply.status(response.status).send(responseBody);
    } catch (error) {
      return reply.status(502).send({
        error: {
          message: (error as Error).message,
          type: 'upstream_unavailable',
          code: 'upstream_unavailable',
        },
      });
    }
  });
}
