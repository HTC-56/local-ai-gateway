/**
 * Health probing and the per-backend circuit (SPEC.md feature 3).
 *
 * One registry per gateway. It holds the live state of every configured
 * backend, probes them on an interval, and answers the single question the
 * chat route asks before it sends anything: `isUsable(backendName)`.
 *
 * Circuit shape: a failure opens the circuit for `health.cooldownMs`. While it
 * is open the backend is skipped and requests fail over down the priority
 * list. When the cooldown elapses the circuit half-opens — `isUsable` says yes
 * again so exactly one attempt (the next probe, or the next request) may try —
 * and that attempt either closes the circuit or re-opens it for another
 * cooldown.
 *
 * Live traffic reports too: the chat route calls `reportSuccess` /
 * `reportFailure`, so fleet state tracks reality between probes instead of
 * waiting for the next tick.
 *
 * Every outbound probe goes through `egress.fetch` — the one door
 * (`src/egress.ts`). The prober is not exempt from attestation.
 */
import type { Backend, Config } from './config.ts';
import type { EgressGuard } from './egress.ts';

export type BackendState = 'unknown' | 'healthy' | 'unhealthy';

/** One row of `GET /healthz` — and one fleet card on the dashboard. */
export type BackendHealth = {
  name: string;
  baseUrl: string;
  state: BackendState;
  /** ISO-8601 instant of the last result, or null before the first one. */
  lastProbe: string | null;
  /** Round-trip of the last successful probe, in whole milliseconds. */
  latencyMs: number | null;
  consecutiveFailures: number;
  lastError: string | null;
};

export type HealthRegistry = {
  /** Every backend, in config order. This is what `GET /healthz` serves. */
  snapshot(): BackendHealth[];
  /** One backend's row, or undefined when the name is not configured. */
  get(name: string): BackendHealth | undefined;
  /**
   * May a request be sent to this backend right now? True unless its circuit
   * is open and the cooldown has not yet elapsed. Unknown (unprobed) backends
   * are usable — the gateway serves traffic before the first probe lands.
   */
  isUsable(name: string): boolean;
  /** Record a live success (a request or probe that worked). Closes the circuit. */
  reportSuccess(name: string, latencyMs: number): void;
  /** Record a live failure. Opens the circuit for `health.cooldownMs`. */
  reportFailure(name: string, error: unknown): void;
  /** Probe one backend now and fold the result in. Never throws. */
  probe(name: string): Promise<void>;
  /** Probe every backend concurrently. Never throws. */
  probeAll(): Promise<void>;
  /** Begin the background probe loop (`health.intervalMs`). Idempotent. */
  start(): void;
  /** Stop the background probe loop. Idempotent; safe to call unstarted. */
  stop(): void;
};

export type HealthRegistryOptions = {
  /** Injectable clock in epoch milliseconds, so tests step time without timers. */
  now?: () => number;
};

