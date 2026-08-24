# Roadmap — the v1 scoreboard

One row per SPEC.md feature. The planning lane keeps status current; row edits here
are the one permitted exception to append-only docs.

| # | Feature (SPEC.md) | Status | Phase | Note |
|---|---|---|---|---|
| 1 | One endpoint, many backends | IN PROGRESS | A | routes + upstream proxy landing in Phase A |
| 2 | Logical model routing | IN PROGRESS | A | resolver shipped; /v1/models in §A6 |
| 3 | Health + failover | NOT BUILT | — | |
| 4 | SSE streaming pass-through | NOT BUILT | — | |
| 5 | Egress attestation | IN PROGRESS | A | boot allowlist + refusal counters shipped; /attest endpoint later |
| 6 | Ops surface (/healthz, /metrics, ledger, auth) | IN PROGRESS | A | /healthz shipped; metrics, auth, ledger later |
| 7 | Deploy-grade packaging (config, unit, README, CI) | IN PROGRESS | A | YAML config, systemd example, CI, gate scripts shipped; README in §A9 |
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
