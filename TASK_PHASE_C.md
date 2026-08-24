# Phase C — the ops surface: attestation, metrics, ledger, auth

Grep your section header (`## §C1`, `## §C2`, …), read that section, build it.
Do not read this file whole.

## Already built — do not rebuild

Committed before this phase opened (the two `feat(C0)` commits):

- `src/ledger.ts` — the JSONL ledger and its in-memory tail, with 9 tests
- `src/metrics.ts` — the Prometheus registry and renderer, with 10 tests
- `src/context.ts` gained `ctx.ledger` and `ctx.metrics`; `src/app.ts` builds
  both, closes the ledger on shutdown, and lets tests override either
- `src/egress.ts` gained an `onRefusal` hook; `app.ts` uses it to write an
  `egress_refused` event into the ledger
- `config.ledger.path` now defaults to `null` (in-memory tail only, no file)

**Gate for every task below unless the task says otherwise:**
`pnpm typecheck` clean AND `pnpm test` green AND `bash scripts/scrub-check.sh` green.

## The API you will use — signatures only

`ctx.ledger` (from `src/ledger.ts`):

- `append(event): void` — never throws. `event` is
  `{ event: 'request' | 'failover' | 'egress_refused', model?, backend?,
  upstreamModel?, status?, latencyMs?, attempts?, destination?, error?,
  detail? }`. Every field but `event` is optional; the ledger adds `ts`.
- `tail(limit?): LedgerEntry[]` — most recent entries, oldest first.

`ctx.metrics` (from `src/metrics.ts`):

- `recordRequest(model, outcome): void` — outcome is `'ok'` or `'error'`.
- `recordUpstreamLatency(backend, latencyMs): void`
- `recordFailover(model, backend): void`
- `render(sources?): string` — Prometheus text. `sources` is
  `{ egress?: EgressSnapshot, backends?: BackendHealth[] }`.

`createApp(config, options)` accepts `{ egress, health, ledger, metrics,
probe, logger }`, so a test can hand the gateway a ledger it then reads.

Imports carry the `.ts` extension (`from '../ledger.ts'`). Copy the import
style from the file you are told to mirror.

---

## §C1 — `GET /attest`

Create `src/routes/attest.ts`. **Mirror `src/routes/healthz.ts`**: one
`registerAttest(app, ctx)` function, one `app.get(...)`, a plain object
returned from an async handler. Register it in `src/app.ts` next to
`registerHealthz(app, ctx)`.

The handler returns `ctx.egress.snapshot()` — which already carries
`allowlist`, `allowed`, `refused` and `refusedByDestination` — plus one added
field, `backends`: one entry per `ctx.config.backends` entry, in config order,
shaped `{ name, destination }`. Compute `destination` with the exported
`destinationOf` from `../egress.ts`, passing that backend's `baseUrl`. That
field is what lets the dashboard name which backend an allowlist entry is for.

Add nothing else. No timestamps, no config echo — this endpoint is a claim
about outbound traffic and nothing more.

Then create `test/attest.test.ts`, mirroring `test/app.test.ts` (module-level
`parseConfig`, `createApp`, `app.inject`, `await app.close()` in a `finally`).
Use a two-backend config on `192.0.2.10:11434` and `192.0.2.20:11434`. Assert:

1. `GET /attest` answers 200, and `allowlist` is exactly the two `host:port`
   strings, sorted.
2. On a fresh gateway `allowed` is 0, `refused` is 0, and
   `refusedByDestination` is `{}`.
3. `backends` is `[{ name: 'box-a', destination: '192.0.2.10:11434' }, …]`.
4. Build a guard with `createEgressGuard(config)`, `await` a `fetch` to
   `https://198.51.100.5/x` and expect it to reject, then pass that guard to
   `createApp(config, { egress })`: `/attest` now reports `refused` 1 and
   `refusedByDestination['198.51.100.5:443']` 1.

Gate, tick the box in TODO.md, commit `src/routes/attest.ts`,
`src/app.ts` and `test/attest.test.ts`.

