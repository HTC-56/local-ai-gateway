# Loop tasks

Ordered; each is one short session. Work the first unchecked box. Each task is
fully specced in ONE greppable section of its phase doc (`TASK_PHASE_A.md` §A1,
§A2, …) — grep your section, read it, build it.

*(no tasks yet — the planning lane authors Phase A from SPEC.md)*

## Phase A: the gateway skeleton — see TASK_PHASE_A.md

The foundation (toolchain, `src/config.ts`, `src/egress.ts`, `src/app.ts`,
`src/routes/healthz.ts`, the mock upstream, the gate scripts) is already
committed — see "Already built" in TASK_PHASE_A.md. Gate for every task below:
`pnpm typecheck` + `pnpm test` + `bash scripts/scrub-check.sh`, unless its
section says otherwise.

- [x] §A6 — `GET /v1/models` in `src/routes/models.ts`, mirroring
  `src/routes/healthz.ts`; register it in `src/app.ts`; test in
  `test/models.test.ts`. Spec: TASK_PHASE_A.md §A6.

- [x] §A7 — Config loader tests in `test/config.test.ts`, mirroring
  `test/egress.test.ts`. Six assertions are listed in TASK_PHASE_A.md §A7.
  No production code in this task.

- [x] §A8 — Non-streaming `POST /v1/chat/completions` in `src/routes/chat.ts`,
  mirroring `src/routes/models.ts`; register it in `src/app.ts`; test in
  `test/chat.test.ts` against the mock upstream. Spec: TASK_PHASE_A.md §A8.

- [x] §A9 — `README.md` with the 5-minute quickstart. Required sections and
  hard rules in TASK_PHASE_A.md §A9. Extra gate: `bash scripts/readme-lint.sh`.

- [x] §A10 — `bash verify.sh` green, then append the Phase A section to
  `STATUS.md` and set the ROADMAP.md rows listed in TASK_PHASE_A.md §A10.
  Gate: `bash verify.sh`.

## Phase B: health, failover, and the two-box demo — see TASK_PHASE_B.md

The engine (`src/health.ts`, its 14 tests, the `ctx.health` wiring and the
`health.generationProbe` config knob) is already committed — see "Already
built" in TASK_PHASE_B.md. Gate for every task below: `pnpm typecheck` +
`pnpm test` + `bash scripts/scrub-check.sh`, unless its section says otherwise.

- [x] §B1 — `/healthz` serves live state from `ctx.health.snapshot()` in
  `src/routes/healthz.ts`, plus an `ok`/`degraded` summary; update and extend
  `test/app.test.ts`. Spec: TASK_PHASE_B.md §B1.

- [x] §B2 — Failover in `src/routes/chat.ts`: walk every resolved target, skip
  backends whose circuit is open, report each result to `ctx.health`. The four
  tests in `test/chat.test.ts` stay green and unedited. Spec: TASK_PHASE_B.md §B2.

- [x] §B3 — Failover tests in `test/failover.test.ts`, mirroring
  `test/chat.test.ts`. Five assertions are listed in TASK_PHASE_B.md §B3.
  No production code in this task.

- [x] §B4 — `scripts/smoke-local.sh`, the local-only end-to-end plus forced
  failover check, mirroring `scripts/readme-lint.sh`. Never wired into CI or
  verify.sh. Extra gate: `bash -n scripts/smoke-local.sh`. Spec: TASK_PHASE_B.md §B4.

- [x] §B5 — `README.md`: add the 10-minute failover demo, rewrite Ops for the
  live `/healthz`, fix the stale Limitations line. Extra gate:
  `bash scripts/readme-lint.sh`. Spec: TASK_PHASE_B.md §B5.

- [x] §B6 — `bash verify.sh` green, then append the Phase B section to
  `STATUS.md` and set the ROADMAP.md rows and reservations listed in
  TASK_PHASE_B.md §B6. Gate: `bash verify.sh`.

## Phase C: the ops surface — see TASK_PHASE_C.md

The engines (`src/ledger.ts`, `src/metrics.ts`, their 19 tests, the
`ctx.ledger` / `ctx.metrics` wiring and the egress refusal hook) are already
committed — see "Already built" in TASK_PHASE_C.md. Gate for every task below:
`pnpm typecheck` + `pnpm test` + `bash scripts/scrub-check.sh`, unless its
section says otherwise.

- [x] §C1 — `GET /attest` in `src/routes/attest.ts`, mirroring
  `src/routes/healthz.ts`; register it in `src/app.ts`; test in
  `test/attest.test.ts`. Spec: TASK_PHASE_C.md §C1.

