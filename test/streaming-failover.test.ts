/**
 * Streaming failover tests — walk the priority list with `stream: true`, skip
 * open circuits, report to `ctx.health` and `ctx.ledger`.
 *
 * Mirrors `test/failover.test.ts`: same imports, same shape, and the same
 * trick for a dead backend: a `baseUrl` nothing is listening on,
 * `http://127.0.0.1:1/v1`, refused instantly with no timers and no sleeping.
 *
 * No production code in this task. Assert four things:
 *
 * 1. Two backends in priority order — `box-a` from
 *    `startMockUpstream({ chatStatus: 500 })` first, `box-b` from
 *    `startMockUpstream()` second, `health: { cooldownMs: 1 }`. A `stream: true`
 *    request answers 200 `text/event-stream` containing `data: [DONE]`, and the
 *    failing upstream recorded exactly one chat request.
 * 2. Same setup, with a ledger passed via `createApp(config, { ledger })`: the
 *    tail holds a `failover` entry naming `box-a`, and after it a `request`
 *    entry naming `box-b` with `stream: true`.
 * 3. Both backends dead (`http://127.0.0.1:1/v1` and `http://127.0.0.1:2/v1`,
 *    `cooldownMs: 1`): a `stream: true` request answers **502** with JSON
 *    `error.code` of `upstream_unavailable`. A stream that never started is an
 *    ordinary error, not a half-open stream — no SSE headers on this answer.
 * 4. An open circuit is skipped for streaming too. One dead backend with
 *    `health: { cooldownMs: 30_000 }`: the first streaming request answers 502
 *    and opens the circuit; the second answers **503** with `error.code`
 *    `no_healthy_backend`, because the backend is skipped without being
 *    contacted.
 */
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { parseConfig } from '../src/config.ts';
import { createLedger } from '../src/ledger.ts';
import { startMockUpstream } from './helpers/mock-upstream.ts';

describe('POST /v1/chat/completions — streaming failover', () => {
  it('1. streaming failover works — dead backend first, live second', async () => {
    const upstream = await startMockUpstream({ chatStatus: 500 });
    const healthy = await startMockUpstream();
    const config = parseConfig({
      backends: [
        { name: 'box-a', baseUrl: upstream.baseUrl },
        { name: 'box-b', baseUrl: healthy.baseUrl },
      ],
      health: { cooldownMs: 1 },
      models: {
        fast: [
          { backend: 'box-a', model: 'qwen-2.5-7b' },
          { backend: 'box-b', model: 'llama-3.1-405b' },
        ],
      },
    });

    const app = createApp(config);
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        payload: { model: 'fast', messages: [], stream: true },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/event-stream');

      const body = response.body as string;
      expect(body).toContain('data: [DONE]');

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

  it('2. the failover is recorded in the ledger', async () => {
    const upstream = await startMockUpstream({ chatStatus: 500 });
    const healthy = await startMockUpstream();
    const config = parseConfig({
      backends: [
        { name: 'box-a', baseUrl: upstream.baseUrl },
        { name: 'box-b', baseUrl: healthy.baseUrl },
      ],
      health: { cooldownMs: 1 },
      models: {
        fast: [
          { backend: 'box-a', model: 'qwen-2.5-7b' },
          { backend: 'box-b', model: 'llama-3.1-405b' },
        ],
      },
    });

    const ledger = createLedger(config);
    const app = createApp(config, { ledger });
    try {
      await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        payload: { model: 'fast', messages: [], stream: true },
      });

      const entries = ledger.tail(10) as Array<Record<string, unknown>>;
      const failoverEntry = entries.find(
        (e) => e.event === 'failover',
      );
      const requestEntry = entries.find((e) => e.event === 'request');

      expect(failoverEntry).toBeDefined();
      expect(failoverEntry!.backend).toBe('box-a');

      expect(requestEntry).toBeDefined();
      expect(requestEntry!.backend).toBe('box-b');
      expect(requestEntry!.stream).toBe(true);
    } finally {
      await app.close();
      await upstream.close();
      await healthy.close();
    }
  });

  it('3. all streaming targets dead → 502 upstream_unavailable, no SSE headers', async () => {
    const config = parseConfig({
      backends: [
        { name: 'box-dead-1', baseUrl: 'http://127.0.0.1:1/v1' },
        { name: 'box-dead-2', baseUrl: 'http://127.0.0.1:2/v1' },
      ],
      health: { cooldownMs: 1 },
      models: {
        fast: [
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
        payload: { model: 'fast', messages: [], stream: true },
      });

      expect(response.statusCode).toBe(502);

      const body = response.json() as { error: { code: string } };
      expect(body.error.code).toBe('upstream_unavailable');

      // No SSE headers — a stream that never started is a plain error.
      expect(response.headers['content-type']).not.toContain('text/event-stream');
    } finally {
      await app.close();
    }
  });

  it('4. an open circuit is skipped for streaming — 503 no_healthy_backend', async () => {
    const config = parseConfig({
      backends: [{ name: 'box-dead', baseUrl: 'http://127.0.0.1:1/v1' }],
      health: { cooldownMs: 30_000 },
      models: {
        fast: [{ backend: 'box-dead', model: 'dead-model' }],
      },
    });

    const app = createApp(config);
    try {
      // First request — contacts the dead backend, gets connection refused,
      // returns 502. The circuit opens for 30 seconds.
      const first = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        payload: { model: 'fast', messages: [], stream: true },
      });
      expect(first.statusCode).toBe(502);

      // Second request — circuit is still open, backend is skipped,
      // no one is contacted → 503.
      const second = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        payload: { model: 'fast', messages: [], stream: true },
      });

      expect(second.statusCode).toBe(503);

      const body = second.json() as { error: { code: string } };
      expect(body.error.code).toBe('no_healthy_backend');
    } finally {
      await app.close();
    }
  });
});
