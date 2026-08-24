# The Loop — How This Repo Was Built

## What This Is

This repo was built end-to-end by an autonomous coding loop against a fixed
spec. The commit history is part of the deliverable.

## Two Lanes

The **planning lane** (a large cloud model) reads `ROADMAP.md` and `STATUS.md`,
implements the engine of the next phase itself, commits it, then writes
`TASK_PHASE_<letter>.md` and the pointer lines in `TODO.md`.

The **execution lane** (a local 35B model with a 64k context window) takes the
first unchecked task in `TODO.md`, greps its phase-doc section, builds it, gates
it, ticks the box and commits — or writes `BLOCKED.md` and stops. One task per
session.

## The Context Budget

`TODO.md` is the only file the execution lane reads whole; every task must be
completable from its checkbox, its one phase-doc section, and the two or three
source files it names. A task that needs more than that is a planning failure,
not a model failure.

## The Gate

`verify.sh` — typecheck, tests, `scrub-check.sh` (public-repo discipline: no
private hostnames, no LAN IPs, no home paths, no keys) and the README-quickstart
lint. Red is not done; there is no partial credit.

## The Ledger

The ledger records one row per session. Columns: time (ISO-8601), lane
(`plan` or `loop`), model used, result (`commit` or other), total LLM turns,
output tokens consumed, tool calls made, source files edited, wall-clock
duration in seconds, and the task that ran.

### Sanitized Excerpt (last 8 sessions)

| time | lane | model | result | turns | task |
|---|---|---|---|---|---|
| 2026-08-23T22:06:48 | loop | qwen | commit | 86 | §D3 Streaming failover tests |
| 2026-08-23T22:08:59 | loop | qwen | commit | 78 | §D4 README streaming section |
| 2026-08-23T22:11:23 | loop | qwen | commit | 88 | §D5 verify.sh, STATUS.md update |
| 2026-08-23T22:23:04 | plan | claude | commit | 65 | plan next phase |
| 2026-08-23T22:28:12 | loop | qwen | commit | 69 | §E1 GET /events route |
| 2026-08-23T22:40:20 | loop | qwen | commit | 113 | §E2 GET / dashboard route |
| 2026-08-23T22:47:48 | loop | qwen | commit | 100 | §E3 zero-external-request tests |
| 2026-08-23T22:52:02 | loop | qwen | commit | 98 | §E4 README dashboard section |

## What the Shape Bought

Phases A through E, every SPEC.md feature gated at each phase end — typecheck,
tests, scrub-check, and verify all green before the planning lane advances.
The honest split is the key insight: the planning lane commits its own share of
engine code, so the `lane` column tells you which model wrote what.
