# Status

Repo scaffolded 2026-08-23. Nothing built yet. SPEC.md is the product;
DECISIONS.md locks the fence; ROADMAP.md is the scoreboard. The planning lane
authors Phase A from SPEC.md.

Per-phase sections append below as phases ship.

## Phase A — the gateway skeleton

The gateway is a Fastify server with one OpenAI-compatible entry point that
routes requests to a single upstream. `GET /v1/models` returns the provider's
model list; `POST /v1/chat/completions` proxies non-streaming chat requests
through to the resolved target. `GET /healthz` exposes a health check endpoint.
A boot-bound egress allowlist gates all outbound requests with refusal
counters. Configuration comes from a YAML file loaded at startup. The project
includes TypeScript type-checking, unit tests, CI, a systemd example, and two
gate scripts (scrub-check, readme-lint) that enforce public-repo discipline.

What is deliberately not built yet: health probing and failover, SSE streaming
(returns 501 today), `/attest`, `/metrics`, auth, the JSONL ledger, the
dashboard, and `docs/PROCESS.md`.

Gate state: `verify.sh` all green as of Phase A.

## Phase B — health, failover, and the two-box demo

The gateway now performs periodic per-backend probing with an optional 1-token
generation probe, and opens a circuit breaker on repeated failure that half-opens
after `health.cooldownMs`. `GET /healthz` serves live state from the health
manager with an `ok`/`degraded` summary. `POST /v1/chat/completions` walks the
priority list of resolved backends, skips those with open circuits, and fails
over to the next usable backend. `scripts/smoke-local.sh` and the README's
failover demo exercise the two-box scenario end-to-end.

What is deliberately not built yet: SSE streaming (501 today), `/attest`,
`/metrics`, auth, the JSONL ledger, the dashboard, and `docs/PROCESS.md`.

Gate state: `verify.sh` all green as of Phase B.

## Phase C — the ops surface

`GET /attest` reports the boot-bound allowlist (sorted `host:port` strings),
the allowed/refused counters, refusals per destination, and each backend's
destination. `GET /metrics` returns Prometheus text with request counts, a
per-backend latency histogram, failovers, egress counters and backend gauges.
A JSONL ledger records request, failover and refused-egress events with a
redaction toggle and an in-memory tail. Static bearer token auth protects
every endpoint except `/healthz` and `/`.

What is deliberately not built yet: the dashboard and `docs/PROCESS.md`.

Gate state: `verify.sh` all green as of Phase C.

## Phase D — SSE streaming pass-through

`POST /v1/chat/completions` now streams when `stream: true`, proxying upstream
SSE chunks chunk-for-chunk through `src/stream.ts`. Failover runs at request
start only — the gateway walks resolved backends, skips open circuits, and
chooses the first live one — but a backend that dies mid-stream ends the
client's stream early with no splice.

What is deliberately not built yet: the dashboard and `docs/PROCESS.md`.

Gate state: `verify.sh` all green as of Phase D.

## Phase E — the dashboard and the process log

`GET /` serves the self-contained dashboard from `src/dashboard.html`;
`GET /events` serves the ledger tail as JSON. The page polls `/healthz`,
`/attest`, `/metrics` and `/events` and makes no external request, which
`test/dashboard-egress.test.ts` gates. `docs/PROCESS.md` tells the loop
story — how this repo was built in a series of small, verifiable phases.

What is deliberately not built yet: the README's hero screenshot, a capture
a human takes.

Gate state: `verify.sh` all green as of Phase E.