---

## §C2 — `GET /metrics`

Create `src/routes/metrics.ts`. **Mirror `src/routes/attest.ts`** (from §C1):
one `registerMetrics(app, ctx)` function, one `app.get(...)`. Register it in
`src/app.ts` next to the others.

This route returns text, not JSON. Two things it must do:

- set the response content type to
  `text/plain; version=0.0.4; charset=utf-8` (the Prometheus exposition
  content type) with `reply.header('content-type', …)`;
- return `ctx.metrics.render({ egress: ctx.egress.snapshot(), backends:
  ctx.health.snapshot() })` — the string, unmodified.

The registry does all the formatting; this route computes nothing.

Then create `test/metrics-route.test.ts`, mirroring `test/attest.test.ts`.
Use a one-backend config on `192.0.2.10:11434`. Assert:

1. `GET /metrics` answers 200 and its `content-type` header contains
   `text/plain`.
2. The body contains `gateway_backend_up{backend="box-a"} 0` — a backend that
   has never been probed is not up.
3. The body contains `gateway_egress_allowed_total 0` on a fresh gateway.
4. Build a metrics registry with `createMetrics()` from `../src/metrics.ts`,
   call `recordRequest('fast', 'ok')` on it, pass it as
   `createApp(config, { metrics })`, and assert the body contains
   `gateway_requests_total{model="fast",outcome="ok"} 1`.

Gate, tick the box in TODO.md, commit `src/routes/metrics.ts`, `src/app.ts`
and `test/metrics-route.test.ts`.

---

## §C3 — the chat route records what it did

Edit `src/routes/chat.ts`, the handler only. It already walks the priority
list; now it reports what happened to `ctx.metrics` and `ctx.ledger`. Add no
new branches — only calls inside the ones that exist.

Four requirements:

1. **A target answered** (the `response.status < 500` branch, right where it
   already calls `ctx.health.reportSuccess`): call
   `ctx.metrics.recordUpstreamLatency(backendName, elapsed)` and
   `ctx.metrics.recordRequest(logicalModel, 'ok')`, then
   `ctx.ledger.append({ event: 'request', model: logicalModel, backend:
   backendName, upstreamModel: target.model, status: response.status,
   latencyMs: elapsed, attempts, detail })`.
2. **`detail`** is `{ messages: n }`, where `n` is the length of
   `body.messages` when it is an array and 0 otherwise. It is the only
   body-derived thing the gateway records, and the ledger drops it when
   `ledger.redact` is true — so build it plainly and let the ledger decide.
3. **An attempt failed** (both the 5xx branch and the `catch`, right where
   they already call `ctx.health.reportFailure`): call
   `ctx.metrics.recordFailover(logicalModel, backendName)` and
   `ctx.ledger.append({ event: 'failover', model: logicalModel, backend:
   backendName, error: <the message> })`.
4. **Nothing succeeded** (the 502 and the 503 replies): call
   `ctx.metrics.recordRequest(logicalModel, 'error')` and
   `ctx.ledger.append({ event: 'request', model: logicalModel, status: 502 or
   503, attempts })` before sending.

The two early 404 branches and the 501 streaming branch record nothing — they
never touched a backend.

Then create `test/instrumentation.test.ts`, mirroring `test/failover.test.ts`
(two mock upstreams, `startMockUpstream`, `finally { await app.close() }`).
Build the ledger yourself with `createLedger(config)` from `../src/ledger.ts`
and pass it as `createApp(config, { ledger })` so you can read `tail()`.
Assert:

1. After one successful chat request, `ledger.tail()` has exactly one entry,
   its `event` is `'request'`, its `backend` is the box that answered, its
   `status` is 200, and its `detail` is `{ messages: 1 }`.
2. With the first upstream answering 500 and the second answering 200, the
   tail is a `'failover'` entry naming `box-a` followed by a `'request'`
   entry naming `box-b` with `attempts` 2.
