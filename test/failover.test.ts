/**
 * Failover tests — walk the priority list, skip open circuits, report to
 * `ctx.health` (TASK_PHASE_B.md §B3).
 *
 * Mirrors `test/chat.test.ts`: start a mock upstream with `startMockUpstream`,
 * build the config **after** it is running so a backend's `baseUrl` is
 * `upstream.baseUrl`, drive the gateway with `app.inject`, close the app and
 * the upstream in a `finally`.
 *
 * A dead backend is just a `baseUrl` nothing is listening on —
 * `http://127.0.0.1:1/v1` — refused instantly, no timers, no sleeping.
 */
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { parseConfig } from '../src/config.ts';
import { startMockUpstream } from './helpers/mock-upstream.ts';

describe('failover', () => {
  it('1. failover works — dead backend first, live second', async () => {
    const upstream = await startMockUpstream();
    const config = parseConfig({
      backends: [
        { name: 'box-dead', baseUrl: 'http://127.0.0.1:1/v1' },
        { name: 'box-a', baseUrl: upstream.baseUrl },
      ],
      health: { cooldownMs: 1 },
      models: {
        heavy: [
          { backend: 'box-dead', model: 'dead-model' },
          { backend: 'box-a', model: 'llama-3.1-405b' },
        ],
      },
    });

    const app = createApp(config);
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        payload: { model: 'heavy', messages: [{ role: 'user', content: 'hello' }] },
      });

      expect(response.statusCode).toBe(200);

      // The mock recorded one chat request — to the second (live) target.
      const chatRequests = upstream.requests.filter(
        (r) => r.url.includes('/chat/completions'),
      );
      expect(chatRequests).toHaveLength(1);
      expect((chatRequests[0]!.body as { model: string }).model).toBe(
        'llama-3.1-405b',
      );
    } finally {
      await app.close();
      await upstream.close();
    }
  });

  it('2. the failure is recorded in health state', async () => {
    const upstream = await startMockUpstream();
    const config = parseConfig({
      backends: [
        { name: 'box-dead', baseUrl: 'http://127.0.0.1:1/v1' },
        { name: 'box-a', baseUrl: upstream.baseUrl },
      ],
      health: { cooldownMs: 1 },
      models: {
        heavy: [
          { backend: 'box-dead', model: 'dead-model' },
          { backend: 'box-a', model: 'llama-3.1-405b' },
        ],
      },
    });

    const app = createApp(config);
    try {
      // Drive a request so the dead backend fails over.
      await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        payload: { model: 'heavy', messages: [{ role: 'user', content: 'hello' }] },
      });

      const healthResponse = await app.inject({
        method: 'GET',
        url: '/healthz',
      });

      expect(healthResponse.statusCode).toBe(200);

      const body = healthResponse.json() as { backends: Array<{ name: string; state: string; consecutiveFailures: number }> };
      const dead = body.backends.find((b) => b.name === 'box-dead');
      const live = body.backends.find((b) => b.name === 'box-a');

      expect(dead?.state).toBe('unhealthy');
      expect(dead?.consecutiveFailures).toBe(1);
      expect(live?.state).toBe('healthy');
    } finally {
      await app.close();
      await upstream.close();
    }
  });

  it('3. all targets dead → 502 upstream_unavailable', async () => {
    const config = parseConfig({
      backends: [
        { name: 'box-dead-1', baseUrl: 'http://127.0.0.1:1/v1' },
        { name: 'box-dead-2', baseUrl: 'http://127.0.0.1:2/v1' },
      ],
      health: { cooldownMs: 1 },
      models: {
        heavy: [
          { backend: 'box-dead-1', model: 'dead-1' },
          { backend: 'box-dead-2', model: 'dead-2' },
        ],
      },
    });

    const app = createApp(config);
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        payload: { model: 'heavy', messages: [{ role: 'user', content: 'hello' }] },
      });

      expect(response.statusCode).toBe(502);

      const body = response.json() as { error: { code: string } };
      expect(body.error.code).toBe('upstream_unavailable');
    } finally {
      await app.close();
    }
  });

  it('4. an open circuit is skipped — 503 no_healthy_backend', async () => {
    const config = parseConfig({
      backends: [{ name: 'box-dead', baseUrl: 'http://127.0.0.1:1/v1' }],
      health: { cooldownMs: 30_000 },
      models: {
        heavy: [{ backend: 'box-dead', model: 'dead-model' }],
      },
    });

    const app = createApp(config);
    try {
      // First request — contacts the dead backend, gets connection refused,
      // returns 502. The circuit opens for 30 seconds.
      const first = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        payload: { model: 'heavy', messages: [{ role: 'user', content: 'hello' }] },
      });
      expect(first.statusCode).toBe(502);

      // Second request — circuit is still open, backend is skipped,
      // no one is contacted → 503.
      const second = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        payload: { model: 'heavy', messages: [{ role: 'user', content: 'hello' }] },
      });

      expect(second.statusCode).toBe(503);

      const body = second.json() as { error: { code: string } };
      expect(body.error.code).toBe('no_healthy_backend');
    } finally {
      await app.close();
    }
  });

  it('5. a 5xx upstream fails over too', async () => {
    const upstream = await startMockUpstream({ chatStatus: 500 });
    const healthy = await startMockUpstream({ chatStatus: 200 });
    const config = parseConfig({
      backends: [
        { name: 'box-a', baseUrl: upstream.baseUrl },
        { name: 'box-b', baseUrl: healthy.baseUrl },
      ],
      health: { cooldownMs: 1 },
      models: {
        heavy: [
          { backend: 'box-a', model: 'llama-3.1-405b' },
          { backend: 'box-b', model: 'qwen-2.5-7b' },
        ],
      },
    });

    const app = createApp(config);
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        payload: { model: 'heavy', messages: [{ role: 'user', content: 'hello' }] },
      });

      expect(response.statusCode).toBe(200);

      // The failing upstream recorded exactly one chat request.
      const chatRequests = upstream.requests.filter(
        (r) => r.url.includes('/chat/completions'),
      );
      expect(chatRequests).toHaveLength(1);
    } finally {
      await app.close();
      await upstream.close();
      await healthy.close();
    }
  });
});
