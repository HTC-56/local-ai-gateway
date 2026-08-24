/**
 * Tests for `GET /` — dashboard page serving.
 *
 * Phase E: mirrors `test/metrics-route.test.ts` — module-level `parseConfig`,
 * `createApp`, `app.inject`, `await app.close()` in a `finally`.
 */
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { parseConfig } from '../src/config.ts';
import { dashboardHtml } from '../src/dashboard.ts';

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

describe('GET /', () => {
  it('answers 200 and sets text/html content-type', async () => {
    const app = createApp(config);
    try {
      const response = await app.inject({ method: 'GET', url: '/' });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
    } finally {
      await app.close();
    }
  });

  it('returns exactly dashboardHtml()', async () => {
    const app = createApp(config);
    try {
      const response = await app.inject({ method: 'GET', url: '/' });

      expect(response.body as string).toBe(dashboardHtml());
    } finally {
      await app.close();
    }
  });

  it('sets cache-control: no-store', async () => {
    const app = createApp(config);
    try {
      const response = await app.inject({ method: 'GET', url: '/' });

      expect(response.headers['cache-control']).toContain('no-store');
    } finally {
      await app.close();
    }
  });

  it('answers 200 without Authorization — dashboard is auth-exempt', async () => {
    const authedConfig = parseConfig({
      backends: [
        { name: 'box-a', baseUrl: 'http://192.0.2.10:11434/v1' },
      ],
      auth: { token: 'secret' },
      models: {
        fast: [
          { backend: 'box-a', model: 'mock-model' },
        ],
      },
    });

    const app = createApp(authedConfig);
    try {
      const response = await app.inject({ method: 'GET', url: '/' });

      expect(response.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