3. `GET /metrics` on the same app contains
   `gateway_requests_total{model="fast",outcome="ok"} 1` and a
   `gateway_failovers_total{model="fast",backend="box-a"}` line.
4. A request for an unknown logical model answers 404 and adds nothing to
   `ledger.tail()`.

`pnpm test` must stay green: the 4 tests in `test/chat.test.ts` and the 5 in
`test/failover.test.ts` still describe correct behaviour and must not be
edited.

Gate, tick the box in TODO.md, commit `src/routes/chat.ts` and
`test/instrumentation.test.ts`.

---

## §C4 — static bearer token auth

Create `src/auth.ts` — not a route: one exported
`registerAuth(app: FastifyInstance, ctx: GatewayContext): void` that installs
a Fastify `onRequest` hook. Call it in `src/app.ts` immediately after the
`Fastify({ … })` line, before the route registrations. Mirror
`src/routes/healthz.ts` for file shape (header comment, typed imports, one
exported register function).

Five rules:

1. When `ctx.config.auth.token` is `null`, install no hook at all and return.
   Every existing test uses a config without a token, so they must stay green
   and unedited.
2. Exempt paths: `/healthz` and `/`. They answer without a token — a liveness
   probe and (in a later phase) the dashboard page itself. Compare against
   `request.url` truncated at the first `?`.
3. Every other path requires the header `Authorization: Bearer <token>`. The
   scheme word is case-insensitive; the token is not.
4. Compare the presented token to the configured one with `timingSafeEqual`
   from `node:crypto`, over `Buffer.from(value)` of each. Different byte
   lengths reject immediately — `timingSafeEqual` throws on unequal lengths.
5. A missing, malformed or wrong token gets status 401, the header
   `WWW-Authenticate: Bearer`, and this body:
   `{ error: { message: 'Invalid or missing bearer token', type:
   'invalid_request_error', code: 'invalid_api_key' } }`.

Then create `test/auth.test.ts`, mirroring `test/app.test.ts`. Use a
one-backend config and the token `'test-token'`. Assert:

1. With `auth.token` null, `GET /v1/models` answers 200 with no header sent.
2. With the token set and no `Authorization` header, `GET /v1/models` answers
   401 and the body's `error.code` is `'invalid_api_key'`.
3. With the token set and `Authorization: Bearer wrong-token`, the answer is
   401.
4. With the token set and `Authorization: Bearer test-token`, the answer is
   200.
5. With the token set, `GET /healthz` answers 200 with no header sent.

Gate, tick the box in TODO.md, commit `src/auth.ts`, `src/app.ts` and
`test/auth.test.ts`.

---

## §C5 — README: the ops surface, and a config bug

Edit `README.md`. No code changes. Three edits.

1. **Fix the failover demo's YAML block.** It currently shows backends with a
   `url:` key and no `/v1` path — that config does not parse. The key is
   `baseUrl:`, and the value is the upstream's OpenAI-compatible base, so
   `http://192.0.2.10:11434/v1` and `http://192.0.2.20:11434/v1`. Change only
   those lines; keep the rest of the block and the surrounding steps.
2. **Rewrite the "Ops" section** so it describes what exists now. Keep the
   `/healthz` paragraph and the `health` block list as they are, then add:
   - `GET /attest` — the boot-bound allowlist, the allowed and refused
     counters, refusals per destination, and each backend's destination. Say
     plainly that the allowlist is derived from `backends` at boot and from
     nothing else, and that the refusal path itself is proven by the test
     suite (`pnpm test`), not by a runtime switch.
   - `GET /metrics` — Prometheus text: `gateway_requests_total`,
     `gateway_upstream_latency_ms` (a per-backend histogram),
     `gateway_failovers_total`, `gateway_egress_allowed_total`,
     `gateway_egress_refused_total`, `gateway_backend_up`.
   - **The ledger** — one JSON object per line at `ledger.path`, recording
     `request`, `failover` and `egress_refused` events. `path: null` (the
     default) keeps an in-memory tail only. `redact: true` drops the
     body-derived `detail` field; bodies are never written either way.
   - **Auth** — set `auth.token` and every endpoint except `/healthz` and `/`
     requires `Authorization: Bearer <token>`. Show one `curl -H` example.
   Keep one sentence saying the dashboard is a later phase, and drop
   `/attest`, `/metrics` and the ledger from that sentence.
