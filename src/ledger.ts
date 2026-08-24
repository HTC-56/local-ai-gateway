/**
 * The JSONL request ledger (SPEC.md feature 6).
 *
 * One line of JSON per event, appended to `ledger.path`. Two consumers:
 * an operator tailing the file, and the dashboard's event feed, which reads
 * the in-memory ring this module also keeps (`tail()`), so a browser poll
 * never re-reads the file.
 *
 * Privacy shape — this is a no-egress gateway, so the ledger is metadata by
 * construction. An entry carries routing facts (logical model, backend,
 * status, latency) and never a request or response body. The one field that
 * can be *derived* from a body is `detail`, a small summary such as a message
 * count; `ledger.redact: true` drops `detail` before anything is written or
 * kept, which is the operator's guarantee that nothing body-derived is
 * persisted at all.
 *
 * A ledger never throws into the request path. A path that cannot be opened,
 * a write that fails, an entry that will not serialise — all are dropped, and
 * the gateway keeps serving.
 */
import { createWriteStream, type WriteStream } from 'node:fs';
import type { Config } from './config.ts';

/** What happened. The dashboard's feed filters on this. */
export type LedgerEventType = 'request' | 'failover' | 'egress_refused';

/** One event as a caller reports it — the ledger stamps `ts` itself. */
export type LedgerEvent = {
  event: LedgerEventType;
  /** Logical model the client asked for. */
  model?: string;
  /** Backend that answered, or that failed. */
  backend?: string;
  /** Physical model on that backend. */
  upstreamModel?: string;
  /** HTTP status returned to the client. */
  status?: number;
  /** Round trip to the upstream, whole milliseconds. */
  latencyMs?: number;
  /** How many backends were contacted before this outcome. */
  attempts?: number;
  /** `host:port` refused by the boot allowlist (`egress_refused` only). */
  destination?: string;
  /** Failure message, when there is one. */
  error?: string;
  /**
   * Body-derived summary — the only field traceable to message content, and
   * never the content itself. Dropped entirely when `ledger.redact` is true.
   */
  detail?: Record<string, unknown>;
};

/** An event as it is written: the caller's fields with an ISO-8601 stamp. */
export type LedgerEntry = LedgerEvent & { ts: string };

export type Ledger = {
  /** Configured file, or null when the ledger keeps the ring only. */
  readonly path: string | null;
  /** True when `detail` is stripped from every entry. */
  readonly redact: boolean;
  /** Record an event. Fire-and-forget: never throws, never awaits the disk. */
  append(event: LedgerEvent): void;
  /** The most recent entries, oldest first — the dashboard's feed. */
  tail(limit?: number): LedgerEntry[];
  /** Flush and close the file. Idempotent; the ring stays readable. */
  close(): Promise<void>;
};

export type LedgerOptions = {
  /** Injectable clock in epoch milliseconds, so tests get stable stamps. */
  now?: () => number;
  /** How many entries the in-memory ring keeps. Default 200. */
  tailSize?: number;
};

const DEFAULT_TAIL_SIZE = 200;

/**
 * Open a ledger for this config. The file is opened lazily on the first
 * append, so a gateway that never serves a request never creates one.
 */
export function createLedger(config: Config, options: LedgerOptions = {}): Ledger {
  const now = options.now ?? Date.now;
  const tailSize = Math.max(1, options.tailSize ?? DEFAULT_TAIL_SIZE);
  const path = config.ledger.path;
  const redact = config.ledger.redact;

  const ring: LedgerEntry[] = [];
  let stream: WriteStream | null = null;
  let closed = false;
  /** Set once the file proves unusable; the ring keeps working without it. */
  let broken = false;

  function open(): WriteStream | null {
    if (path === null || closed || broken) return null;
    if (stream !== null) return stream;
    try {
      const opened = createWriteStream(path, { flags: 'a' });
      // A ledger problem is an ops problem, never a request-path failure.
      opened.on('error', () => {
        broken = true;
      });
      stream = opened;
      return opened;
    } catch {
      broken = true;
      return null;
    }
  }

  return {
    path,
    redact,

    append(event) {
      const entry: LedgerEntry = { ts: new Date(now()).toISOString(), ...event };
      if (redact) delete entry.detail;

      ring.push(entry);
      if (ring.length > tailSize) ring.splice(0, ring.length - tailSize);

      let line: string;
      try {
        line = `${JSON.stringify(entry)}\n`;
      } catch {
        // Un-serialisable detail: the ring already has it, the file does not.
        return;
      }

      const target = open();
      if (target === null) return;
      try {
        target.write(line);
      } catch {
        broken = true;
      }
    },

    tail(limit) {
      const wanted = limit === undefined ? ring.length : Math.max(0, Math.trunc(limit));
      return ring.slice(Math.max(0, ring.length - wanted));
    },

    async close() {
      closed = true;
      const target = stream;
      stream = null;
      if (target === null) return;
      await new Promise<void>((resolve) => {
        target.end(() => resolve());
      });
    },
  };
}
