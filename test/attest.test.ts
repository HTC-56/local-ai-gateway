/**
 * Tests for `GET /attest` — egress allowlist, refusal counters, backends.
 *
 * Phase C: mirrors `test/app.test.ts` — module-level `parseConfig`,
 * `createApp`, `app.inject`, `await app.close()` in a `finally`.
 */
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { parseConfig } from '../src/config.ts';
import { createEgressGuard } from '../src/egress.ts';

const config = parseConfig({
  backends: [
    { name: 'box-a', baseUrl: 'http://192.0.2.10:11434/v1' },
    { name: 'box-b', baseUrl: 'http://192.0.2.20:11434/v1' },
  ],
  models: {
    fast: [
      { backend: 'box-a', model: 'mock-model' },
      { backend: 'box-b', model: 'mock-model' },
    ],
  },
});

describe('GET /attest', () => {
  it('answers 200 with a sorted allowlist', async () => {
    const app = createApp(config);
    try {
      const response = await app.inject({ method: 'GET', url: '/attest' });

      expect(response.statusCode).toBe(200);
      const body = response.json() as Record<string, unknown>;
      const allowlist = body.allowlist as string[];
      expect(allowlist).toEqual([
        '192.0.2.10:11434',
        '192.0.2.20:11434',
      ]);
    } finally {
      await app.close();
    }
  });

  it('starts with allowed 0, refused 0, refusedByDestination {}', async () => {
    const app = createApp(config);
    try {
      const response = await app.inject({ method: 'GET', url: '/attest' });

      const body = response.json() as Record<string, unknown>;
      expect(body.allowed).toBe(0);
      expect(body.refused).toBe(0);
      expect(body.refusedByDestination).toEqual({});
    } finally {
      await app.close();
    }
  });

  it('reports one backend entry per config backend', async () => {
    const app = createApp(config);
    try {
      const response = await app.inject({ method: 'GET', url: '/attest' });

      const body = response.json() as {
        backends: Array<Record<string, unknown>>;
        refusedByDestination: Record<string, number>;
      };
      expect(body.backends).toHaveLength(2);
      const b0 = body.backends[0] as Record<string, unknown>;
      const b1 = body.backends[1] as Record<string, unknown>;
      expect(b0.name).toBe('box-a');
      expect(b0.destination).toBe('192.0.2.10:11434');
      expect(b1.name).toBe('box-b');
      expect(b1.destination).toBe('192.0.2.20:11434');
    } finally {
      await app.close();
    }
  });

  it('increments refused after a guard-verified fetch to an unallowlisted host', async () => {
    const guard = createEgressGuard(config);
    // Force-reject a foreign host.
    try {
      await guard.fetch('https://198.51.100.5/x');
    } catch {
      // expected
    }
    expect(guard.snapshot().refused).toBe(1);

    const app = createApp(config, { egress: guard });
    try {
      const response = await app.inject({ method: 'GET', url: '/attest' });

      const body = response.json() as Record<string, unknown>;
      expect(body.refused).toBe(1);
      const rbd = body.refusedByDestination as Record<string, number>;
      expect(rbd['198.51.100.5:443']).toBe(1);
    } finally {
      await app.close();
    }
  });
});