3. **Update "Limitations"** — replace the "one static bearer token — per-client
   API keys are a later phase" line only if it is now wrong; add a line saying
   `/healthz` is deliberately unauthenticated so a load balancer can probe it.

Hard rules unchanged: `localhost` or `192.0.2.x` addresses only, no CDN image
or badge, and describe nothing this repo has not built.

Gate: the usual three **plus** `bash scripts/readme-lint.sh` green. Tick the
box in TODO.md, commit `README.md`.

---

## §C6 — verify.sh green, STATUS.md and ROADMAP.md

No code changes. Run `bash verify.sh`; all four steps must be green before you
edit anything. If one is red, fix that instead and gate again.

Append a `## Phase C — the ops surface` section to the end of `STATUS.md`
(append only, never rewrite what is above). In short prose:

- what works now: `GET /attest` reporting the boot-bound allowlist, the
  allowed/refused counters and each backend's destination; `GET /metrics` in
  Prometheus text with request counts, a per-backend latency histogram,
  failovers, egress counters and backend gauges; a JSONL ledger recording
  request, failover and refused-egress events with a redaction toggle and an
  in-memory tail; and static bearer token auth on every endpoint except
  `/healthz` and `/`
- what is deliberately not built yet: SSE streaming (501 today), the
  dashboard, and `docs/PROCESS.md`
- the gate state: `verify.sh` all green as of Phase C

Then edit `ROADMAP.md` — replace the Status, Phase and Note cells of these
rows with exactly these values:

| Row | Status | Phase | Note |
|---|---|---|---|
| 5 Egress attestation | SHIPPED | C | allowlist, counters, /attest; refusal path proven in tests |
| 6 Ops surface | SHIPPED | C | /healthz, /metrics, /attest, bearer auth, JSONL ledger |

Leave every other row untouched.

Finally, append these three bullets to ROADMAP.md's "Reservations ledger",
matching the style of the entries already there:

- **No runtime way to make the gateway phone home.** `/attest` reports a
  refusal counter, but v1 ships no switch that asks the gateway to reach a
  non-upstream host, so a stranger sees the counter at 0 and the proof of the
  refusal path in `pnpm test`. Home: TASK_PHASE_C.md §C5.
- **`/healthz` and `/` are unauthenticated.** A liveness probe must work
  without a secret, and the dashboard page carries none — it will ask the
  operator for the token and send it on its own polls. Home: TASK_PHASE_C.md §C4.
- **The ledger's only body-derived field is `detail`.** Bodies are never
  written; `ledger.redact` drops the summary too. Home: TASK_PHASE_C.md §C3.

Gate: `bash verify.sh` green. Tick the box in TODO.md, commit `STATUS.md`,
`ROADMAP.md` and `TODO.md`.

---

## Reservations recorded in Phase C

Small calls deferred deliberately, so a later phase does not relitigate them:

- **The ledger is fire-and-forget.** `append` never awaits the disk and never
  throws; an unopenable path, a failed write or an append after close are
  dropped and the gateway keeps serving. A ledger problem is an ops problem,
  not a 500. No rotation either — that is logrotate's job.
- **`ledger.path` defaults to `null`.** A privacy gateway should not persist a
  request log unasked, and the default keeps CI and the test suite from
  writing files. The in-memory tail still feeds the dashboard.
- **Latency histogram buckets are frozen** at 10/25/50/100/250/500/1000/
  2500/5000/10000 ms. Changing them changes the meaning of every recorded
  series, so it is a spec call, not a tuning knob.
- **Metrics are unauthenticated only when `auth.token` is null.** With a token
  set, `/metrics` needs it like everything else; a scraper gets the same
  static token. Per-scraper credentials are out of scope (SPEC.md non-goals).
