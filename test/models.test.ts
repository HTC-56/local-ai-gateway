/**
 * `GET /v1/models` — verify the OpenAI-compatible model list endpoint.
 *
 * Mirrors `test/app.test.ts`: build a config with `parseConfig`, create the
 * app with `createApp`, drive it with `app.inject`, close in a `finally`.
 */
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { parseConfig } from '../src/config.ts';

const config = parseConfig({
  backends: [
    { name: 'box-a', baseUrl: 'http://192.0.2.10:11434/v1' },
    { name: 'box-b', baseUrl: 'http://192.0.2.11:8080/v1' },
    { name: 'box-c', baseUrl: 'http://192.0.2.12:8888/v1' },
  ],
  models: {
    heavy: [{ backend: 'box-a', model: 'llama-3.1-405b' }],
    fast: [{ backend: 'box-b', model: 'qwen-2.5-7b' }],
    coder: [{ backend: 'box-c', model: 'codestral' }],
  },
});

describe('GET /v1/models', () => {
  it('returns the OpenAI model-list shape', async () => {
    const app = createApp(config);
    try {
      const response = await app.inject({ method: 'GET', url: '/v1/models' });

      expect(response.statusCode).toBe(200);

      const body = response.json() as Record<string, unknown>;

      // 1. top-level object is 'list'
      expect(body.object).toBe('list');

      // 2. data.map(m => m.id) equals the logical names in sorted order
      const data = body.data as Array<Record<string, unknown>>;
      const ids = data.map((m) => m.id as string);
      expect(ids).toEqual(['coder', 'fast', 'heavy']);

      // 3. every entry has object === 'model' and owned_by === 'local-ai-gateway'
      for (const m of data) {
        expect(m.object).toBe('model');
        expect(m.owned_by).toBe('local-ai-gateway');
      }

      // 4. created is a positive integer (no fractional milliseconds)
      for (const m of data) {
        const created = m.created as number;
        expect(created).toBeTypeOf('number');
        expect(created).toBeGreaterThanOrEqual(1);
        expect(created).toBe(Math.floor(created));
      }
    } finally {
      await app.close();
    }
  });
});
