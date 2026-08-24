# Roadmap — the v1 scoreboard

One row per SPEC.md feature. The planning lane keeps status current; row edits here
are the one permitted exception to append-only docs.

| # | Feature (SPEC.md) | Status | Phase | Note |
|---|---|---|---|---|
| 1 | One endpoint, many backends | SHIPPED | B | chat + models across N backends, with failover |
| 2 | Logical model routing | SHIPPED | A | config resolver + /v1/models |
| 3 | Health + failover | SHIPPED | B | probes, circuit + cooldown, priority-list failover |
| 4 | SSE streaming pass-through | IN FLIGHT | D | engine `src/stream.ts` shipped; route, tests and docs are Phase D tasks |
| 5 | Egress attestation | SHIPPED | C | allowlist, counters, /attest; refusal path proven in tests |
| 6 | Ops surface (/healthz, /metrics, ledger, auth) | SHIPPED | C | /healthz, /metrics, /attest, bearer auth, JSONL ledger |
| 7 | Deploy-grade packaging (config, unit, README, CI) | PARTIAL | B | config, unit, CI, README + failover demo, smoke script; hero screenshot waits on the dashboard |
| 8 | Dashboard | NOT BUILT | — | |
| — | docs/PROCESS.md (the loop story) | NOT BUILT | — | written near the end, when there is a ledger to excerpt |

When every row reads SHIPPED and verify.sh is green, the project is done — the
planning lane declares PROJECT SPEC COMPLETE rather than inventing scope.

## Reservations ledger — small deferred calls recorded inside phase specs

- **Process-wide egress interception** — deferred. v1 proves the no-egress
  property at the single door the gateway uses (`ctx.egress.fetch`); a global
  undici dispatcher was considered and not taken.
  Home: TASK_PHASE_A.md, "Reservations recorded in Phase A".
- **Streaming answers 501, not 400** — a `stream: true` request is valid but
  unserved until the SSE phase. Home: TASK_PHASE_A.md §A8.
- **Failover is not in the chat route yet** — Phase A uses the first resolved
  target only; walking the priority list belongs to the health/failover phase.
  Home: TASK_PHASE_A.md §A8.
- **No runtime way to make the gateway phone home.** `/attest` reports a
  refusal counter, but v1 ships no switch that asks the gateway to reach a
  non-upstream host, so a stranger sees the counter at 0 and the proof of the
  refusal path in `pnpm test`. Home: TASK_PHASE_C.md §C5.
- **`/healthz` and `/` are unauthenticated.** A liveness probe must work
  without a secret, and the dashboard page carries none — it will ask the
  operator for the token and send it on its own polls. Home: TASK_PHASE_C.md §C4.
- **The ledger's only body-derived field is `detail`.** Bodies are never
  written; `ledger.redact` drops the summary too. Home: TASK_PHASE_C.md §C3.
