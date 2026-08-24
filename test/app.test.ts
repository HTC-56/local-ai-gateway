import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { parseConfig } from '../src/config.ts';

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
          },
        ],
      });
    } finally {
      await app.close();
    }
  });
});
