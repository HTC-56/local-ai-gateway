# Phase D — SSE streaming pass-through

Grep your section header (`## §D1`, `## §D2`, …), read that section, build it.
Do not read this file whole.

## Already built — do not rebuild

Committed before this phase opened (the `feat(D0)` commit):

- `src/stream.ts` — `pipeSseResponse(reply, response)` and `isEventStream(response)`,
  with 7 tests in `test/stream.test.ts`
- `test/helpers/mock-upstream.ts` — a `stream: true` request now gets a real
  SSE body (one write per frame), with a `streamChunks` override. An error
  `chatStatus` still answers JSON, so failover tests keep working.
- `src/ledger.ts` — `LedgerEvent` gained an optional `stream?: boolean`

**Gate for every task below unless the task says otherwise:**
`pnpm typecheck` clean AND `pnpm test` green AND `bash scripts/scrub-check.sh` green.

## The API you will use — signatures only

From `src/stream.ts` (import with the `.ts` extension, as every file here does):

- `pipeSseResponse(reply, response): Promise<{ chunks, bytes, aborted }>` —
  takes over the reply and forwards the upstream body byte for byte. It sets
  the status and headers itself, keeps the upstream's `content-type` when it
  has one, and never throws. After calling it, the handler must not send
  anything else on that reply — `return reply`.
- `isEventStream(response): boolean` — true when the upstream answered with a
  `text/event-stream` content type.

From `test/helpers/mock-upstream.ts`:

- `startMockUpstream({ models?, chatStatus?, content?, chatBody?, streamChunks? })`.
  With defaults, a `stream: true` request gets four frames: three
  `chat.completion.chunk` deltas (the second carries `content`) then
  `data: [DONE]`.

**The one rule of this phase:** failover applies at request START only. Once
the gateway has begun piping bytes it is committed to that backend; there is
no mid-stream splice, by design.

---

## §D1 — the chat route streams

Edit `src/routes/chat.ts`, the handler only. Two changes, nothing else.

1. Remove the early `stream: true` → 501 block (the one whose code is
   `streaming_not_implemented`). Streaming is implemented now, so a streaming
   request must fall through to the normal target walk.

2. In the success branch — the `if (response.status < 500)` block — after the
   health/metrics/ledger calls that are already there:
   - include `stream: true` in that `ctx.ledger.append({ event: 'request', … })`
     entry when the client asked for streaming, so the entry names the one
     backend the client was committed to;
   - when `body.stream === true`, `await pipeSseResponse(reply, response)`
     (imported from `../stream.ts`) and `return reply`. Do **not** call
     `response.json()` and do **not** call `reply.send()` on that path — the
     helper has already taken the reply over.
   - when it is not streaming, the existing JSON path is unchanged.

Everything else stays exactly as it is: the priority walk, the `isUsable`
skip, the `>= 500` failover path, the 502 and 503 endings. Never try a second
backend after piping has started.

An upstream that answers a streaming request with a 4xx JSON body is still
`status < 500`, so it takes the same path; the helper preserves that
`content-type`, and the client sees the JSON error. That is correct — leave it.

Then edit `test/chat.test.ts`. The test named
`stream: true returns 501 and upstream receives no chat request` no longer
describes the gateway. Rewrite that one `it(...)` block — leave the other
three untouched — so it asserts the new behaviour instead:

1. status is 200 and the `content-type` header contains `text/event-stream`;
2. the payload contains `data: [DONE]`;
3. the upstream recorded exactly one `/v1/chat/completions` request, and that
   recorded body has `stream: true`.

Gate, tick the box in TODO.md, commit `src/routes/chat.ts` and
`test/chat.test.ts`.

---

## §D2 — streaming route tests

Create `test/streaming.test.ts`. **Mirror `test/chat.test.ts`**: module-level
`parseConfig` and `createApp` imports, `startMockUpstream` from
`./helpers/mock-upstream.ts`, the config built **after** the upstream is
running so the backend's `baseUrl` is `upstream.baseUrl`, `app.inject` to
drive it, `await app.close()` and `await upstream.close()` in a `finally`.

No production code in this task. One backend, `box-a`, mapped from the logical
model `fast` to a physical model name of your choosing.

Assert five things:

1. `startMockUpstream({ content: 'streamed words' })`; POST
   `/v1/chat/completions` with `stream: true` answers 200, its `content-type`
   header contains `text/event-stream`, and its `cache-control` header
   contains `no-cache`.
2. The payload contains exactly four `data: ` frames, ends with
   `data: [DONE]`, and contains `"content":"streamed words"` — the gateway
   forwarded the upstream's frames instead of re-framing them.
3. The upstream's recorded chat request body carries the **physical** model
   name (not the logical `fast`) and `stream: true`.
4. The same config with `stream` omitted still takes the JSON path: the
   `content-type` contains `application/json` and
   `choices[0].message.content` is the mock content.
