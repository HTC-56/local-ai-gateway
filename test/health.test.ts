/**
 * The health registry and the per-backend circuit (SPEC.md feature 3).
 *
 * Mirrors `test/egress.test.ts`: small inline configs, a `vi.fn` fetch behind a
 * real egress guard, no timers and no network. The clock is injected, so
 * "the cooldown elapsed" is a variable assignment rather than a sleep.
 */
import { describe, expect, it, vi } from 'vitest';
import { parseConfig } from '../src/config.ts';
import { createEgressGuard } from '../src/egress.ts';
import { createHealthRegistry, firstModelFor } from '../src/health.ts';

const START = 1_700_000_000_000;

function clock(start = START) {
  let t = start;
  return { now: () => t, advance: (ms: number) => void (t += ms) };
}

function config(overrides: Record<string, unknown> = {}) {
  return parseConfig({
    backends: [
      { name: 'box-a', baseUrl: 'http://192.0.2.10:11434/v1' },
      { name: 'box-b', baseUrl: 'http://192.0.2.20:11434/v1' },
    ],
    models: {
      fast: [
        { backend: 'box-a', model: 'llama3.2:3b' },
        { backend: 'box-b', model: 'llama3.2:3b' },
      ],
      coder: [{ backend: 'box-b', model: 'qwen2.5-coder:7b' }],
    },
    ...overrides,
  });
}

function okFetch(status = 200) {
  return vi.fn<typeof globalThis.fetch>(
    async () => new Response('{"object":"list","data":[]}', { status }),
  );
}

function deadFetch() {
  return vi.fn<typeof globalThis.fetch>(async () => {
    throw new Error('connect ECONNREFUSED');
  });
}

function registryWith(fetchImpl: typeof globalThis.fetch, cfg = config(), nowFn = clock().now) {
  const guard = createEgressGuard(cfg, fetchImpl);
  return { guard, health: createHealthRegistry(cfg, guard, { now: nowFn }) };
}

describe('createHealthRegistry — before the first probe', () => {
  it('reports every backend unknown, in config order, and treats them as usable', () => {
    const { health } = registryWith(okFetch());

    expect(health.snapshot()).toEqual([
      {
        name: 'box-a',
        baseUrl: 'http://192.0.2.10:11434/v1',
        state: 'unknown',
        lastProbe: null,
        latencyMs: null,
        consecutiveFailures: 0,
        lastError: null,
      },
      {
        name: 'box-b',
        baseUrl: 'http://192.0.2.20:11434/v1',
        state: 'unknown',
        lastProbe: null,
        latencyMs: null,
        consecutiveFailures: 0,
        lastError: null,
      },
    ]);
    expect(health.isUsable('box-a')).toBe(true);
  });

  it('refuses to vouch for a backend that is not configured', () => {
    const { health } = registryWith(okFetch());

    expect(health.get('box-nowhere')).toBeUndefined();
    expect(health.isUsable('box-nowhere')).toBe(false);
  });
});

describe('createHealthRegistry — probing', () => {
  it('marks a backend healthy when the models list answers, through the egress door', async () => {
    const fetchImpl = okFetch();
    const { guard, health } = registryWith(fetchImpl);

    await health.probeAll();

    const row = health.get('box-a');
    expect(row?.state).toBe('healthy');
    expect(row?.lastProbe).toBe(new Date(START).toISOString());
    expect(row?.latencyMs).toBeGreaterThanOrEqual(0);
    expect(row?.lastError).toBeNull();

    // Both backends were probed, and every probe went through the guard.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(guard.snapshot().allowed).toBe(2);
    expect(guard.snapshot().refused).toBe(0);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe('http://192.0.2.10:11434/v1/models');
  });

  it('marks a backend unhealthy when the probe throws, and records why', async () => {
    const { health } = registryWith(deadFetch());

    await health.probe('box-a');

    const row = health.get('box-a');
    expect(row?.state).toBe('unhealthy');
    expect(row?.consecutiveFailures).toBe(1);
    expect(row?.latencyMs).toBeNull();
    expect(row?.lastError).toContain('ECONNREFUSED');
  });

  it('counts a non-2xx models list as a failure', async () => {
    const { health } = registryWith(okFetch(503));

    await health.probe('box-a');

    expect(health.get('box-a')?.state).toBe('unhealthy');
    expect(health.get('box-a')?.lastError).toContain('503');
  });

  it('accumulates consecutive failures and resets them on the next success', async () => {
    const flaky = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValueOnce(new Error('boom one'))
      .mockRejectedValueOnce(new Error('boom two'))
      .mockResolvedValue(new Response('{}', { status: 200 }));
    const { health } = registryWith(flaky);

    await health.probe('box-a');
    await health.probe('box-a');
    expect(health.get('box-a')?.consecutiveFailures).toBe(2);
    expect(health.get('box-a')?.lastError).toBe('boom two');

    await health.probe('box-a');
    expect(health.get('box-a')?.state).toBe('healthy');
    expect(health.get('box-a')?.consecutiveFailures).toBe(0);
    expect(health.get('box-a')?.lastError).toBeNull();
  });
});

