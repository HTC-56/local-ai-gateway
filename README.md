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

## Configuration

Copy `deploy/gateway.example.yaml` to `gateway.yaml` and edit:

- **listen** — `host` and `port` the gateway binds to (default `127.0.0.1:8080`).
- **auth** — a static bearer token string; set to `null` for local development.
- **ledger** — `path` for the JSONL request log and `redact` (true logs routing
  metadata only, never request or response bodies).
- **health** — probe `intervalMs`, `timeoutMs`, and `cooldownMs` for the
  per-backend health checker.
- **backends** — every upstream this gateway may talk to. This list *is* the
  egress allowlist: at boot the gateway binds `host:port` for each entry and
  refuses every other outbound destination.
- **models** — logical name → priority-ordered list of backend + physical model
  pairs. A client request for `fast` is routed to the first healthy backend in
  the list.

## Ops

`GET /healthz` reports every backend as `unknown` today; the live health prober
that fills in `healthy` / `unhealthy` states arrives in a later phase.

`/attest`, `/metrics`, the JSONL ledger, and the dashboard are planned for
later phases.

## Limitations

- No TLS — front the gateway with caddy or nginx if you need HTTPS.
- No queueing or load balancing — requests go to the first backend in the
  model's priority list.
- No mid-stream failover — a dropped upstream connection is not retried.
- One static bearer token — per-client API keys are a later phase.

## Development

```bash
pnpm typecheck
pnpm test
bash verify.sh
```

This repo is built by an autonomous coding loop.