type Entry = {
  backend: Backend;
  state: BackendState;
  lastProbeMs: number | null;
  latencyMs: number | null;
  consecutiveFailures: number;
  lastError: string | null;
  /** Epoch ms before which an unhealthy backend is skipped. 0 = closed. */
  cooldownUntil: number;
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The first physical model any logical entry routes to this backend — what the
 * optional generation probe asks for. Undefined when nothing routes here.
 */
export function firstModelFor(config: Config, backendName: string): string | undefined {
  for (const logical of Object.keys(config.models).sort()) {
    for (const target of config.models[logical] ?? []) {
      if (target.backend === backendName) return target.model;
    }
  }
  return undefined;
}

/** Read and discard a response body so the socket is released promptly. */
async function drain(response: Response): Promise<void> {
  try {
    await response.arrayBuffer();
  } catch {
    // A probe does not care why the body could not be read.
  }
}

export function createHealthRegistry(
  config: Config,
  egress: EgressGuard,
  options: HealthRegistryOptions = {},
): HealthRegistry {
  const now = options.now ?? Date.now;
  const entries = new Map<string, Entry>();

  for (const backend of config.backends) {
    entries.set(backend.name, {
      backend,
      state: 'unknown',
      lastProbeMs: null,
      latencyMs: null,
      consecutiveFailures: 0,
      lastError: null,
      cooldownUntil: 0,
    });
  }

  let timer: ReturnType<typeof setInterval> | null = null;

  function rowOf(entry: Entry): BackendHealth {
    return {
      name: entry.backend.name,
      baseUrl: entry.backend.baseUrl,
      state: entry.state,
      lastProbe: entry.lastProbeMs === null ? null : new Date(entry.lastProbeMs).toISOString(),
      latencyMs: entry.latencyMs,
      consecutiveFailures: entry.consecutiveFailures,
      lastError: entry.lastError,
    };
  }

  function markSuccess(entry: Entry, latencyMs: number): void {
    entry.state = 'healthy';
    entry.lastProbeMs = now();
    entry.latencyMs = Math.max(0, Math.round(latencyMs));
    entry.consecutiveFailures = 0;
    entry.lastError = null;
    entry.cooldownUntil = 0;
  }

  function markFailure(entry: Entry, error: unknown): void {
    entry.state = 'unhealthy';
    entry.lastProbeMs = now();
    entry.latencyMs = null;
    entry.consecutiveFailures += 1;
    entry.lastError = messageOf(error);
    entry.cooldownUntil = now() + config.health.cooldownMs;
  }

  async function probeModels(backend: Backend): Promise<void> {
    const response = await egress.fetch(`${backend.baseUrl}/models`, {
      method: 'GET',
      signal: AbortSignal.timeout(config.health.timeoutMs),
    });
    await drain(response);
    if (!response.ok) throw new Error(`models probe answered ${response.status}`);
  }

  async function probeGeneration(backend: Backend): Promise<void> {
    const model = firstModelFor(config, backend.name);
    // Nothing is routed here, so there is nothing honest to generate with.
    if (model === undefined) return;

    const response = await egress.fetch(`${backend.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
        stream: false,
      }),
      signal: AbortSignal.timeout(config.health.timeoutMs),
    });
    await drain(response);
    if (!response.ok) throw new Error(`generation probe answered ${response.status}`);
  }

  async function probeAllEntries(): Promise<void> {
    await Promise.all([...entries.values()].map((entry) => probeEntry(entry)));
  }

  async function probeEntry(entry: Entry): Promise<void> {
    const started = now();
    try {
      await probeModels(entry.backend);
      if (config.health.generationProbe) await probeGeneration(entry.backend);
      markSuccess(entry, now() - started);
    } catch (error) {
      markFailure(entry, error);
    }
  }

  return {
    snapshot() {
      return config.backends
        .map((backend) => entries.get(backend.name))
        .filter((entry): entry is Entry => entry !== undefined)
        .map(rowOf);
    },

    get(name) {
      const entry = entries.get(name);
      return entry ? rowOf(entry) : undefined;
    },

    isUsable(name) {
      const entry = entries.get(name);
      if (!entry) return false;
      if (entry.state !== 'unhealthy') return true;
      // Cooldown elapsed: half-open, let one attempt through.
      return now() >= entry.cooldownUntil;
    },

    reportSuccess(name, latencyMs) {
      const entry = entries.get(name);
      if (entry) markSuccess(entry, latencyMs);
    },

    reportFailure(name, error) {
      const entry = entries.get(name);
      if (entry) markFailure(entry, error);
    },

    async probe(name) {
      const entry = entries.get(name);
      if (entry) await probeEntry(entry);
    },

    async probeAll() {
      await probeAllEntries();
    },

    start() {
      if (timer !== null) return;
      timer = setInterval(() => {
        void probeAllEntries();
      }, config.health.intervalMs);
      // The probe loop must never hold the process open by itself.
      timer.unref?.();
      void probeAllEntries();
    },

    stop() {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    },
  };
}
