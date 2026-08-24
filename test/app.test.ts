import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { parseConfig } from '../src/config.ts';
import { createEgressGuard } from '../src/egress.ts';
import { createHealthRegistry } from '../src/health.ts';

const config = parseConfig({
  backends: [{ name: 'box-a', baseUrl: 'http://192.0.2.10:11434/v1' }],
  models: { fast: [{ backend: 'box-a', model: 'mock-model' }] },
});

describe('GET /healthz', () => {
  it('reports one entry per configured backend', async () => {
    const app = createApp(config);
    try {
      const response = await app.inject({ method: 'GET', url: '/healthz' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        status: 'ok',
        backends: [
          {
            name: 'box-a',
            baseUrl: 'http://192.0.2.10:11434/v1',
            state: 'unknown',
            lastProbe: null,
            latencyMs: null,
            consecutiveFailures: 0,
            lastError: null,
          },
        ],
      });
    } finally {
      await app.close();
    }
  });

  it('reports degraded when a backend is unhealthy', async () => {
    const health = createHealthRegistry(config, createEgressGuard(config));
    health.reportFailure('box-a', new Error('connect ECONNREFUSED'));

    const app = createApp(config, { health });
    try {
      const response = await app.inject({ method: 'GET', url: '/healthz' });

      const body = response.json() as Record<string, unknown>;
      expect(response.statusCode).toBe(200);
      expect(body.status).toBe('degraded');

      const backends = body.backends as Array<Record<string, unknown>>;
      expect(backends).toHaveLength(1);

      const backend = backends[0] as Record<string, unknown>;
      expect(backend.name).toBe('box-a');
      expect(backend.state).toBe('unhealthy');
      expect(backend.consecutiveFailures).toBe(1);
      expect(backend.lastError).toContain('ECONNREFUSED');
    } finally {
      await app.close();
    }
  });
});
