/**
 * The bundle every route handler gets. Routes read from here instead of
 * reaching for module-level state, which keeps tests able to build a gateway
 * per test with its own config and its own egress guard.
 */
import type { Config } from './config.ts';
import type { EgressGuard } from './egress.ts';
import type { HealthRegistry } from './health.ts';

export type GatewayContext = {
  config: Config;
  egress: EgressGuard;
  /** Live per-backend state; routes ask `isUsable` before sending. */
  health: HealthRegistry;
};
