# Phase A — the gateway skeleton

Grep your section header (`## §A6`, `## §A7`, …), read that section, build it.
Do not read this file whole.

## Already built — do not rebuild

Committed before this phase opened:

- `package.json`, `tsconfig.json`, `vitest.config.ts`, `pnpm-lock.yaml`
- `scripts/scrub-check.sh`, `scripts/readme-lint.sh`, `verify.sh`
- `src/config.ts` — config schema, loader, logical-model resolver
- `src/egress.ts` — boot-bound allowlist, guarded fetch, refusal counters
- `src/context.ts`, `src/app.ts`, `src/main.ts`, `src/routes/healthz.ts`
- `test/helpers/mock-upstream.ts`, `test/egress.test.ts`, `test/app.test.ts`,
  `test/mock-upstream.test.ts`
- `deploy/gateway.example.yaml`, `deploy/local-ai-gateway.service`,
  `.github/workflows/ci.yml`

**Gate for every task below unless the task says otherwise:**
`pnpm typecheck` clean AND `pnpm test` green AND `bash scripts/scrub-check.sh` green.

## The API you will use — signatures only

From `src/config.ts`:

- `listLogicalModels(config): string[]` — logical names, sorted.
- `resolveLogical(config, logical): ResolvedTarget[]` — priority-ordered;
  `[]` when the logical name is unknown.
- `ResolvedTarget` is `{ backend: { name, baseUrl }, model: string }`.
- `parseConfig(raw): Config`, `loadConfig(path): Config`, both throw `ConfigError`
  (which has an `issues: string[]`).

From `src/egress.ts`:

- `ctx.egress.fetch(url, init?)` — the ONLY outbound door. Throws
  `EgressRefusedError` for any destination not bound at boot.

From `src/context.ts`: handlers receive `ctx` with `ctx.config` and `ctx.egress`.

Imports in this repo carry the `.ts` extension (`from '../config.ts'`) — Node
strips types at runtime and there is no build step. Copy the import style from
the file you are told to mirror.

---

## §A6 — `GET /v1/models`

Create `src/routes/models.ts`. **Mirror `src/routes/healthz.ts`**: same file
shape — one exported `registerModels(app, ctx)` function, one `app.get(...)`
call, an async handler that returns a plain object.

Serve the OpenAI model-list shape:

- top level `{ object: 'list', data: [ ... ] }`
- one `data` entry per logical model name from `listLogicalModels(ctx.config)`
- each entry: `id` = the logical name, `object` = `'model'`, `created` = the
  current time in whole unix **seconds**, `owned_by` = `'local-ai-gateway'`

Physical model names are never exposed here — clients only ever see logical
names.

Then register it in `src/app.ts`: one import next to the `registerHealthz`
import, one call next to the `registerHealthz(app, ctx)` call. Change nothing
else in that file.

Test in `test/models.test.ts`. **Mirror `test/app.test.ts`** — build a config
with `parseConfig`, `createApp(config)`, drive it with `app.inject`, close the
app in a `finally`. Give the test config three logical models whose names are
NOT in alphabetical order in the config (for example `heavy`, `fast`, `coder`).

Assert:

1. the response status is 200 and `object` is `'list'`
2. `data.map(m => m.id)` equals the logical names in sorted order
3. every entry has `object === 'model'` and `owned_by === 'local-ai-gateway'`
4. `created` is a positive integer (no fractional milliseconds)

Gate, tick the box in TODO.md, commit `src/routes/models.ts`, `src/app.ts` and
`test/models.test.ts`.

---

## §A7 — Config loader tests

No production code in this task. Create `test/config.test.ts`. **Mirror
`test/egress.test.ts`** for style: `describe`/`it` blocks, imports from
`../src/config.ts`, small config objects built inline in each test.

Valid configs need only `backends` (a list of `{ name, baseUrl }`) and `models`
(logical name -> list of `{ backend, model }`); everything else has a default.

Assert these six things:

1. A minimal valid config parses and the defaults fill in: `listen.host` is
   `'127.0.0.1'`, `listen.port` is `8080`, `auth.token` is `null`,
   `ledger.redact` is `false`, `health.intervalMs` is `10000`.
2. A config with an empty `backends` list throws `ConfigError`.
3. Two backends sharing one name throws `ConfigError` whose message contains
   `duplicate`.
4. A model target naming a backend that is not defined throws `ConfigError`
   whose message contains `unknown backend`.
5. `resolveLogical` returns targets in the order the config lists them, each
   with the matching backend object attached, and returns `[]` for a logical
   name that is not in the config. `listLogicalModels` returns names sorted.
6. `loadConfig('deploy/gateway.example.yaml')` parses, and its backend names
   are `box-a` and `box-b` — this keeps the shipped example honest.

Use only documentation addresses in test configs: `localhost`, `127.0.0.1`,
`192.0.2.x`, `198.51.100.x`, `203.0.113.x`. Anything else fails
`scripts/scrub-check.sh`.

Gate, tick the box in TODO.md, commit `test/config.test.ts`.

---

## §A8 — `POST /v1/chat/completions` (non-streaming)

Create `src/routes/chat.ts`. **Mirror `src/routes/models.ts`** (which §A6
created): one exported `registerChat(app, ctx)`, one `app.post(...)`, and
register it in `src/app.ts` the same way — one import, one call.

Five requirements, in order:

1. Read `model` from the JSON request body and resolve it with
   `resolveLogical(ctx.config, model)`.
2. If the result is empty (or `model` is missing), reply **404** with the
   OpenAI error shape:
   `{ error: { message, type: 'invalid_request_error', code: 'model_not_found' } }`.
3. If the body has `stream: true`, reply **501** with that same error shape and
   code `'streaming_not_implemented'`. SSE streaming lands in a later phase.
4. Otherwise take the **first** resolved target and POST to
   `` `${target.backend.baseUrl}/chat/completions` `` through
   `ctx.egress.fetch`, with a JSON content-type header and the request body
   forwarded unchanged **except** that `model` is replaced by
   `target.model` — the physical name the upstream knows.
5. Reply with the upstream's status code and its parsed JSON body, unchanged.
   If `ctx.egress.fetch` rejects for any reason, reply **502** with the error
   shape and code `'upstream_unavailable'`.

Trying the *next* target when the first one fails is failover — a later phase.
This task uses the first target only.

Test in `test/chat.test.ts`. Start a mock upstream with
`startMockUpstream` (see `test/mock-upstream.test.ts` for the start/close
pattern), then build the config **after** it is running so a backend's
`baseUrl` is `upstream.baseUrl`; the egress guard then allows that destination
automatically. Drive the gateway with `app.inject`. Close the app and the
upstream in a `finally`.

Assert:

1. a request naming an unknown logical model returns 404 and
   `body.error.code` is `'model_not_found'`
2. a request with `stream: true` returns 501 and the upstream received no
   chat request
3. a valid request returns 200 and the upstream recorded a body whose `model`
   is the **physical** model name from the config, not the logical one
4. the response body is the upstream's JSON (its `choices[0].message.content`
   survives the hop)

Gate, tick the box in TODO.md, commit `src/routes/chat.ts`, `src/app.ts` and
`test/chat.test.ts`.

---

## §A9 — README with the 5-minute quickstart

Create `README.md`. No code changes.

`scripts/readme-lint.sh` checks it: every `pnpm <name>` you show must be a real
script in `package.json` (`start`, `typecheck`, `test`, `scrub`, `verify`), and
every `bash <path>` / `node <path>` must be a file that exists. Run that lint
before you commit.

Sections, in this order:

1. **Title + one paragraph** — what this is: one OpenAI-compatible endpoint in
   front of several local model servers, with logical model names and a
   provable no-egress posture. Two sentences of why, not a sales page.
2. **Requirements** — Node 22.18+, pnpm, and at least one OpenAI-compatible
   model server on the LAN (ollama is the reference).
