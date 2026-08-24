/**
 * Entry point. `pnpm start` runs this directly — Node strips the types, so the
 * repo has no build step (SPEC.md non-goals).
 *
 * Config path: `$GATEWAY_CONFIG`, else `./gateway.yaml`.
 */
import { ConfigError, loadConfig } from './config.ts';
import { createApp } from './app.ts';

const configPath = process.env['GATEWAY_CONFIG'] ?? './gateway.yaml';

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

let config;
try {
  config = loadConfig(configPath);
} catch (error) {
  if (error instanceof ConfigError) {
    fail(`local-ai-gateway: ${configPath}\n  ${error.issues.join('\n  ')}`);
  }
  throw error;
}

const app = createApp(config, { logger: true, probe: true });

try {
  await app.listen({ host: config.listen.host, port: config.listen.port });
} catch (error) {
  fail(`local-ai-gateway: cannot listen: ${(error as Error).message}`);
}
