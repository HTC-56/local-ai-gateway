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
import { createHealthRegistry, type HealthRegistry } from './health.ts';
import { registerHealthz } from './routes/healthz.ts';
import { registerModels } from './routes/models.ts';
import { registerChat } from './routes/chat.ts';

export type CreateAppOptions = {
  /** Override the boot-bound guard; tests use this to inject a fetch spy. */
  egress?: EgressGuard;
  /** Override the health registry; tests use this to pre-set backend state. */
  health?: HealthRegistry;
  /**
   * Start the background probe loop. Production sets it; tests leave it off
   * and drive `ctx.health.probeAll()` by hand so nothing runs in the dark.
   */
  probe?: boolean;
  logger?: boolean;
};

export function createApp(config: Config, options: CreateAppOptions = {}): FastifyInstance {
  const egress = options.egress ?? createEgressGuard(config);
  const ctx: GatewayContext = {
    config,
    egress,
    health: options.health ?? createHealthRegistry(config, egress),
  };

  const app = Fastify({ logger: options.logger ?? false });

  registerHealthz(app, ctx);
  registerModels(app, ctx);
  registerChat(app, ctx);

  // Closing the app must leave no probe timer behind.
  app.addHook('onClose', async () => {
    ctx.health.stop();
  });

  if (options.probe) ctx.health.start();

  return app;
}
