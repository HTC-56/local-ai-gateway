/**
 * Tests for `GET /metrics` — Prometheus text exposition.
 *
 * Phase C: mirrors `test/attest.test.ts` — module-level `parseConfig`,
 * `createApp`, `app.inject`, `await app.close()` in a `finally`.
 */
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { parseConfig } from '../src/config.ts';
import { createMetrics } from '../src/metrics.ts';

const config = parseConfig({
  backends: [
    { name: 'box-a', baseUrl: 'http://192.0.2.10:11434/v1' },
  ],
  models: {
    fast: [
      { backend: 'box-a', model: 'mock-model' },
    ],
  },
});

describe('GET /metrics', () => {
  it('answers 200 and sets text/plain content-type', async () => {
    const app = createApp(config);
    try {
      const response = await app.inject({ method: 'GET', url: '/metrics' });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/plain');
    } finally {
      await app.close();
    }
  });

  it('contains gateway_backend_up{backend="box-a"} 0 on a fresh gateway', async () => {
    const app = createApp(config);
    try {
      const response = await app.inject({ method: 'GET', url: '/metrics' });

      const body = response.body as string;
      expect(body).toContain('gateway_backend_up{backend="box-a"} 0');
    } finally {
      await app.close();
    }
  });

  it('contains gateway_egress_allowed_total 0 on a fresh gateway', async () => {
    const app = createApp(config);
    try {
      const response = await app.inject({ method: 'GET', url: '/metrics' });

      const body = response.body as string;
      expect(body).toContain('gateway_egress_allowed_total 0');
    } finally {
      await app.close();
    }
  });

  it('reflects a manually-recorded request when metrics is injected', async () => {
    const metrics = createMetrics();
    metrics.recordRequest('fast', 'ok');

    const app = createApp(config, { metrics });
    try {
      const response = await app.inject({ method: 'GET', url: '/metrics' });

      const body = response.body as string;
      expect(body).toContain('gateway_requests_total{model="fast",outcome="ok"} 1');
    } finally {
      await app.close();
    }
  });
});