3. **Quickstart (5 minutes)** — numbered: `pnpm install`; copy
   `deploy/gateway.example.yaml` to `gateway.yaml` and point a backend at your
   own box; `pnpm start`; then two `curl` examples against
   `http://localhost:8080` — `GET /v1/models` and a `POST
   /v1/chat/completions` asking for the logical model `fast`.
4. **Configuration** — walk the example file's blocks (`listen`, `auth`,
   `ledger`, `health`, `backends`, `models`) in a short list, and state plainly
   that the `backends` list *is* the egress allowlist.
5. **Ops** — `GET /healthz` today; note that `/attest`, `/metrics`, the JSONL
   ledger and the dashboard arrive in later phases.
6. **Limitations** — no TLS (front it with caddy/nginx), no queueing or
   load balancing, no mid-stream failover, one static token.
7. **Development** — `pnpm typecheck`, `pnpm test`, `bash verify.sh`, and one
   line saying this repo is built by an autonomous coding loop.

Hard rules: addresses in examples are `localhost` or `192.0.2.x` only — never a
real LAN address. No image, badge or link that fetches from a CDN. Do not
describe anything as working that this phase has not built; say "later phase".

Gate: the usual three **plus** `bash scripts/readme-lint.sh` green. Tick the
box in TODO.md, commit `README.md`.

---

## §A10 — verify.sh green, STATUS.md and ROADMAP.md

No code changes. Run `bash verify.sh`; all four steps must be green before you
edit anything. If one is red, fix that instead and gate again.

Append a `## Phase A — the gateway skeleton` section to the end of `STATUS.md`
(append only, never rewrite what is above). In it, in short prose:

- what works now: one endpoint with `/v1/models` and non-streaming
  `/v1/chat/completions`, logical model routing, `/healthz`, a boot-bound
  egress allowlist with refusal counters, and the config/CI/systemd packaging
- what is deliberately not built yet: health probing and failover, SSE
  streaming (501 today), `/attest`, `/metrics`, auth, the JSONL ledger, the
  dashboard, `docs/PROCESS.md`
- the gate state: `verify.sh` all green as of Phase A

Then edit `ROADMAP.md` — replace the Status and Phase cells of these rows with
exactly these values, and put the given note in the Note column:

| Row | Status | Phase | Note |
|---|---|---|---|
| 1 One endpoint, many backends | PARTIAL | A | chat + models; single target, no failover yet |
| 2 Logical model routing | SHIPPED | A | config resolver + /v1/models |
| 4 SSE streaming pass-through | NOT BUILT | — | returns 501 until its phase |
| 5 Egress attestation | PARTIAL | A | allowlist + counters; /attest endpoint pending |
| 6 Ops surface | PARTIAL | A | /healthz only; metrics, auth, ledger pending |
| 7 Deploy-grade packaging | PARTIAL | A | config, unit, CI, README; smoke script pending |

Leave rows 3, 8 and the `docs/PROCESS.md` row untouched.

Gate: `bash verify.sh` green. Tick the box in TODO.md, commit `STATUS.md`,
`ROADMAP.md` and `TODO.md`.

---

## Reservations recorded in Phase A

Small calls deferred deliberately, so a later phase does not relitigate them:

- **Process-wide egress interception.** v1 proves the no-egress property at the
  one door the gateway uses: every outbound request goes through
  `ctx.egress.fetch`, and the test suite proves refusal there. Installing a
  global undici dispatcher to catch traffic from *any* code path was considered
  and deferred — it buys little while the dependency surface is this small, and
  it would make the refusal counters harder to attribute.
- **Streaming answers 501, it does not 400.** A `stream: true` request is a
  valid request the gateway cannot serve yet, so §A8 returns 501 rather than
  pretending the request is malformed. The SSE phase replaces that branch.
- **Failover is not in the chat route yet.** §A8 uses the first resolved target
  only. The health/failover phase owns walking the rest of the priority list.
