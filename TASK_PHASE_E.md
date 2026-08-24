# Phase E — the dashboard and the process log

Grep your section header (`## §E1`, `## §E2`, …), read that section, build it.
Do not read this file whole.

This is the last phase of SPEC.md v1: the dashboard, the feed endpoint it
needs, the README section, and `docs/PROCESS.md`.

## Already built — do not rebuild

Committed before this phase opened (the two `feat(E0)` commits):

- `src/dashboard.html` — the whole page: one hand-written file, inline CSS and
  inline JS, no framework and no build step. It polls `/healthz`, `/attest`,
  `/metrics` and `/events` every 3 seconds, and asks the operator for the
  bearer token because `GET /` is served without one.
- `src/dashboard.ts` — `dashboardHtml()` (reads the page once, caches it) and
  `findExternalReferences(html)`, with 11 tests in `test/dashboard.test.ts`.
- `src/config.ts` — `modelsFor(config, backendName)`; `/healthz` rows now carry
  a `models` array.

**Gate for every task below unless the task says otherwise:**
`pnpm typecheck` clean AND `pnpm test` green AND `bash scripts/scrub-check.sh` green.

## The API you will use — signatures only

From `src/dashboard.ts` (import with the `.ts` extension, as every file here does):

- `dashboardHtml(): string` — the page, ready to send.
- `findExternalReferences(html: string): string[]` — every way the page could
  reach off-origin. An empty array means it is self-contained.

From `src/ledger.ts`, already on `ctx.ledger`:

- `tail(limit?: number): LedgerEntry[]` — the most recent entries, **oldest
  first**. No argument means every entry in the ring.

---

## §E1 — `GET /events`, the ledger tail over HTTP

Create `src/routes/events.ts`. **Mirror `src/routes/attest.ts`** — one
`registerEvents(app, ctx)` export, one `app.get(...)`, a plain object returned
from an async handler, the same file-header comment shape.

It answers `{ events: [...] }`, where the array is `ctx.ledger.tail(limit)` —
oldest first, exactly as the ledger returns it. Do not re-sort it.

`limit` comes from the query string (`request.query` as a record of optional
strings). The rules, in one sentence each:

- No `limit` → 50.
- A `limit` that parses as a positive integer → that many, capped at 200.
- Anything else (empty, zero, negative, `abc`) → 50.

Register it in `src/app.ts` next to `registerAttest(app, ctx)`. Nothing else
in that file changes; auth already covers every path but `/healthz` and `/`.

Then create `test/events.test.ts`, **mirroring `test/attest.test.ts`**:
module-level `parseConfig`, `createApp`, `app.inject`, `await app.close()` in
a `finally`. Build a ledger with `createLedger(config)` from
`../src/ledger.ts` and pass it as `createApp(config, { ledger })` when a test
needs entries in it. Assert four things:

1. A gateway that has served nothing answers 200 with `events` an empty array.
2. With three events appended (a `request`, a `failover`, an
   `egress_refused`), the response lists all three in the order they were
   appended, and each carries a string `ts`.
3. `/events?limit=1` returns exactly one entry — the last one appended.
4. With `auth: { token: 'secret' }` in the config, `/events` without an
   `Authorization` header answers 401, and with `Bearer secret` answers 200.

Gate, tick the box in TODO.md, commit `src/routes/events.ts`,
`test/events.test.ts` and `src/app.ts`.

---

## §E2 — `GET /` serves the dashboard

Create `src/routes/root.ts`. **Mirror `src/routes/metrics.ts`** — one
`registerRoot(app, ctx)` export, one `app.get(...)`, `reply.header(...)` then
`return body`. That file is the pattern for a non-JSON response; follow it.

The handler returns `dashboardHtml()` from `../dashboard.ts` with two headers:

- `content-type: text/html; charset=utf-8`
- `cache-control: no-store` — an operator must always get the running
  gateway's page, never a cached one.

`ctx` is unused here; keep it in the signature so every route registers the
same way.

Register it in `src/app.ts` next to `registerMetrics(app, ctx)`. `/` is
already exempt from auth in `src/auth.ts` — do not touch that file.

