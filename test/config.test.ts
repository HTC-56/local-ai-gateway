import { describe, expect, it } from 'vitest';
import {
  ConfigError,
  listLogicalModels,
  loadConfig,
  parseConfig,
  resolveLogical,
} from '../src/config.ts';

describe('parseConfig defaults', () => {
  it('fills in listen.host, listen.port, auth.token, ledger.redact, health.intervalMs', () => {
    const config = parseConfig({
      backends: [{ name: 'box-a', baseUrl: 'http://192.0.2.10:11434/v1' }],
      models: { fast: [{ backend: 'box-a', model: 'm' }] },
    });

    expect(config.listen.host).toBe('127.0.0.1');
    expect(config.listen.port).toBe(8080);
    expect(config.auth.token).toBeNull();
    expect(config.ledger.path).toBeNull();
    expect(config.ledger.redact).toBe(false);
    expect(config.health.intervalMs).toBe(10000);
  });
});

describe('parseConfig validates backends', () => {
  it('throws ConfigError when backends is empty', () => {
    expect(() =>
      parseConfig({
        backends: [],
        models: { fast: [{ backend: 'x', model: 'm' }] },
      }),
    ).toThrow(ConfigError);
  });
});

describe('parseConfig rejects duplicate backend names', () => {
  it('throws ConfigError with "duplicate" in the message', () => {
    expect(() =>
      parseConfig({
        backends: [
          { name: 'box-a', baseUrl: 'http://192.0.2.10:11434/v1' },
          { name: 'box-a', baseUrl: 'http://192.0.2.20:11434/v1' },
        ],
        models: { fast: [{ backend: 'box-a', model: 'm' }] },
      }),
    ).toThrow(/duplicate/);
  });
});

describe('parseConfig rejects unknown backends in models', () => {
  it('throws ConfigError with "unknown backend" in the message', () => {
    expect(() =>
      parseConfig({
        backends: [{ name: 'box-a', baseUrl: 'http://192.0.2.10:11434/v1' }],
        models: { fast: [{ backend: 'ghost', model: 'm' }] },
      }),
    ).toThrow(/unknown backend/);
  });
});

describe('resolveLogical and listLogicalModels', () => {
  it('returns targets in config order with backend attached, unknown names resolve to []', () => {
    const config = parseConfig({
      backends: [
        { name: 'box-a', baseUrl: 'http://192.0.2.10:11434/v1' },
        { name: 'box-b', baseUrl: 'http://192.0.2.20:11434/v1' },
      ],
      models: {
        fast: [
          { backend: 'box-a', model: 'm1' },
          { backend: 'box-b', model: 'm2' },
        ],
        slow: [{ backend: 'box-b', model: 'm3' }],
      },
    });

    const fastTargets = resolveLogical(config, 'fast');
    expect(fastTargets.length).toBe(2);
    expect(fastTargets[0]!.backend.name).toBe('box-a');
    expect(fastTargets[0]!.model).toBe('m1');
    expect(fastTargets[1]!.backend.name).toBe('box-b');
    expect(fastTargets[1]!.model).toBe('m2');

    expect(resolveLogical(config, 'phantom')).toEqual([]);

    expect(listLogicalModels(config)).toEqual(['fast', 'slow']);
  });
});

describe('loadConfig', () => {
  it('parses deploy/gateway.example.yaml and its backends are box-a and box-b', () => {
    const config = loadConfig('deploy/gateway.example.yaml');

    const names = config.backends.map((b) => b.name);
    expect(names).toEqual(['box-a', 'box-b']);
  });
});
