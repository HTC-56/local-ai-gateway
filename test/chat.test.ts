/**
 * `POST /v1/chat/completions` — non-streaming chat completion proxy.
 *
 * Mirrors `test/models.test.ts` / `test/egress.test.ts`: start a mock upstream
 * with `startMockUpstream`, build the config **after** it is running so a
 * backend's `baseUrl` is `upstream.baseUrl`, drive the gateway with
 * `app.inject`, close the app and the upstream in a `finally`.
 */
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { parseConfig } from '../src/config.ts';
import { startMockUpstream } from './helpers/mock-upstream.ts';

describe('POST /v1/chat/completions', () => {
  it('unknown logical model returns 404 with model_not_found', async () => {
    const upstream = await startMockUpstream();
    const config = parseConfig({
      backends: [{ name: 'box-a', baseUrl: upstream.baseUrl }],
      models: {
        heavy: [{ backend: 'box-a', model: 'llama-3.1-405b' }],
      },
    });

    const app = createApp(config);
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        payload: { model: 'nonexistent', messages: [] },
      });

      expect(response.statusCode).toBe(404);

      const body = response.json() as { error: { code: string } };
      expect(body.error.code).toBe('model_not_found');
    } finally {
      await app.close();
      await upstream.close();
    }
  });

  it('stream: true pipes SSE from upstream', async () => {
    const upstream = await startMockUpstream();
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

      const body = response.body as string;
      expect(body).toContain('data: [DONE]');

      // Upstream should have received exactly one chat request with stream: true
      const chatRequests = upstream.requests.filter(
        (r) => r.url.includes('/chat/completions'),
      );
      expect(chatRequests).toHaveLength(1);
      const requestBody = chatRequests[0]!.body as Record<string, unknown>;
      expect(requestBody.stream).toBe(true);
    } finally {
      await app.close();
      await upstream.close();
    }
  });

  it('valid request returns 200 with physical model name', async () => {
    const upstream = await startMockUpstream();
    const config = parseConfig({
      backends: [{ name: 'box-a', baseUrl: upstream.baseUrl }],
      models: {
        heavy: [{ backend: 'box-a', model: 'llama-3.1-405b' }],
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

      const body = response.json() as Record<string, unknown>;
      // Physical model name from config, not logical name
      expect(body.model).toBe('llama-3.1-405b');
    } finally {
      await app.close();
      await upstream.close();
    }
  });

  it('response body is the upstream JSON — choices[0].message.content survives', async () => {
    const upstream = await startMockUpstream({ content: 'hello from llama' });
    const config = parseConfig({
      backends: [{ name: 'box-a', baseUrl: upstream.baseUrl }],
      models: {
        heavy: [{ backend: 'box-a', model: 'llama-3.1-405b' }],
      },
    });

    const app = createApp(config);
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        payload: { model: 'heavy', messages: [{ role: 'user', content: 'hi' }] },
      });

      expect(response.statusCode).toBe(200);

      const body = response.json() as { choices: Array<{ message: { content: string } }> };
      expect(body.choices).toHaveLength(1);
      expect(body.choices[0]!.message.content).toBe('hello from llama');
    } finally {
      await app.close();
      await upstream.close();
    }
  });
});
