/**
 * `src/auth.ts` — static bearer token auth hook.
 *
 * Phase C: five assertions covering disabled auth, missing header, wrong
 * token, correct token, and `/healthz` exemption. Mirrors `test/app.test.ts`
 * for structure (parseConfig → createApp → inject → close).
 */
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { parseConfig } from '../src/config.ts';

describe('Static bearer token auth', () => {
  const noAuthConfig = parseConfig({
    backends: [{ name: 'box-a', baseUrl: 'http://192.0.2.10:11434/v1' }],
    models: { fast: [{ backend: 'box-a', model: 'mock-model' }] },
  });

  const authedConfig = parseConfig({
    backends: [{ name: 'box-a', baseUrl: 'http://192.0.2.10:11434/v1' }],
    models: { fast: [{ backend: 'box-a', model: 'mock-model' }] },
    auth: { token: 'test-token' },
  });

  it('auth disabled — GET /v1/models answers 200 with no header sent', async () => {
    // auth.token is null by default.
    const app = createApp(noAuthConfig);
    try {
      const response = await app.inject({ method: 'GET', url: '/v1/models' });

      expect(response.statusCode).toBe(200);
      expect(response.headers['www-authenticate']).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('auth enabled — no Authorization header returns 401', async () => {
    const app = createApp(authedConfig);
    try {
      const response = await app.inject({ method: 'GET', url: '/v1/models' });

      expect(response.statusCode).toBe(401);
      expect(response.headers['www-authenticate']).toBe('Bearer');
      const body = response.json() as Record<string, unknown>;
      const error = body.error as Record<string, unknown>;
      expect(error.code).toBe('invalid_api_key');
    } finally {
      await app.close();
    }
  });

  it('auth enabled — wrong token returns 401', async () => {
    const app = createApp(authedConfig);
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/models',
        headers: { authorization: 'Bearer wrong-token' },
      });

      expect(response.statusCode).toBe(401);
      expect(response.headers['www-authenticate']).toBe('Bearer');
    } finally {
      await app.close();
    }
  });

  it('auth enabled — correct token returns 200', async () => {
    const app = createApp(authedConfig);
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/models',
        headers: { authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('auth enabled — GET /healthz answers 200 with no header sent', async () => {
    const app = createApp(authedConfig);
    try {
      const response = await app.inject({ method: 'GET', url: '/healthz' });

      expect(response.statusCode).toBe(200);
      expect(response.headers['www-authenticate']).toBeUndefined();
    } finally {
      await app.close();
    }
  });
});
