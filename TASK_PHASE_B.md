# Phase B — health, failover, and the two-box demo

Grep your section header (`## §B1`, `## §B2`, …), read that section, build it.
Do not read this file whole.

## Already built — do not rebuild

Committed before this phase opened (commit `feat(B0)`):

- `src/health.ts` — the health registry and the per-backend circuit
- `test/health.test.ts` — 14 tests covering it
- `src/config.ts` gained `health.generationProbe` (default `false`)
- `src/context.ts` gained `ctx.health`; `src/app.ts` builds the registry,
  stops it on close, and starts the probe loop only for `{ probe: true }`
- `deploy/gateway.example.yaml` documents the `health` block

**Gate for every task below unless the task says otherwise:**
`pnpm typecheck` clean AND `pnpm test` green AND `bash scripts/scrub-check.sh` green.

## The API you will use — signatures only

From `src/health.ts`, reachable in any route as `ctx.health`:

- `snapshot(): BackendHealth[]` — every backend, in config order.
- `get(name): BackendHealth | undefined`
- `isUsable(name): boolean` — false only while a backend's circuit is open.
- `reportSuccess(name, latencyMs): void` — closes the circuit.
- `reportFailure(name, error): void` — opens it for `health.cooldownMs`.
- `createHealthRegistry(config, egress, options?)` — build one by hand in tests.
- `BackendHealth` is
  `{ name, baseUrl, state, lastProbe, latencyMs, consecutiveFailures, lastError }`
  where `state` is `'unknown' | 'healthy' | 'unhealthy'`, and `lastProbe`,
  `latencyMs` and `lastError` are `null` until something happens.

`createApp(config, options)` accepts `{ egress, health, probe, logger }`. Tests
pass `health` to hand the gateway a registry they have already poked.

Imports carry the `.ts` extension (`from '../health.ts'`). Copy the import
style from the file you are told to mirror.

---

## §B1 — `/healthz` serves real state

Edit `src/routes/healthz.ts`. The handler currently builds a placeholder row
per backend with `state: 'unknown'`. Replace that with the live registry:
the `backends` array is `ctx.health.snapshot()`, unchanged.

Two more things in the same file:

- Top-level `status` is `'degraded'` when at least one backend's `state` is
  `'unhealthy'`, and `'ok'` otherwise.
- `src/health.ts` already exports a `BackendHealth` type with the right
  fields, so `healthz.ts` should re-export that one instead of declaring its
  own — one `export type { ... } from '../health.ts';` line.

Then update `test/app.test.ts` — it is the `/healthz` test file:

1. Its existing `toEqual` now needs the three new fields (`latencyMs`,
   `consecutiveFailures`, `lastError`), all `null`/`0` for an unprobed
   backend. Fix that assertion; do not weaken it to `toMatchObject`.
2. Add a second test: build a registry by hand with
   `createHealthRegistry(config, createEgressGuard(config))`, call
   `reportFailure('box-a', new Error('connect ECONNREFUSED'))` on it, pass it
   to `createApp(config, { health })`, then `GET /healthz` and assert the
   top-level `status` is `'degraded'`, that backend's `state` is
   `'unhealthy'`, its `consecutiveFailures` is `1`, and its `lastError`
   contains `ECONNREFUSED`.

Mirror `test/app.test.ts`'s existing style: `parseConfig` inline, `createApp`,
`app.inject`, `await app.close()` in a `finally`.

Gate, tick the box in TODO.md, commit `src/routes/healthz.ts` and
`test/app.test.ts`.

---

## §B2 — failover: walk the priority list

Edit `src/routes/chat.ts`, the handler only. Today it takes `targets[0]` and
sends one request. Make it walk every resolved target in order.

The pattern file is `src/routes/chat.ts` itself: its 404 branch shows the
error shape to reuse, and its existing `ctx.egress.fetch` call shows the URL,
headers and body to keep.

Leave the first three branches exactly as they are: missing/unknown model is
still 404 `model_not_found`, `stream: true` is still 501
`streaming_not_implemented`. Only the "send it upstream" part changes.

Five requirements:

1. Loop over `targets` in priority order. Skip any target where
   `ctx.health.isUsable(target.backend.name)` is false — a backend whose
   circuit is open is not contacted at all.
2. For each target you do attempt, build and send the same request the file
   already builds today (same URL, same headers, `model` swapped for
   `target.model`), timing it with `Date.now()` either side.
3. A response with status below 500 is a real answer: call
   `ctx.health.reportSuccess(backendName, elapsedMs)` and return that status
   and its JSON body, exactly as the file does today. Stop there.