5. Build a ledger with `createLedger(config)` from `../src/ledger.ts`, pass it
   as `createApp(config, { ledger })`, send one streaming request, and assert
   `ledger.tail()` holds a `request` entry with `stream: true`,
   `backend: 'box-a'` and `status: 200`.

Gate, tick the box in TODO.md, commit `test/streaming.test.ts`.

---

## §D3 — streaming failover tests

Create `test/streaming-failover.test.ts`. **Mirror `test/failover.test.ts`** —
same imports, same shape, and the same trick for a dead backend: a `baseUrl`
nothing is listening on, `http://127.0.0.1:1/v1`, refused instantly with no
timers and no sleeping.

No production code in this task. Assert four things:

1. Two backends in priority order — `box-a` from
   `startMockUpstream({ chatStatus: 500 })` first, `box-b` from
   `startMockUpstream()` second, `health: { cooldownMs: 1 }`. A `stream: true`
   request answers 200 `text/event-stream` containing `data: [DONE]`, and the
   failing upstream recorded exactly one chat request.
2. Same setup, with a ledger passed via `createApp(config, { ledger })`: the
   tail holds a `failover` entry naming `box-a`, and after it a `request`
   entry naming `box-b` with `stream: true`.
3. Both backends dead (`http://127.0.0.1:1/v1` and `http://127.0.0.1:2/v1`,
   `cooldownMs: 1`): a `stream: true` request answers **502** with JSON
   `error.code` of `upstream_unavailable`. A stream that never started is an
   ordinary error, not a half-open stream — no SSE headers on this answer.
4. An open circuit is skipped for streaming too. One dead backend with
   `health: { cooldownMs: 30_000 }`: the first streaming request answers 502
   and opens the circuit; the second answers **503** with `error.code`
   `no_healthy_backend`, because the backend is skipped without being
   contacted. (`test/failover.test.ts` test 4 is this same two-request
   pattern — copy its shape.)

Gate, tick the box in TODO.md, commit `test/streaming-failover.test.ts`.

---

## §D4 — README: streaming

Edit `README.md`. Extra gate for this task: `bash scripts/readme-lint.sh` —
every shell command shown in the README must exist in the repo.

Three edits, no new top-level sections beyond the first:

1. Add a `## Streaming` section after `## Failover demo (10 minutes)`. It
   says: pass `"stream": true` in the request body and the gateway proxies the
   upstream's Server-Sent Events straight through, chunk for chunk, ending
   with `data: [DONE]`. Show one `curl` example against
   `http://localhost:8080/v1/chat/completions` using `-N` (no buffering), the
   `fast` logical model, and `"stream": true` — mirror the formatting of the
   quickstart's existing chat `curl` block.
2. In that same section, state the limitation plainly in one or two sentences:
   the gateway picks a backend at request start and stays with it. If a
   backend dies mid-stream the client's stream ends early and the client
   retries; the gateway will not splice a second backend into a stream in
   progress, because that would mean handing the client tokens the first
   backend never produced.
3. In `## Limitations`, replace the stale clause `and no mid-stream failover`
   in the failover bullet so it points at the new section instead — the
   sentence must no longer read as if streaming is unimplemented. Nothing else
   in that list changes.

Documentation addresses stay `localhost` and `192.0.2.x` only.

Gate (typecheck + test + scrub + readme-lint), tick the box in TODO.md,
commit `README.md`.

---

## §D5 — Phase D close-out

Run `bash verify.sh`. It must print `verify: all green`. If it does not, fix
what it names before touching any document. Gate for this task: `bash verify.sh`.

Then two documents.

**`STATUS.md`** — append a new section at the end, matching the shape of the
`## Phase C — the ops surface` section already there: a heading
`## Phase D — SSE streaming pass-through`, two short paragraphs on what the
gateway does now (streaming chat completions proxied chunk-for-chunk through
`src/stream.ts`; failover at request start only, no mid-stream splice), a
`What is deliberately not built yet:` line listing **the dashboard and
`docs/PROCESS.md`** — and nothing else, because streaming was the last item
before them — and a closing line
`Gate state: \`verify.sh\` all green as of Phase D.`

**`ROADMAP.md`** — edit rows in the table (row edits are the one permitted
exception to append-only):

- Row 4, `SSE streaming pass-through`: status `SHIPPED`, phase `D`, note
  `chunk-for-chunk pass-through; failover at request start only`.
- Row 7, `Deploy-grade packaging`: keep `PARTIAL`, keep phase `B`, and leave
  its note alone — the hero screenshot still waits on the dashboard.

Then in the `## Reservations ledger` section, append one bullet:
**No mid-stream failover splice** — a backend that dies mid-stream ends the
client's stream early; the gateway will not splice a second backend into a
stream in progress. Home: `TASK_PHASE_D.md` §D1.

Do not touch the reservation about streaming answering 501 — it is Phase A's
record of what was true then, and this file is a history, not a snapshot.

Gate, tick the box in TODO.md, commit `STATUS.md` and `ROADMAP.md`.