Then create `test/root.test.ts`, **mirroring `test/metrics-route.test.ts`**.
Assert four things:

1. `GET /` answers 200 and its `content-type` header contains `text/html`.
2. The body is exactly `dashboardHtml()` — import it from
   `../src/dashboard.ts` and compare.
3. The `cache-control` header contains `no-store`.
4. With `auth: { token: 'secret' }` in the config and no `Authorization`
   header, `GET /` still answers 200 — the dashboard page carries no token and
   must load so it can ask the operator for one. (`test/auth.test.ts` has the
   same exempt-path shape for `/healthz`.)

Gate, tick the box in TODO.md, commit `src/routes/root.ts`,
`test/root.test.ts` and `src/app.ts`.

---

## §E3 — the served page makes zero external requests

Create `test/dashboard-egress.test.ts`. No production code in this task.

This is the test that turns SPEC.md feature 8's load-bearing sentence into a
gate: the dashboard of a no-egress gateway must itself make zero external
requests. Everything it asserts is about the page **as served by `GET /`**,
not the file on disk — so fetch it with `app.inject` and read
`response.body`, mirroring `test/root.test.ts` for the setup and
`test/egress.test.ts` for the fetch-spy trick.

Assert five things:

1. `findExternalReferences(response.body)` (imported from
   `../src/dashboard.ts`) is an empty array.
2. The served body contains no absolute URL at all — assert it does not match
   `/https?:\/\//`.
3. It pulls in no external code or styling: no `<script ... src=`, no
   `<link rel="stylesheet"`, no `@import`. A `<link rel="icon" href="data:,">`
   is fine and must stay allowed.
4. Every path the page fetches is same-origin: collect every `api('…')`
   argument in the body with a regex and assert each one starts with `/`.
5. Serving the page opens no socket. Build the app with an injected guard —
   `createEgressGuard(config, spy)` where `spy` is
   `vi.fn(async () => new Response('{}', { status: 200 }))` — pass it as
   `createApp(config, { egress })`, `GET /`, and assert the spy was never
   called.

Gate, tick the box in TODO.md, commit `test/dashboard-egress.test.ts`.

---

## §E4 — README: the dashboard

Edit `README.md`. Extra gate for this task: `bash scripts/readme-lint.sh` —
every shell command shown in the README must exist in the repo.

Three edits.

1. Add a `## Dashboard` section immediately after `## Streaming` and before
   `## Configuration`. It says: open `http://localhost:8080/` in a browser.
   The page is a single self-contained HTML file served by the gateway — no
   framework, no build step, and it makes no external requests of its own,
   which is the point. It polls `/healthz`, `/attest`, `/metrics` and
   `/events` every 3 seconds and shows: the egress attestation panel front and
   centre (allowlist, allowed and refused counters, refusals per
   destination), throughput counters, one fleet card per backend with state,
   latency trend and the models routed to it, and an event feed of requests,
   failovers and refused egress. If `auth.token` is set, paste the token into
   the field in the page header — `/` and `/healthz` are open, every other
   endpoint needs it.
2. End that section with a short **Hero screenshot** paragraph: the README's
   hero image is a real capture, not a committed placeholder. Tell the reader
   to run the failover demo, open the dashboard while one backend is down,
   save the capture as `docs/dashboard.png`, and replace that paragraph with
   an image link. Do not add a markdown image tag pointing at a file that
   does not exist.
3. In `## Ops`, replace the line `The dashboard is a later phase.` with a
   sentence pointing at the new section, and document `GET /events` beside
   the ledger paragraph: it returns `{ events: [...] }` from the in-memory
   ledger tail, oldest first, `?limit=N` (default 50, max 200), and it needs
   the bearer token like every other endpoint.

Documentation addresses stay `localhost` and `192.0.2.x` only.

Gate (typecheck + test + scrub + readme-lint), tick the box in TODO.md,
commit `README.md`.

---

## §E5 — `docs/PROCESS.md`, the loop story

Create `docs/PROCESS.md` — SPEC.md calls it a real deliverable: how this repo
was built, in about one page. Prose plus one table; no code.