4. A thrown error, or a response with status 500 or above, is a backend
   failure: call `ctx.health.reportFailure(backendName, error)` — build an
   `Error` yourself for the 5xx case — and continue to the next target.
5. After the loop, nothing succeeded. If you attempted at least one target,
   reply **502** with code `'upstream_unavailable'`. If every target was
   skipped as unusable, reply **503** with code `'no_healthy_backend'`. Both
   use the same OpenAI error shape the file already uses:
   `{ error: { message, type, code } }`.

Trying a target again after it fails, or splicing mid-stream, is not this
task. Each usable target is attempted exactly once, in order.

`pnpm test` must stay green: the four existing tests in `test/chat.test.ts`
still describe correct behaviour and must not be edited. New failover tests
are §B3.

Gate, tick the box in TODO.md, commit `src/routes/chat.ts`.

---

## §B3 — failover tests

No production code in this task. Create `test/failover.test.ts`. **Mirror
`test/chat.test.ts`**: start a mock upstream with `startMockUpstream`, build
the config *after* it is running so a backend's `baseUrl` is
`upstream.baseUrl`, drive the gateway with `app.inject`, close the app and the
upstream in a `finally`.

A dead backend is just a `baseUrl` nothing is listening on: use
`http://127.0.0.1:1/v1`. It is on the allowlist because it is in the config,
so egress permits it and the connection is refused instantly — no timers, no
sleeping.

Assert these five things:

1. **Failover works.** `box-dead` (`http://127.0.0.1:1/v1`) first, a live mock
   upstream second, one logical model listing both in that order. A chat
   request returns 200, and the mock recorded one chat request whose `model`
   is the *second* target's physical model name.
2. **The failure is recorded.** After that request, `GET /healthz` reports
   `box-dead` as `unhealthy` with `consecutiveFailures` 1, and the live
   backend as `healthy`.
3. **All targets dead → 502.** Two dead backends in the priority list; the
   request returns 502 with `body.error.code === 'upstream_unavailable'`.
4. **An open circuit is skipped.** One dead backend, one target. The first
   request returns 502; the second request to the same app returns **503**
   with `body.error.code === 'no_healthy_backend'` — the cooldown has not
   elapsed, so nothing was contacted.
5. **A 5xx upstream fails over too.** `startMockUpstream({ chatStatus: 500 })`
   first, a healthy mock second. The request returns 200 from the second, and
   the failing upstream recorded exactly one chat request.

Use only `localhost`, `127.0.0.1` or `192.0.2.x` addresses. Anything else
fails `scripts/scrub-check.sh`.

Gate, tick the box in TODO.md, commit `test/failover.test.ts`.

---

## §B4 — `scripts/smoke-local.sh`

Create `scripts/smoke-local.sh`, executable (`chmod +x`). No TypeScript
changes. This is the local-only smoke test SPEC.md asks for: it runs against a
*real* gateway with a *real* backend, so it is never wired into CI,
`verify.sh` or `package.json`.

**Mirror `scripts/readme-lint.sh`** for shape: `#!/usr/bin/env bash`, a header
comment saying what it is, `set -uo pipefail`, a `fail()` helper, a failure
counter, and a final summary line with a non-zero exit when anything failed.

What it does, in order, against `${GATEWAY_URL:-http://localhost:8080}`:

1. `GET /healthz` — fail if the gateway is not answering; otherwise echo the
   raw JSON so the operator can see the fleet.
2. `GET /v1/models` — fail unless the body contains `"object":"list"`.
3. `POST /v1/chat/completions` for the logical model in `${MODEL:-fast}` with
   one short user message — fail unless the response contains
   `"choices"`. Echo the body.
4. The forced failover: print instructions to stop the primary backend now
   (systemctl stop, unplug it, whatever), wait for the operator to press
   Enter, then repeat step 3 and fail unless it still succeeds. Then
   `GET /healthz` again and echo it, so the operator can see one backend has
   gone `unhealthy` while the request still landed.

Rules: use `curl -sS` only — no `jq`, no other tool a stranger may not have.
Read the URL and model from environment variables with the defaults above, and
say so in the header comment. Never write a real LAN address anywhere in the
file: `localhost` only.

Gate: the usual three, plus `bash -n scripts/smoke-local.sh` (a syntax check —
do not run the script itself, there is no gateway here). Tick the box in
TODO.md, commit `scripts/smoke-local.sh`.

---

## §B5 — README: the two-box failover demo

Edit `README.md`. No code changes. Three edits, all additive.

