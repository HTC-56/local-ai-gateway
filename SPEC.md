# local-ai-gateway — v1 spec

A small, production-shaped gateway for private AI fleets: one OpenAI-compatible
endpoint fronting N local model servers (ollama first), with logical model
routing, health-based failover, and a provable no-egress privacy posture.
Built end-to-end by an autonomous local-model coding loop; the commit history
is part of the deliverable (see `docs/PROCESS.md` when it lands).

## v1 features (all of these, nothing more)

1. **One endpoint, many backends.** `POST /v1/chat/completions` (+ `GET
   /v1/models`), OpenAI wire format, fronting N configured upstreams (ollama's
   OpenAI-compat endpoint; any OpenAI-compat server works). Apps integrate
   once; models live anywhere on the LAN.
2. **Logical model routing.** Config maps a logical name (`fast`, `coder`,
   `heavy`) to a priority list of `(backend, model)` pairs. Requests name the
   logical model; the gateway resolves it.
3. **Health + failover.** Periodic probe per backend (models list + optional
   1-token generation probe with timeout). Unhealthy backends are skipped;
   requests fail over down the priority list; a circuit half-opens after a
   cooldown. Kill a backend → the next request lands on the fallback, and the
   ledger records the failover.
4. **SSE streaming pass-through.** Streaming responses proxied
   chunk-for-chunk; failover applies at request start only (no mid-stream
   splice — documented limitation).
5. **Egress attestation — the centerpiece.** The gateway binds an outbound
   allowlist at boot from the configured upstreams. `GET /attest` reports the
   allowlist and counters of refused destinations; any outbound request to a
   non-upstream host is refused and counted. The test suite PROVES the
   refusal path. "Private AI" as a demonstrated property, not a claim.
6. **Ops surface.** `GET /healthz` (per-backend state, last probe), `GET
   /metrics` (Prometheus text: request counts, per-backend latency
   histograms, failovers, refused-egress). Static bearer token auth. JSONL
   request ledger with a redaction toggle (routing metadata only, never
   bodies, when set).
7. **Deploy-grade packaging.** Single YAML config; example systemd unit;
   README with a 5-minute quickstart against one ollama box and a 10-minute
   two-box failover demo; GitHub Actions CI (lint, typecheck, unit +
   integration tests) that runs with NO model and NO GPU.
8. **The dashboard.** `GET /` serves a single self-contained HTML page
   (inline CSS/JS, dark ops aesthetic, light-mode aware) polling `/healthz`,
   `/metrics` and `/attest` every few seconds: a fleet card per backend
   (state, latency trend, models), a failover/refused-egress event feed from
   the ledger tail, throughput counters, and the attestation panel front and
   center. **Self-containment is load-bearing, not stylistic**: the dashboard
   of a no-egress gateway must itself make zero external requests — no CDN,
   no web fonts, no analytics — and the egress test suite covers the
   dashboard's own page. This page is the README's hero screenshot.

## Non-goals (v1 refuses these)

- No queueing/scheduling, no least-loaded balancing — priority + health only.
- No embeddings/completions-legacy/images endpoints.
- No multi-tenant auth, quotas, or billing. One static token.
- No TLS termination (document "front with caddy/nginx or your mesh").
- No UI framework, no build step for the dashboard — one hand-written HTML
  file served by Fastify. React/Vite anywhere in this repo is a spec bug.
- No mid-stream failover splice.
- No database. In-memory state + JSONL ledger.

## Stack & shape

- TypeScript, Fastify, Zod, Vitest, pnpm. Dependency surface deliberately
  tiny — a task that adds a dependency must name it and why.
- Layout: `src/` (server, router, health, attest, ledger, dashboard), `test/`
  (unit + integration against a MOCK upstream started in-process),
  `deploy/` (systemd unit example, example YAML), `README.md`,
  `docs/PROCESS.md`.
- `docs/PROCESS.md` — "how this repo was built": the autonomous-loop
  architecture in one page and a sanitized ledger excerpt. A real
  deliverable, not an afterthought.

## Gates

- `pnpm typecheck` + `pnpm test` green at every phase end. Integration tests
  spin a mock OpenAI-compat upstream in-process — deterministic, CI-safe, no
  GPU, no model.
- `bash scripts/scrub-check.sh` green from phase 1: greps the tree and staged
  docs for private hostnames, non-documentation IPs, absolute home paths, and
  key material. Docs use `localhost` and `192.0.2.x` only.
- `scripts/smoke-local.sh` — optional, local-only: quickstart against a real
  ollama plus one forced failover. Never in CI.
- `verify.sh` = typecheck + test + scrub-check + README-quickstart lint
  (commands shown in the README must exist in the repo).

## Done means

A stranger with two ollama boxes follows the README: unified endpoint up in 5
minutes; failover demo works; `/attest` shows the allowlist and a
refused-egress counter incrementing when they try to make it phone home; the
dashboard shows the fleet breathing. CI badge green. PROCESS.md tells the
loop story in one page.
