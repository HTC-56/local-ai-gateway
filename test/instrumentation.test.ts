/**
 * Instrumentation tests — the chat route records attempts to `ctx.metrics`
 * and `ctx.ledger` (TASK_PHASE_C.md §C3).
 *
 * Mirrors `test/failover.test.ts`: two mock upstreams, `startMockUpstream`,
 * build the ledger with `createLedger(config)` and pass it as
 * `createApp(config, { ledger })` so we can read `tail()`. Two mock upstreams,
 * `finally { await app.close() }`.
 */
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { parseConfig } from '../src/config.ts';
import { createLedger } from '../src/ledger.ts';
import { startMockUpstream } from './helpers/mock-upstream.ts';

describe('instrumentation', () => {
  it('1. successful request — ledger has one "request" entry with detail', async () => {
    const upstream = await startMockUpstream();
    const config = parseConfig({
      backends: [{ name: 'box-a', baseUrl: upstream.baseUrl }],
      models: {
        fast: [{ backend: 'box-a', model: 'qwen-2.5-7b' }],
      },
    });

    const ledger = createLedger(config);
    const app = createApp(config, { ledger });
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        payload: { model: 'fast', messages: [{ role: 'user', content: 'hello' }] },
      });

      expect(response.statusCode).toBe(200);

      const entries = ledger.tail();
      expect(entries).toHaveLength(1);
      expect(entries[0]!.event).toBe('request');
      expect(entries[0]!.backend).toBe('box-a');
      expect(entries[0]!.status).toBe(200);
      expect(entries[0]!.detail).toEqual({ messages: 1 });
    } finally {
      await app.close();
      await upstream.close();
    }
  });

  it('2. failover then success — ledger has "failover" then "request" with attempts', async () => {
    const failing = await startMockUpstream({ chatStatus: 500 });
    const healthy = await startMockUpstream({ chatStatus: 200 });
    const config = parseConfig({
      backends: [
        { name: 'box-a', baseUrl: failing.baseUrl },
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
      const response = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        payload: { model: 'fast', messages: [{ role: 'user', content: 'hello' }] },
      });

      expect(response.statusCode).toBe(200);

      const entries = ledger.tail();
      expect(entries).toHaveLength(2);
      expect(entries[0]!.event).toBe('failover');
      expect(entries[0]!.backend).toBe('box-a');
      expect(entries[1]!.event).toBe('request');
      expect(entries[1]!.backend).toBe('box-b');
      expect(entries[1]!.attempts).toBe(2);
    } finally {
      await app.close();
      await failing.close();
      await healthy.close();
    }
  });

  it('3. metrics — gateway_requests_total and gateway_failovers_total present', async () => {
    const failing = await startMockUpstream({ chatStatus: 500 });
    const healthy = await startMockUpstream({ chatStatus: 200 });
    const config = parseConfig({
      backends: [
        { name: 'box-a', baseUrl: failing.baseUrl },
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
      // Drive the failover request.
      await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        payload: { model: 'fast', messages: [{ role: 'user', content: 'hello' }] },
      });

      // Now check /metrics.
      const metricsResponse = await app.inject({
        method: 'GET',
        url: '/metrics',
      });

      expect(metricsResponse.statusCode).toBe(200);
      const body = metricsResponse.body as string;

      expect(body).toContain('gateway_requests_total{model="fast",outcome="ok"} 1');
      expect(body).toContain('gateway_failovers_total{model="fast",backend="box-a"} 1');
    } finally {
      await app.close();
      await failing.close();
      await healthy.close();
    }
  });

  it('4. unknown model — 404, nothing added to ledger', async () => {
    const upstream = await startMockUpstream();
    const config = parseConfig({
      backends: [{ name: 'box-a', baseUrl: upstream.baseUrl }],
      models: {
        fast: [{ backend: 'box-a', model: 'qwen-2.5-7b' }],
      },
    });

    const ledger = createLedger(config);
    const app = createApp(config, { ledger });
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        payload: { model: 'nonexistent', messages: [] },
      });

      expect(response.statusCode).toBe(404);

      expect(ledger.tail()).toHaveLength(0);
    } finally {
      await app.close();
      await upstream.close();
    }
  });
});
