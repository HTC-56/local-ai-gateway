/**
 * Builds the gateway as a Fastify instance. Nothing here listens on a port —
 * `src/main.ts` does that for production, tests use `app.inject()`.
 *
 * Adding a route means: write `src/routes/<name>.ts` mirroring
 * `src/routes/healthz.ts`, import its `register<Name>` here, and call it below.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config.ts';
import type { GatewayContext } from './context.ts';
import { createEgressGuard, type EgressGuard } from './egress.ts';
import { registerHealthz } from './routes/healthz.ts';
import { registerModels } from './routes/models.ts';
import { registerChat } from './routes/chat.ts';

export type CreateAppOptions = {
  /** Override the boot-bound guard; tests use this to inject a fetch spy. */
  egress?: EgressGuard;
  logger?: boolean;
};

export function createApp(config: Config, options: CreateAppOptions = {}): FastifyInstance {
  const ctx: GatewayContext = {
    config,
    egress: options.egress ?? createEgressGuard(config),
  };

  const app = Fastify({ logger: options.logger ?? false });

  registerHealthz(app, ctx);
  registerModels(app, ctx);
  registerChat(app, ctx);

  return app;
}
