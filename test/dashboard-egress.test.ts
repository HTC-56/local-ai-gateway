/**
 * Zero-external-request tests for the served dashboard page.
 *
 * Phase E: mirrors `test/root.test.ts` for the setup and
 * `test/egress.test.ts` for the fetch-spy trick.
 *
 * The dashboard of a no-egress gateway must itself make zero external requests.
 * Everything here asserts about the page **as served by `GET /`**, not the
 * file on disk — so we fetch it with `app.inject` and read `response.body`.
 */
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.ts';
import { createEgressGuard } from '../src/egress.ts';
import { dashboardHtml } from '../src/dashboard.ts';
import { findExternalReferences } from '../src/dashboard.ts';
import { parseConfig } from '../src/config.ts';

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

describe('dashboard egress', () => {
  it('findExternalReferences returns an empty array for the served page', async () => {
    const app = createApp(config);
    try {
      const response = await app.inject({ method: 'GET', url: '/' });

      expect(findExternalReferences(response.body as string)).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('contains no absolute URL at all', async () => {
    const app = createApp(config);
    try {
      const response = await app.inject({ method: 'GET', url: '/' });

      expect(response.body).not.toMatch(/https?:\/\//);
    } finally {
      await app.close();
    }
  });

  it('pulls in no external code or styling', async () => {
    const app = createApp(config);
    try {
      const response = await app.inject({ method: 'GET', url: '/' });
      const body = response.body as string;

      // No external <script src="...">
      expect(body).not.toMatch(/<script\b[^>]*\bsrc\s*=/i);
      // No <link rel="stylesheet" href="...">
      expect(body).not.toMatch(/<link\b[^>]*rel\s*=\s*["']stylesheet["']/i);
      // No @import
      expect(body).not.toMatch(/@import/i);
      // A data: favicon is allowed and expected
      expect(body).toMatch(/<link\b[^>]*rel\s*=\s*["']icon["']/i);
    } finally {
      await app.close();
    }
  });

  it('every api("...") call uses a same-origin path', async () => {
    const app = createApp(config);
    try {
      const response = await app.inject({ method: 'GET', url: '/' });
      const body = response.body as string;

      const calls = (body.match(/api\('([^']+)'/g) ?? []).map(
        (m) => m.match(/api\('([^']+)'/)![1],
      );

      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) {
        expect(call).toMatch(/^\//);
      }
    } finally {
      await app.close();
    }
  });

  it('serving the page opens no socket', async () => {
    const spy = vi.fn(async () => new Response('{}', { status: 200 }));
    const egress = createEgressGuard(config, spy);

    const app = createApp(config, { egress });
    try {
      await app.inject({ method: 'GET', url: '/' });

      expect(spy).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
