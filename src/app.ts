/**
 * Builds the gateway as a Fastify instance. Nothing here listens on a port —
 * `src/main.ts` does that for production, tests use `app.inject()`.
 *
 * Adding a route means: write `src/routes/<name>.ts` mirroring
 * `src/routes/healthz.ts`, import its `register<Name>` here, and call it below.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { registerAuth } from './auth.ts';
import type { Config } from './config.ts';
import type { GatewayContext } from './context.ts';
import { createEgressGuard, type EgressGuard } from './egress.ts';
import { createHealthRegistry, type HealthRegistry } from './health.ts';
import { createLedger, type Ledger } from './ledger.ts';
import { createMetrics, type Metrics } from './metrics.ts';
import { registerAttest } from './routes/attest.ts';
import { registerHealthz } from './routes/healthz.ts';
import { registerMetrics } from './routes/metrics.ts';
import { registerModels } from './routes/models.ts';
import { registerChat } from './routes/chat.ts';
import { registerEvents } from './routes/events.ts';
import { registerRoot } from './routes/root.ts';

export type CreateAppOptions = {
  /** Override the boot-bound guard; tests use this to inject a fetch spy. */
  egress?: EgressGuard;
  /** Override the health registry; tests use this to pre-set backend state. */
  health?: HealthRegistry;
  /** Override the ledger; tests use this to read `tail()` afterwards. */
  ledger?: Ledger;
  /** Override the metrics registry; tests use this to pre-load counters. */
  metrics?: Metrics;
  /**
   * Start the background probe loop. Production sets it; tests leave it off
   * and drive `ctx.health.probeAll()` by hand so nothing runs in the dark.
   */
  probe?: boolean;
  logger?: boolean;
};

export function createApp(config: Config, options: CreateAppOptions = {}): FastifyInstance {
  const ledger = options.ledger ?? createLedger(config);
  // A refused destination is a ledger event: it is what the dashboard's
  // egress feed and the attestation panel are for.
  const egress =
    options.egress ??
    createEgressGuard(config, undefined, (destination) => {
      ledger.append({ event: 'egress_refused', destination });
    });

  const ctx: GatewayContext = {
    config,
    egress,
    health: options.health ?? createHealthRegistry(config, egress),
    ledger,
    metrics: options.metrics ?? createMetrics(),
  };

  const app = Fastify({ logger: options.logger ?? false });

  registerAuth(app, ctx);
  registerHealthz(app, ctx);
  registerAttest(app, ctx);
  registerMetrics(app, ctx);
  registerModels(app, ctx);
  registerChat(app, ctx);
  registerEvents(app, ctx);
  registerRoot(app, ctx);

  // Closing the app must leave no probe timer and no open file behind.
  app.addHook('onClose', async () => {
    ctx.health.stop();
    await ctx.ledger.close();
  });

  if (options.probe) ctx.health.start();

  return app;
}
