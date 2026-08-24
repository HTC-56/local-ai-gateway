/**
 * `POST /v1/chat/completions` — streaming pass-through tests.
 *
 * Mirrors `test/chat.test.ts`: module-level `parseConfig` and `createApp`
 * imports, `startMockUpstream` from `./helpers/mock-upstream.ts`, the config
 * built **after** the upstream is running so the backend's `baseUrl` is
 * `upstream.baseUrl`, `app.inject` to drive it, `await app.close()` and
 * `await upstream.close()` in a `finally`.
 *
 * One backend, `box-a`, mapped from the logical model `fast` to a physical
 * model name.
 */
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { parseConfig } from '../src/config.ts';
import { createLedger } from '../src/ledger.ts';
import { startMockUpstream } from './helpers/mock-upstream.ts';

describe('POST /v1/chat/completions — streaming', () => {
  it('stream: true returns 200 with SSE content-type and no-cache', async () => {
    const upstream = await startMockUpstream({ content: 'streamed words' });
    const config = parseConfig({
      backends: [{ name: 'box-a', baseUrl: upstream.baseUrl }],
      models: {
        fast: [{ backend: 'box-a', model: 'qwen-2.5-7b' }],
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
      expect(response.headers['cache-control']).toContain('no-cache');
    } finally {
      await app.close();
      await upstream.close();
    }
  });

  it('payload has exactly four data: frames, ends with [DONE], forwards upstream content', async () => {
    const upstream = await startMockUpstream({ content: 'streamed words' });
    const config = parseConfig({
      backends: [{ name: 'box-a', baseUrl: upstream.baseUrl }],
      models: {
        fast: [{ backend: 'box-a', model: 'qwen-2.5-7b' }],
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

      const body = response.body as string;
      const dataFrames = body.split('\n').filter((line) => line.startsWith('data: '));
      expect(dataFrames).toHaveLength(4);
      expect(body).toContain('data: [DONE]');
      expect(body).toContain('"content":"streamed words"');
    } finally {
      await app.close();
      await upstream.close();
    }
  });

  it('upstream receives the physical model name with stream: true', async () => {
    const upstream = await startMockUpstream();
    const config = parseConfig({
      backends: [{ name: 'box-a', baseUrl: upstream.baseUrl }],
      models: {
        fast: [{ backend: 'box-a', model: 'qwen-2.5-7b' }],
      },
    });

    const app = createApp(config);
    try {
      await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        payload: { model: 'fast', messages: [], stream: true },
      });

      const chatRequests = upstream.requests.filter(
        (r) => r.url.includes('/chat/completions'),
      );
      expect(chatRequests).toHaveLength(1);
      const requestBody = chatRequests[0]!.body as Record<string, unknown>;
      expect(requestBody.model).toBe('qwen-2.5-7b');
      expect(requestBody.stream).toBe(true);
    } finally {
      await app.close();
      await upstream.close();
    }
  });

  it('omitting stream takes the JSON path', async () => {
    const upstream = await startMockUpstream({ content: 'streamed words' });
    const config = parseConfig({
      backends: [{ name: 'box-a', baseUrl: upstream.baseUrl }],
      models: {
        fast: [{ backend: 'box-a', model: 'qwen-2.5-7b' }],
      },
    });

    const app = createApp(config);
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        payload: { model: 'fast', messages: [] },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('application/json');

      const body = response.json() as { choices: Array<{ message: { content: string } }> };
      expect(body.choices[0]!.message.content).toBe('streamed words');
    } finally {
      await app.close();
      await upstream.close();
    }
  });

  it('ledger records a request entry with stream: true', async () => {
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
      await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        payload: { model: 'fast', messages: [], stream: true },
      });

      const entries = ledger.tail(10) as Array<Record<string, unknown>>;
      const requestEntry = entries.find((e) => e.event === 'request');
      expect(requestEntry).toBeDefined();
      expect(requestEntry!.stream).toBe(true);
      expect(requestEntry!.backend).toBe('box-a');
      expect(requestEntry!.status).toBe(200);
    } finally {
      await app.close();
      await upstream.close();
    }
  });
});
