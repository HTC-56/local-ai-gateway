/**
 * Egress attestation (SPEC.md feature 5) — the centrepiece.
 *
 * At boot the gateway derives an outbound allowlist from the configured
 * upstreams and nothing else. Every outbound request the gateway makes goes
 * through `guard.fetch`; anything whose destination is not on the allowlist is
 * refused before a socket is opened and counted. `GET /attest` reports the
 * allowlist and the refusal counters; the test suite proves the refusal path.
 */
import type { Config } from './config.ts';

/** Raised instead of performing a request to a destination that is not allowlisted. */
export class EgressRefusedError extends Error {
  readonly destination: string;

  constructor(destination: string) {
    super(`egress refused: ${destination} is not on the boot allowlist`);
    this.name = 'EgressRefusedError';
    this.destination = destination;
  }
}

/** What `GET /attest` serves. */
export type EgressSnapshot = {
  /** `host:port` entries bound at boot, sorted. */
  allowlist: string[];
  /** Requests permitted since boot. */
  allowed: number;
  /** Requests refused since boot. */
  refused: number;
  /** Refusal count per destination, so the dashboard can name the offender. */
  refusedByDestination: Record<string, number>;
};

export type EgressGuard = {
  readonly allowlist: readonly string[];
  /** True when this URL's destination was bound at boot. */
  isAllowed(url: string | URL): boolean;
  /** Allowlisted `fetch`. Throws {@link EgressRefusedError} for anything else. */
  fetch(input: string | URL, init?: RequestInit): Promise<Response>;
  snapshot(): EgressSnapshot;
};

/**
 * Canonical `host:port` for a URL, with the protocol's default port filled in
 * so `http://a.example` and `http://a.example:80` are the same destination.
 */
export function destinationOf(url: string | URL): string {
  const parsed = typeof url === 'string' ? new URL(url) : url;
  if (parsed.port) return `${parsed.hostname}:${parsed.port}`;
  if (parsed.protocol === 'https:') return `${parsed.hostname}:443`;
  if (parsed.protocol === 'http:') return `${parsed.hostname}:80`;
  return `${parsed.protocol}//${parsed.hostname}`;
}

/** The allowlist a config implies: one `host:port` per backend, deduped and sorted. */
export function allowlistFor(config: Config): string[] {
  const destinations = new Set<string>();
  for (const backend of config.backends) {
    destinations.add(destinationOf(new URL(backend.baseUrl)));
  }
  return [...destinations].sort();
}

/**
 * Bind an allowlist from `config` and return the only outbound door the
 * gateway is allowed to use.
 *
 * `fetchImpl` exists so tests can assert that a refused request never reaches
 * the network; production always uses the global `fetch`.
 */
export function createEgressGuard(
  config: Config,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): EgressGuard {
  const allowlist = allowlistFor(config);
  const allowed = new Set(allowlist);
  const refusedByDestination = new Map<string, number>();
  let allowedCount = 0;
  let refusedCount = 0;

  function destinationFor(url: string | URL): string {
    try {
      return destinationOf(url);
    } catch {
      return '<unparseable-url>';
    }
  }

  function permitted(url: string | URL): boolean {
    let parsed: URL;
    try {
      parsed = typeof url === 'string' ? new URL(url) : url;
    } catch {
      return false;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    return allowed.has(destinationOf(parsed));
  }

  return {
    allowlist,

    isAllowed(url) {
      return permitted(url);
    },

    async fetch(input, init) {
      if (!permitted(input)) {
        const destination = destinationFor(input);
        refusedCount += 1;
        refusedByDestination.set(destination, (refusedByDestination.get(destination) ?? 0) + 1);
        throw new EgressRefusedError(destination);
      }
      allowedCount += 1;
      return fetchImpl(typeof input === 'string' ? input : input.toString(), init);
    },

    snapshot() {
      return {
        allowlist: [...allowlist],
        allowed: allowedCount,
        refused: refusedCount,
        refusedByDestination: Object.fromEntries(
          [...refusedByDestination.entries()].sort(([a], [b]) => a.localeCompare(b)),
        ),
      };
    },
  };
}
