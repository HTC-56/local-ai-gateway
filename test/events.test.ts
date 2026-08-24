/**
 * Tests for `GET /events` — the ledger tail over HTTP.
 *
 * Phase E: mirrors `test/attest.test.ts` — module-level `parseConfig`,
 * `createApp`, `app.inject`, `await app.close()` in a `finally`.
 */
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { parseConfig } from '../src/config.ts';
import { createLedger } from '../src/ledger.ts';

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

describe('GET /events', () => {
  it('answers 200 with events an empty array', async () => {
    const app = createApp(config);
    try {
      const response = await app.inject({ method: 'GET', url: '/events' });

      expect(response.statusCode).toBe(200);
      const body = response.json() as Record<string, unknown>;
      const events = body.events as unknown[];
      expect(events).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('lists three appended events in append order, each with a string ts', async () => {
    const ledger = createLedger(config);
    ledger.append({ event: 'request', model: 'gpt-4o', backend: 'box-a' });
    ledger.append({ event: 'failover', model: 'gpt-4o', backend: 'box-b' });
    ledger.append({ event: 'egress_refused', destination: '198.51.100.5:443' });

    const app = createApp(config, { ledger });
    try {
      const response = await app.inject({ method: 'GET', url: '/events' });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { events: Array<Record<string, unknown>> };
      expect(body.events).toHaveLength(3);
      const evts = body.events;
      const e0 = evts[0] as Record<string, unknown>;
      const e1 = evts[1] as Record<string, unknown>;
      const e2 = evts[2] as Record<string, unknown>;
      expect(e0.event).toBe('request');
      expect(e1.event).toBe('failover');
      expect(e2.event).toBe('egress_refused');
      expect(typeof e0.ts).toBe('string');
      expect(typeof e1.ts).toBe('string');
      expect(typeof e2.ts).toBe('string');
    } finally {
      await app.close();
    }
  });

  it('/events?limit=1 returns exactly one entry — the last one appended', async () => {
    const ledger = createLedger(config);
    ledger.append({ event: 'request', model: 'gpt-4o', backend: 'box-a' });
    ledger.append({ event: 'failover', model: 'gpt-4o', backend: 'box-b' });
    ledger.append({ event: 'egress_refused', destination: '198.51.100.5:443' });

    const app = createApp(config, { ledger });
    try {
      const response = await app.inject({ method: 'GET', url: '/events?limit=1' });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { events: Array<Record<string, unknown>> };
      const evts = body.events;
      expect(evts).toHaveLength(1);
      const e0 = evts[0] as Record<string, unknown>;
      expect(e0.event).toBe('egress_refused');
    } finally {
      await app.close();
    }
  });

  it('returns 401 without auth and 200 with Bearer secret when auth is configured', async () => {
    const authConfig = parseConfig({
      backends: [
        { name: 'box-a', baseUrl: 'http://192.0.2.10:11434/v1' },
      ],
      models: {
        fast: [{ backend: 'box-a', model: 'mock-model' }],
      },
      auth: { token: 'secret' },
    });

    const app1 = createApp(authConfig);
    try {
      const response = await app1.inject({ method: 'GET', url: '/events' });
      expect(response.statusCode).toBe(401);
    } finally {
      await app1.close();
    }

    const app2 = createApp(authConfig);
    try {
      const response = await app2.inject({
        method: 'GET',
        url: '/events',
        headers: { Authorization: 'Bearer secret' },
      });
      expect(response.statusCode).toBe(200);
    } finally {
      await app2.close();
    }
  });
});
