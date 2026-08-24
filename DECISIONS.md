# Decisions

## Locked (2026-08-23, at scaffold)

- **SPEC.md is the whole product.** v1 is the eight features there, fenced by
  its non-goals. The planning lane derives phases from SPEC.md only; it never
  invents features. When every SPEC.md feature is built and gated,
  "PROJECT SPEC COMPLETE" is the desired terminal state — declare it, do not
  find more work. This project is meant to FINISH.
- **Stack**: TypeScript + Fastify + Zod + Vitest, pnpm, no database. The
  dashboard is one hand-written self-contained HTML file — no UI framework,
  no build step, no external requests.
- **Gates**: `pnpm typecheck`, `pnpm test`, `bash scripts/scrub-check.sh` —
  all green at every phase end. `verify.sh` composes them plus the
  README-quickstart lint.
- **Public-repo discipline from commit 1**: this repo will be published. No
  private hostnames, no real LAN IPs (docs use `localhost` / `192.0.2.x`), no
  absolute home paths in docs or code, no key material, no references to
  other private projects — in files AND commit messages. `scrub-check.sh`
  enforces the file half; sessions carry the commit-message half.
- **Neutral git identity** until the publish decision (human-gated).

## Human-gated (never resolved by the loop)

- Publishing: remote creation, repo name confirmation, license choice
  (default intent: MIT), and the account/handle it lives under.
- Any scope beyond SPEC.md v1.

## Open Questions

*(none — SPEC.md answers v1 in full)*
