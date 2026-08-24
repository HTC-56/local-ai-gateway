# Roadmap — the v1 scoreboard

One row per SPEC.md feature. The planning lane keeps status current; row edits here
are the one permitted exception to append-only docs.

| # | Feature (SPEC.md) | Status | Phase | Note |
|---|---|---|---|---|
| 1 | One endpoint, many backends | SHIPPED | B | chat + models across N backends, with failover |
| 2 | Logical model routing | SHIPPED | A | config resolver + /v1/models |
| 3 | Health + failover | SHIPPED | B | probes, circuit + cooldown, priority-list failover |
| 4 | SSE streaming pass-through | NOT BUILT | — | returns 501 until its phase |
| 5 | Egress attestation | PARTIAL | A | allowlist, counters, refusal→ledger hook; /attest endpoint lands in C |
| 6 | Ops surface (/healthz, /metrics, ledger, auth) | PARTIAL | B | /healthz live; ledger + metrics engines in, routes and auth land in C |
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