Write these five parts, in this order:

1. **What this is.** This repo was built end-to-end by an autonomous coding
   loop against a fixed spec. The commit history is part of the deliverable.
2. **Two lanes.** The *planning lane* (a large cloud model) reads
   `ROADMAP.md` and `STATUS.md`, implements the engine of the next phase
   itself, commits it, then writes `TASK_PHASE_<letter>.md` and the pointer
   lines in `TODO.md`. The *execution lane* (a local 35B model with a 64k
   context window) takes the first unchecked task in `TODO.md`, greps its
   phase-doc section, builds it, gates it, ticks the box and commits — or
   writes `BLOCKED.md` and stops. One task per session.
3. **The context budget.** `TODO.md` is the only file the execution lane
   reads whole; every task must be completable from its checkbox, its one
   phase-doc section, and the two or three source files it names. A task that
   needs more than that is a planning failure, not a model failure.
4. **The gate.** `verify.sh` — typecheck, tests, `scrub-check.sh` (public-repo
   discipline: no private hostnames, no LAN IPs, no home paths, no keys) and
   the README-quickstart lint. Red is not done; there is no partial credit.
5. **The ledger.** One row per session. Explain the columns in a sentence
   (time, lane, model, result, turns, output tokens, tool calls, edits,
   duration, task), then show a **sanitized excerpt**: take the last 8 rows of
   `loop-ledger.tsv` with `tail`, and render them as a markdown table with
   the columns time, lane, model, result, turns and task only. Shorten each
   task cell to its section number and a few words. Change no numbers.

Close with two or three sentences on what the shape bought: phases A–E, every
SPEC.md feature gated at each phase end, and the honest split — the planning
lane commits its own share, so the `lane` column says which model wrote what.

Do not invent metrics you cannot read out of the repo. No absolute paths, no
private hostnames.

Gate, tick the box in TODO.md, commit `docs/PROCESS.md`.

---

## §E6 — Phase E close-out

Run `bash verify.sh`. It must print `verify: all green`. If it does not, fix
what it names before touching any document. Gate for this task: `bash verify.sh`.

Then two documents.

**`STATUS.md`** — append a new section at the end, matching the shape of the
`## Phase D — SSE streaming pass-through` section already there: a heading
`## Phase E — the dashboard and the process log`, two short paragraphs on what
the gateway does now (`GET /` serves the self-contained dashboard from
`src/dashboard.html`; `GET /events` serves the ledger tail; the page polls
`/healthz`, `/attest`, `/metrics` and `/events` and makes no external request,
which `test/dashboard-egress.test.ts` gates; `docs/PROCESS.md` tells the loop
story), a line naming what is left — **only the README's hero screenshot, a
capture a human takes** — and a closing line
`Gate state: \`verify.sh\` all green as of Phase E.`

**`ROADMAP.md`** — edit rows in the table (row edits are the one permitted
exception to append-only):

- Row 8, `Dashboard`: status `SHIPPED`, phase `E`, note
  `self-contained page at GET /, polls healthz/attest/metrics/events`.
- The `docs/PROCESS.md` row: status `SHIPPED`, phase `E`, note
  `the loop story plus a sanitized ledger excerpt`.
- Row 7, `Deploy-grade packaging`: status `SHIPPED`, phase `E`, note
  `config, unit, CI, README, smoke script; hero screenshot is a human capture`.
- Row 6, `Ops surface`: keep `SHIPPED` and keep phase `C`, but add `/events`
  to its note — the ledger tail is served now.

Then in the `## Reservations ledger` section, append two bullets:

- **`GET /events` is the feed's endpoint.** SPEC.md feature 8 names an event
  feed from the ledger tail but no endpoint for it; the gateway serves the
  tail at `/events`, authenticated like `/attest`. Home: `TASK_PHASE_E.md` §E1.
- **The hero screenshot is a human capture.** The loop commits no binary
  assets; the README names the capture and where to save it. Home:
  `TASK_PHASE_E.md` §E4.

Change nothing else in either file — both are histories, not snapshots.

Gate, tick the box in TODO.md, commit `STATUS.md` and `ROADMAP.md`.
