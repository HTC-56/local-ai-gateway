import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config.ts';
import { createLedger } from '../src/ledger.ts';

const scratch: string[] = [];

function tempPath(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'gateway-ledger-'));
  scratch.push(dir);
  return join(dir, name);
}

function config(ledger: Record<string, unknown>) {
  return parseConfig({
    ledger,
    backends: [{ name: 'box-a', baseUrl: 'http://192.0.2.10:11434/v1' }],
    models: { fast: [{ backend: 'box-a', model: 'm' }] },
  });
}

/** Read a written ledger back as one object per line. */
function readLines(path: string): Array<Record<string, unknown>> {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

afterEach(() => {
  while (scratch.length > 0) {
    const dir = scratch.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('createLedger writes JSONL', () => {
  it('appends one stamped line per event and keeps caller fields', async () => {
    const path = tempPath('ledger.jsonl');
    const ledger = createLedger(config({ path }), { now: () => 1_700_000_000_000 });

    ledger.append({ event: 'request', model: 'fast', backend: 'box-a', status: 200, latencyMs: 12 });
    ledger.append({ event: 'failover', model: 'fast', backend: 'box-a', error: 'ECONNREFUSED' });
    await ledger.close();

    const lines = readLines(path);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual({
      ts: '2023-11-14T22:13:20.000Z',
      event: 'request',
      model: 'fast',
      backend: 'box-a',
      status: 200,
      latencyMs: 12,
    });
    expect(lines[1]!.event).toBe('failover');
    expect(lines[1]!.error).toBe('ECONNREFUSED');
  });

  it('appends to an existing file rather than truncating it', async () => {
    const path = tempPath('ledger.jsonl');

    const first = createLedger(config({ path }));
    first.append({ event: 'request', model: 'fast' });
    await first.close();

    const second = createLedger(config({ path }));
    second.append({ event: 'request', model: 'coder' });
    await second.close();

    expect(readLines(path).map((line) => line.model)).toEqual(['fast', 'coder']);
  });
});

describe('the redaction toggle', () => {
  it('keeps detail when redact is false', async () => {
    const path = tempPath('ledger.jsonl');
    const ledger = createLedger(config({ path, redact: false }));

    ledger.append({ event: 'request', model: 'fast', detail: { messages: 3 } });
    await ledger.close();

    expect(readLines(path)[0]!.detail).toEqual({ messages: 3 });
    expect(ledger.redact).toBe(false);
  });

  it('drops detail from the file and the tail when redact is true', async () => {
    const path = tempPath('ledger.jsonl');
    const ledger = createLedger(config({ path, redact: true }));

    ledger.append({ event: 'request', model: 'fast', detail: { messages: 3 } });
    const kept = ledger.tail();
    await ledger.close();

    expect(kept[0]).not.toHaveProperty('detail');
    expect(kept[0]!.model).toBe('fast');
    expect(readLines(path)[0]).not.toHaveProperty('detail');
  });
});

describe('the in-memory tail', () => {
  it('returns entries oldest-first and honours the limit', () => {
    const ledger = createLedger(config({}));

    for (const model of ['a', 'b', 'c']) ledger.append({ event: 'request', model });

    expect(ledger.tail().map((entry) => entry.model)).toEqual(['a', 'b', 'c']);
    expect(ledger.tail(2).map((entry) => entry.model)).toEqual(['b', 'c']);
    expect(ledger.tail(0)).toEqual([]);
  });

  it('never grows past tailSize', () => {
    const ledger = createLedger(config({}), { tailSize: 3 });

    for (const model of ['a', 'b', 'c', 'd', 'e']) ledger.append({ event: 'request', model });

    expect(ledger.tail().map((entry) => entry.model)).toEqual(['c', 'd', 'e']);
  });
});

describe('a ledger never throws into the request path', () => {
  it('records to the ring and writes no file when path is null', async () => {
    const ledger = createLedger(config({}));

    expect(ledger.path).toBeNull();
    ledger.append({ event: 'request', model: 'fast' });
    await ledger.close();

    expect(ledger.tail()).toHaveLength(1);
  });

  it('survives an unopenable path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gateway-ledger-'));
    scratch.push(dir);
    // A directory is not a file: opening it for append fails.
    const ledger = createLedger(config({ path: dir }));

    expect(() => ledger.append({ event: 'request', model: 'fast' })).not.toThrow();
    expect(ledger.tail()).toHaveLength(1);
    await expect(ledger.close()).resolves.toBeUndefined();
  });

  it('survives appends after close', async () => {
    const path = tempPath('ledger.jsonl');
    const ledger = createLedger(config({ path }));

    ledger.append({ event: 'request', model: 'fast' });
    await ledger.close();
    await ledger.close();

    expect(() => ledger.append({ event: 'request', model: 'late' })).not.toThrow();
    expect(readLines(path)).toHaveLength(1);
  });
});
