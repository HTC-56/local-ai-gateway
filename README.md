# local-ai-gateway

One OpenAI-compatible HTTP endpoint fronting several local model servers on your
LAN. Logical model names in the config resolve to physical backends at request
time, and the gateway enforces a boot-bound egress allowlist so no other outbound
connections are possible.

## Requirements

- Node 22.18 or later
- pnpm
- At least one OpenAI-compatible model server on your LAN (ollama is the
  reference implementation)

## Quickstart (5 minutes)

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Copy the example configuration to `./gateway.yaml` and edit it so the
   `backends` list points at your own machine:

   ```bash
   cp deploy/gateway.example.yaml gateway.yaml
   ```

3. Start the gateway:

   ```bash
   pnpm start
   ```

4. Send requests to `http://localhost:8080`. List the logical models:

   ```bash
   curl http://localhost:8080/v1/models
   ```

   Ask `fast` for a chat completion:

   ```bash
   curl -s http://localhost:8080/v1/chat/completions \
     -H 'Content-Type: application/json' \
     -d '{"model": "fast", "messages": [{"role": "user", "content": "Hi"}]}'
   ```

## Failover demo (10 minutes)

Prove the failover path with two model servers on documentation addresses.

1. Edit `gateway.yaml` so `backends` lists two boxes and `models` maps the same
   logical name to both, `box-a` first:

   ```yaml
   backends:
     - name: box-a
       baseUrl: http://192.0.2.1:11434/v1
     - name: box-b
       baseUrl: http://192.0.2.2:11434/v1

   models:
     fast:
       - backend: box-a
         model: qwen2.5:1.5b
       - backend: box-b
         model: qwen2.5:1.5b
   ```

2. Start `box-a`'s model server, start the gateway (`pnpm start`), then send a
   chat request and note which box answered:

   ```bash
   curl -s http://localhost:8080/v1/chat/completions \
     -H 'Content-Type: application/json' \
     -d '{"model": "fast", "messages": [{"role": "user", "content": "Hi"}]}'
   ```

3. Stop the model server on `box-a`, then send the same request again — the
   gateway answers from `box-b`.

4. Check health:

   ```bash
   curl http://localhost:8080/healthz
   ```

   `box-a` shows `state: "unhealthy"` and the top-level `status` is `"degraded"`.

5. Restart `box-a`'s model server and wait one probe interval — `box-a` returns
   to `"healthy"` and the status goes back to `"ok"`.

The gateway skips a failed backend for `health.cooldownMs` before it tries it
again.

## Streaming

Pass `"stream": true` in the request body and the gateway proxies the upstream's
Server-Sent Events straight through, chunk for chunk, ending with `data: [DONE]`.

```bash
curl -N http://localhost:8080/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model": "fast", "stream": true, "messages": [{"role": "user", "content": "Hi"}]}'
```

The gateway picks a backend at request start and stays with it. If a backend dies
mid-stream the client's stream ends early and the client retries; the gateway will
not splice a second backend into a stream in progress, because that would mean
handing the client tokens the first backend never produced.

## Configuration

Copy `deploy/gateway.example.yaml` to `gateway.yaml` and edit:

- **listen** — `host` and `port` the gateway binds to (default `127.0.0.1:8080`).
- **auth** — a static bearer token string; set to `null` for local development.
- **ledger** — `path` for the JSONL request log and `redact` (true logs routing
  metadata only, never request or response bodies).
- **health** — probe `intervalMs`, `timeoutMs`, and `cooldownMs` for the
  per-backend health checker; `generationProbe` (default `false`) sends a real
  1-token request to confirm the model can answer, not just that the port is
  open.
- **backends** — every upstream this gateway may talk to. This list *is* the
  egress allowlist: at boot the gateway binds `host:port` for each entry and
  refuses every other outbound destination.
- **models** — logical name → priority-ordered list of backend + physical model
  pairs. A client request is routed through the priority list, skipping
  backends whose circuit has opened from repeated failures.

## Ops

`GET /healthz` returns live per-backend health data: each entry carries `state`
(`"healthy"` or `"unhealthy"`), `lastProbe` (ISO timestamp), `latencyMs`,
`consecutiveFailures`, and `lastError`, plus a top-level `status` of `"ok"` when
every backend is healthy or `"degraded"` when at least one is not.

Configure probing with the `health` block in `gateway.yaml`:

- `intervalMs` — how often to probe each backend (default 10 000 ms).
- `timeoutMs` — how long to wait for a probe response before calling it a
  failure (default 2 000 ms).
- `cooldownMs` — how long to keep a failed backend in the circuit-open state
  before half-opening it for a trial probe (default 30 000 ms).
- `generationProbe` — send a 1-token request to the model endpoint so "healthy"
  means "can answer", not just "is listening" (default `false`).

`GET /attest` returns the boot-bound egress allowlist (sorted `host:port`
strings derived from `backends`), the `allowed` and `refused` counters,
refusals per destination, and each backend's `{ name, destination }`. The
allowlist is set once at boot from the config and does not change at runtime;
the refusal path is proven by the test suite (`pnpm test`), not by a runtime
switch.

`GET /metrics` returns Prometheus exposition text (`text/plain`) with these
metrics: `gateway_requests_total` (per model and outcome),
`gateway_upstream_latency_ms` (per-backend histogram),
`gateway_failovers_total` (per model and backend),
`gateway_egress_allowed_total`, `gateway_egress_refused_total`, and
`gateway_backend_up` (per backend gauge).

**The ledger** writes one JSON object per line to the file at `ledger.path`,
recording `request`, `failover`, and `egress_refused` events. `path: null`
(the default) keeps an in-memory tail only. `redact: true` drops the
body-derived `detail` field; request and response bodies are never written.

**Auth** — set `auth.token` to a static bearer token string. Every endpoint
except `/healthz` and `/` requires `Authorization: Bearer <token>`.

```bash
curl -H 'Authorization: Bearer my-token' http://localhost:8080/v1/models
```

Run `bash scripts/smoke-local.sh` for a local-only end-to-end smoke test that
starts two mock upstreams, sends a chat request, forces failover, and checks
healthz — never run in CI.

The dashboard is a later phase.

## Limitations

- No TLS — front the gateway with caddy or nginx if you need HTTPS.
- `/healthz` is deliberately unauthenticated so a load balancer can probe it.
- Failover walks the priority list at request start, skipping backends whose
  circuit is open; there is still no queueing, no load balancing. Streaming
  has no mid-stream failover — see the Streaming section above.

## Development

```bash
pnpm typecheck
pnpm test
bash verify.sh
```

This repo is built by an autonomous coding loop.