- [x] §C2 — `GET /metrics` in `src/routes/metrics.ts`, mirroring
  `src/routes/attest.ts`; register it in `src/app.ts`; test in
  `test/metrics-route.test.ts`. Spec: TASK_PHASE_C.md §C2.

- [x] §C3 — `src/routes/chat.ts` reports each attempt to `ctx.metrics` and
  `ctx.ledger`. New tests in `test/instrumentation.test.ts`; `chat.test.ts`
  and `failover.test.ts` stay green and unedited. Spec: TASK_PHASE_C.md §C3.

- [x] §C4 — Static bearer token auth in `src/auth.ts`, an `onRequest` hook
  registered in `src/app.ts`; `/healthz` and `/` stay open; test in
  `test/auth.test.ts`. Spec: TASK_PHASE_C.md §C4.

- [x] §C5 — `README.md`: fix the failover demo's YAML keys, document
  `/attest`, `/metrics`, the ledger and auth in Ops. Extra gate:
  `bash scripts/readme-lint.sh`. Spec: TASK_PHASE_C.md §C5.

- [x] §C6 — `bash verify.sh` green, then append the Phase C section to
  `STATUS.md` and set the ROADMAP.md rows and reservations listed in
  TASK_PHASE_C.md §C6. Gate: `bash verify.sh`.

## Phase D: SSE streaming pass-through — see TASK_PHASE_D.md

The engine (`src/stream.ts` with its 7 tests, the streaming mock upstream, the
`stream` field on `LedgerEvent`) is already committed — see "Already built" in
TASK_PHASE_D.md. Gate for every task below: `pnpm typecheck` + `pnpm test` +
`bash scripts/scrub-check.sh`, unless its section says otherwise.

- [x] §D1 — `src/routes/chat.ts` streams: drop the 501 block, pipe the upstream
  answer with `pipeSseResponse` from `../stream.ts` in the success branch, and
  rewrite the one 501 test in `test/chat.test.ts`. Spec: TASK_PHASE_D.md §D1.

- [x] §D2 — Streaming route tests in `test/streaming.test.ts`, mirroring
  `test/chat.test.ts`. Five assertions are listed in TASK_PHASE_D.md §D2.
  No production code in this task.

- [x] §D3 — Streaming failover tests in `test/streaming-failover.test.ts`,
  mirroring `test/failover.test.ts`. Four assertions are listed in
  TASK_PHASE_D.md §D3. No production code in this task.

- [x] §D4 — `README.md`: add a Streaming section with a `curl -N` example and
  the no-mid-stream-splice limitation; fix the stale Limitations clause. Extra
  gate: `bash scripts/readme-lint.sh`. Spec: TASK_PHASE_D.md §D4.

- [x] §D5 — `bash verify.sh` green, then append the Phase D section to
  `STATUS.md` and set the ROADMAP.md row and reservation listed in
  TASK_PHASE_D.md §D5. Gate: `bash verify.sh`.

## Phase E: the dashboard and the process log — see TASK_PHASE_E.md

The page (`src/dashboard.html`, `src/dashboard.ts` with its 11 tests, and the
`models` field on `/healthz` rows) is already committed — see "Already built"
in TASK_PHASE_E.md. Gate for every task below: `pnpm typecheck` + `pnpm test` +
`bash scripts/scrub-check.sh`, unless its section says otherwise.

- [x] §E1 — `GET /events` in `src/routes/events.ts`, mirroring
  `src/routes/attest.ts`; register it in `src/app.ts`; test in
  `test/events.test.ts`. Spec: TASK_PHASE_E.md §E1.

- [x] §E2 — `GET /` serves the dashboard from `src/routes/root.ts`, mirroring
  `src/routes/metrics.ts`; register it in `src/app.ts`; test in
  `test/root.test.ts`. Spec: TASK_PHASE_E.md §E2.

- [x] §E3 — Zero-external-request tests for the served page in
  `test/dashboard-egress.test.ts`, mirroring `test/root.test.ts`. Five
  assertions are listed in TASK_PHASE_E.md §E3. No production code.

- [x] §E4 — `README.md`: add a Dashboard section, a hero-screenshot note, and
  document `/events` in Ops. Extra gate: `bash scripts/readme-lint.sh`.
  Spec: TASK_PHASE_E.md §E4.

- [x] §E5 — `docs/PROCESS.md`: the loop story in one page plus a sanitized
  8-row excerpt of `loop-ledger.tsv`. Five parts are listed in
  TASK_PHASE_E.md §E5.

- [x] §E6 — `bash verify.sh` green, then append the Phase E section to
  `STATUS.md` and set the ROADMAP.md rows and reservations listed in
  TASK_PHASE_E.md §E6. Gate: `bash verify.sh`.
