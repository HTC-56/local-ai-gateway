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
