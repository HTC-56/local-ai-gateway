import { describe, expect, it, vi } from 'vitest';
import { parseConfig } from '../src/config.ts';
import {
  EgressRefusedError,
  allowlistFor,
  createEgressGuard,
  destinationOf,
} from '../src/egress.ts';

function config() {
  return parseConfig({
    backends: [
      { name: 'box-a', baseUrl: 'http://192.0.2.10:11434/v1' },
      { name: 'box-b', baseUrl: 'https://192.0.2.20/v1' },
    ],
    models: { fast: [{ backend: 'box-a', model: 'm' }] },
  });
}

function okFetch() {
  return vi.fn(async () => new Response('{}', { status: 200 }));
}

describe('destinationOf', () => {
  it('fills in the protocol default port', () => {
    expect(destinationOf('http://192.0.2.10/v1')).toBe('192.0.2.10:80');
    expect(destinationOf('https://192.0.2.10/v1')).toBe('192.0.2.10:443');
    expect(destinationOf('http://192.0.2.10:11434/v1')).toBe('192.0.2.10:11434');
  });
});

describe('allowlistFor', () => {
  it('binds one sorted host:port per backend and nothing else', () => {
    expect(allowlistFor(config())).toEqual(['192.0.2.10:11434', '192.0.2.20:443']);
  });
});

describe('createEgressGuard', () => {
  it('lets an allowlisted destination through to the real fetch', async () => {
    const fetchImpl = okFetch();
    const guard = createEgressGuard(config(), fetchImpl);

    const response = await guard.fetch('http://192.0.2.10:11434/v1/chat/completions');

    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(guard.snapshot().allowed).toBe(1);
    expect(guard.snapshot().refused).toBe(0);
  });

  it('refuses a non-upstream host without opening a socket', async () => {
    const fetchImpl = okFetch();
    const guard = createEgressGuard(config(), fetchImpl);

    await expect(guard.fetch('https://198.51.100.5/v1/models')).rejects.toBeInstanceOf(
      EgressRefusedError,
    );

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses an allowlisted host on a different port', async () => {
    const guard = createEgressGuard(config(), okFetch());
    expect(guard.isAllowed('http://192.0.2.10:9999/v1')).toBe(false);
    expect(guard.isAllowed('http://192.0.2.10:11434/v1')).toBe(true);
  });

  it('refuses non-http protocols', async () => {
    const guard = createEgressGuard(config(), okFetch());
    expect(guard.isAllowed('file:///etc/hosts')).toBe(false);
  });

  it('counts refusals per destination for /attest', async () => {
    const guard = createEgressGuard(config(), okFetch());

    for (const url of [
      'https://198.51.100.5/a',
      'https://198.51.100.5/b',
      'http://203.0.113.9:8080/c',
    ]) {
      await expect(guard.fetch(url)).rejects.toBeInstanceOf(EgressRefusedError);
    }

    const snapshot = guard.snapshot();
    expect(snapshot.refused).toBe(3);
    expect(snapshot.refusedByDestination).toEqual({
      '198.51.100.5:443': 2,
      '203.0.113.9:8080': 1,
    });
  });

  it('names the refused destination in the error', async () => {
    const guard = createEgressGuard(config(), okFetch());
    await expect(guard.fetch('https://198.51.100.5/v1/models')).rejects.toThrow(
      /198\.51\.100\.5:443/,
    );
  });
});
