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