describe('createHealthRegistry — the circuit', () => {
  it('skips an unhealthy backend until the cooldown elapses, then half-opens', async () => {
    const time = clock();
    const cfg = config({ health: { cooldownMs: 30_000 } });
    const { health } = registryWith(deadFetch(), cfg, time.now);

    await health.probe('box-a');
    expect(health.isUsable('box-a')).toBe(false);

    time.advance(29_999);
    expect(health.isUsable('box-a')).toBe(false);

    // Cooldown served: the circuit half-opens so exactly one attempt may try.
    time.advance(1);
    expect(health.isUsable('box-a')).toBe(true);
    // Half-open is not healthy — the state still says so.
    expect(health.get('box-a')?.state).toBe('unhealthy');
  });

  it('re-opens the circuit for a fresh cooldown when the half-open attempt fails', async () => {
    const time = clock();
    const cfg = config({ health: { cooldownMs: 30_000 } });
    const { health } = registryWith(deadFetch(), cfg, time.now);

    await health.probe('box-a');
    time.advance(30_000);
    expect(health.isUsable('box-a')).toBe(true);

    await health.probe('box-a');
    expect(health.isUsable('box-a')).toBe(false);
    expect(health.get('box-a')?.consecutiveFailures).toBe(2);
  });

  it('closes the circuit as soon as live traffic succeeds', async () => {
    const time = clock();
    const { health } = registryWith(deadFetch(), config(), time.now);

    health.reportFailure('box-a', new Error('request failed'));
    expect(health.isUsable('box-a')).toBe(false);

    health.reportSuccess('box-a', 42);
    expect(health.get('box-a')?.state).toBe('healthy');
    expect(health.get('box-a')?.latencyMs).toBe(42);
    expect(health.isUsable('box-a')).toBe(true);
  });
});

describe('createHealthRegistry — the optional generation probe', () => {
  it('is off by default: only the models list is fetched', async () => {
    const fetchImpl = okFetch();
    const { health } = registryWith(fetchImpl);

    await health.probe('box-a');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('/models');
  });

  it('asks for one token from the backend’s first configured model when enabled', async () => {
    const fetchImpl = okFetch();
    const cfg = config({ health: { generationProbe: true } });
    const { health } = registryWith(fetchImpl, cfg);

    await health.probe('box-b');

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(String(fetchImpl.mock.calls[1]?.[0])).toBe(
      'http://192.0.2.20:11434/v1/chat/completions',
    );

    const init = fetchImpl.mock.calls[1]?.[1];
    const sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
    // Logical names are walked sorted, so `coder` reaches box-b before `fast`.
    expect(sent.model).toBe('qwen2.5-coder:7b');
    expect(sent.max_tokens).toBe(1);
    expect(sent.stream).toBe(false);
    expect(health.get('box-b')?.state).toBe('healthy');
  });

  it('fails the backend when it lists models but cannot generate', async () => {
    const fetchImpl = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response('{"data":[]}', { status: 200 }))
      .mockResolvedValueOnce(new Response('nope', { status: 500 }));
    const cfg = config({ health: { generationProbe: true } });
    const { health } = registryWith(fetchImpl, cfg);

    await health.probe('box-a');

    expect(health.get('box-a')?.state).toBe('unhealthy');
    expect(health.get('box-a')?.lastError).toContain('generation probe');
  });
});

describe('firstModelFor', () => {
  it('finds the first physical model routed to a backend, and nothing for a stranger', () => {
    const cfg = config();

    expect(firstModelFor(cfg, 'box-a')).toBe('llama3.2:3b');
    expect(firstModelFor(cfg, 'box-b')).toBe('qwen2.5-coder:7b');
    expect(firstModelFor(cfg, 'box-nowhere')).toBeUndefined();
  });
});

describe('createHealthRegistry — the background loop', () => {
  it('probes once on start and leaves no timer behind on stop', async () => {
    const fetchImpl = okFetch();
    const cfg = config({ health: { intervalMs: 60_000 } });
    const { health } = registryWith(fetchImpl, cfg);

    health.start();
    // start() is idempotent — a second call must not add a second timer.
    health.start();
    try {
      await vi.waitFor(() => expect(health.get('box-a')?.state).toBe('healthy'));
    } finally {
      health.stop();
      health.stop();
    }

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