1. **New section, after "Quickstart (5 minutes)": "Failover demo (10
   minutes)".** SPEC.md promises a stranger this demo. Numbered steps: put two
   backends in `gateway.yaml` (`box-a`, `box-b`, both on documentation
   addresses); list the same logical model against both, `box-a` first; start
   the gateway; send a chat request and note which box answered; stop the
   `box-a` model server; send the same request again and see it answered by
   `box-b`; `curl http://localhost:8080/healthz` and see `box-a` reported
   `unhealthy` and the overall `status` `degraded`; restart `box-a` and watch
   it return to `healthy` within one probe interval. Close with one sentence:
   the gateway skips a failed backend for `health.cooldownMs` before it tries
   it again.
2. **Rewrite the "Ops" section.** `GET /healthz` is live now: it reports
   per-backend `state`, `lastProbe`, `latencyMs`, `consecutiveFailures` and
   `lastError`, plus a top-level `status` of `ok` or `degraded`. Mention the
   `health` config block (`intervalMs`, `timeoutMs`, `cooldownMs`,
   `generationProbe`), and mention `bash scripts/smoke-local.sh` as the
   local-only end-to-end check that is never run in CI. Keep the sentence
   saying `/attest`, `/metrics`, the ledger and the dashboard are later
   phases.
3. **Fix "Limitations".** The line claiming requests always go to the first
   backend is no longer true — replace it with: failover walks the priority
   list at request start, skipping backends whose circuit is open; there is
   still no queueing, no load balancing and no mid-stream failover.

Hard rules unchanged: `localhost` or `192.0.2.x` addresses only, no CDN image
or badge, and describe nothing this repo has not built.

Gate: the usual three **plus** `bash scripts/readme-lint.sh` green. Tick the
box in TODO.md, commit `README.md`.

---

## §B6 — verify.sh green, STATUS.md and ROADMAP.md

No code changes. Run `bash verify.sh`; all four steps must be green before you
edit anything. If one is red, fix that instead and gate again.

Append a `## Phase B — health, failover, and the two-box demo` section to the
end of `STATUS.md` (append only, never rewrite what is above). In short prose:

- what works now: periodic per-backend probing with an optional 1-token
  generation probe, a circuit that opens on failure and half-opens after
  `health.cooldownMs`, `/healthz` serving live state with an `ok`/`degraded`
  summary, chat requests walking the priority list and failing over past
  unusable backends, and `scripts/smoke-local.sh` plus the README's failover
  demo
- what is deliberately not built yet: SSE streaming (501 today), `/attest`,
  `/metrics`, auth, the JSONL ledger, the dashboard, `docs/PROCESS.md`
- the gate state: `verify.sh` all green as of Phase B

Then edit `ROADMAP.md` — replace the Status, Phase and Note cells of these
rows with exactly these values:

| Row | Status | Phase | Note |
|---|---|---|---|
| 1 One endpoint, many backends | SHIPPED | B | chat + models across N backends, with failover |
| 3 Health + failover | SHIPPED | B | probes, circuit + cooldown, priority-list failover |
| 6 Ops surface | PARTIAL | B | /healthz live; metrics, auth, ledger pending |
| 7 Deploy-grade packaging | PARTIAL | B | config, unit, CI, README + failover demo, smoke script; hero screenshot waits on the dashboard |

Leave every other row untouched.

Finally, append these two bullets to ROADMAP.md's "Reservations ledger",
matching the style of the entries already there:

- **A 5xx upstream is a backend failure; a 4xx is an answer.** Phase B fails
  over on status 500 and above and returns anything below it to the client
  unchanged. Home: TASK_PHASE_B.md §B2.
- **No retry budget and no mid-stream failover.** Each usable target is tried
  once, in priority order, at request start only. Home: TASK_PHASE_B.md §B2.

Gate: `bash verify.sh` green. Tick the box in TODO.md, commit `STATUS.md`,
`ROADMAP.md` and `TODO.md`.

---

## Reservations recorded in Phase B

Small calls deferred deliberately, so a later phase does not relitigate them:

- **The half-open circuit admits attempts by time, not by count.** Once
  `health.cooldownMs` has elapsed every caller sees `isUsable` as true until
  one of them reports a result. A single-flight limiter was considered and not
  taken: it buys little for a priority-list router and costs real complexity.
- **The prober is not exempt from attestation.** Every probe goes through
  `ctx.egress.fetch`, so probe traffic counts in `/attest`'s allowed counter.
  That is deliberate — a health checker that bypassed the door would be a hole
  in the centrepiece claim.
- **`health.generationProbe` picks the backend's first configured physical
  model**, walking logical names in sorted order. A per-backend probe-model
  override was considered and not taken; it is config surface for a rare case.
