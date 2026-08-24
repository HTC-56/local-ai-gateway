/**
 * Static bearer token auth — an `onRequest` hook installed on the gateway.
 *
 * Phase C: protects every path except `/healthz` and `/`. Disabled when
 * `ctx.config.auth.token` is `null`.
 */
import { timingSafeEqual } from 'node:crypto';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { GatewayContext } from './context.ts';

const UNAUTHORIZED_BODY = {
  error: {
    message: 'Invalid or missing bearer token',
    type: 'invalid_request_error',
    code: 'invalid_api_key',
  },
};

export function registerAuth(app: FastifyInstance, ctx: GatewayContext): void {
  const token = ctx.config.auth.token;

  // Auth disabled — no hook, every request is open.
  if (token === null) return;

  const tokenBuf = Buffer.from(token);

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    // Exempt paths: strip query string before comparing.
    const url = request.url;
    const pathEnd = url.indexOf('?');
    const path = pathEnd === -1 ? url : url.slice(0, pathEnd);

    if (path === '/healthz' || path === '/') return;

    const authHeader = request.headers.authorization;

    // Require `Bearer <value>` — scheme is case-insensitive.
    if (!authHeader || authHeader.length < 7) {
      return reply.code(401).header('WWW-Authenticate', 'Bearer').send(UNAUTHORIZED_BODY);
    }

    const schemeEnd = authHeader.indexOf(' ');
    if (schemeEnd === -1) {
      return reply.code(401).header('WWW-Authenticate', 'Bearer').send(UNAUTHORIZED_BODY);
    }

    const scheme = authHeader.slice(0, schemeEnd);
    if (scheme.toLowerCase() !== 'bearer') {
      return reply.code(401).header('WWW-Authenticate', 'Bearer').send(UNAUTHORIZED_BODY);
    }

    const presented = authHeader.slice(schemeEnd + 1);
    const presentedBuf = Buffer.from(presented);

    // Different lengths → reject immediately (timingSafeEqual throws).
    if (presentedBuf.length !== tokenBuf.length) {
      return reply.code(401).header('WWW-Authenticate', 'Bearer').send(UNAUTHORIZED_BODY);
    }

    if (!timingSafeEqual(presentedBuf, tokenBuf)) {
      return reply.code(401).header('WWW-Authenticate', 'Bearer').send(UNAUTHORIZED_BODY);
    }
  });
}
