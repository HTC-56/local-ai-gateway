/**
 * `POST /v1/chat/completions` — non-streaming chat completion proxy with
 * failover (TASK_PHASE_B.md §B2).
 *
 * Mirrors `src/routes/models.ts`: one `registerChat(app, ctx)` function,
 * one `app.post(...)` call, plain objects returned from an async handler.
 *
 * Walks every resolved target in priority order. Skips backends whose
 * circuit is open (via `ctx.health.isUsable`). Reports each outcome to
 * `ctx.health` so the fleet view stays live. Records every attempt and
 * outcome to `ctx.metrics` and `ctx.ledger` (TASK_PHASE_C.md §C3).
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

    // Compute body-derived summary for the ledger.
    const messageCount = Array.isArray(body.messages)
      ? body.messages.length
      : 0;
    const detail = { messages: messageCount };

    // Walk every target in priority order, skipping unusable backends.
    let attempted = 0;

    for (const target of targets) {
      // Skip backends with open circuits — never contact them.
      if (!ctx.health.isUsable(target.backend.name)) {
        continue;
      }

      attempted++;

      const upstreamUrl = `${target.backend.baseUrl}/chat/completions`;
      const upstreamBody = { ...body, model: target.model };
      const startTime = Date.now();

      try {
        const response = await ctx.egress.fetch(upstreamUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(upstreamBody),
        });

        const elapsed = Date.now() - startTime;

        // Status < 500 is a real answer — return it immediately.
        if (response.status < 500) {
          ctx.health.reportSuccess(target.backend.name, elapsed);
          ctx.metrics.recordUpstreamLatency(target.backend.name, elapsed);
          ctx.metrics.recordRequest(logicalModel, 'ok');
          ctx.ledger.append({
            event: 'request',
            model: logicalModel,
            backend: target.backend.name,
            upstreamModel: target.model,
            status: response.status,
            latencyMs: elapsed,
            attempts: attempted,
            detail,
          });
          const responseBody = await response.json();
          return reply.status(response.status).send(responseBody);
        }

        // Status >= 500 is a backend failure — report and continue.
        ctx.health.reportFailure(
          target.backend.name,
          new Error(`HTTP ${response.status}`),
        );
        ctx.metrics.recordFailover(logicalModel, target.backend.name);
        ctx.ledger.append({
          event: 'failover',
          model: logicalModel,
          backend: target.backend.name,
          error: `HTTP ${response.status}`,
        });
      } catch (error) {
        // Connection error or other failure — report and continue.
        ctx.health.reportFailure(target.backend.name, error);
        ctx.metrics.recordFailover(logicalModel, target.backend.name);
        ctx.ledger.append({
          event: 'failover',
          model: logicalModel,
          backend: target.backend.name,
          error: String(error),
        });
      }
    }

    // Nothing succeeded.
    if (attempted > 0) {
      ctx.metrics.recordRequest(logicalModel, 'error');
      ctx.ledger.append({
        event: 'request',
        model: logicalModel,
        status: 502,
        attempts: attempted,
      });
      return reply.status(502).send({
        error: {
          message: 'All upstream targets failed',
          type: 'upstream_unavailable',
          code: 'upstream_unavailable',
        },
      });
    }

    ctx.metrics.recordRequest(logicalModel, 'error');
    ctx.ledger.append({
      event: 'request',
      model: logicalModel,
      status: 503,
      attempts: 0,
    });
    return reply.status(503).send({
      error: {
        message: 'No healthy backend available',
        type: 'unavailable',
        code: 'no_healthy_backend',
      },
    });
  });
}
