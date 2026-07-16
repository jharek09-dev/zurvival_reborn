# Architecture Decision Records (ADRs)

An ADR captures one significant decision: the context, the choice, and the consequences.
They are short and append-only — supersede rather than rewrite.

## Format

Name files `NNNN-short-title.md` (e.g. `0001-engine-language.md`). Suggested template:

```
# NNNN — Title

- **Status:** proposed | accepted | superseded by ADR-XXXX
- **Date:** YYYY-MM-DD

## Context
What forces are at play? What problem are we deciding on?

## Decision
The choice we are making.

## Consequences
What becomes easier or harder as a result.
```

## Decisions log

- **0001 — Engine language & runtime.** Accepted 2026-07-05 — TypeScript; pure, dependency-free
  engine package; Node ≥22; Vitest + fast-check.
- **0002 — Content data format.** Accepted 2026-07-05 — JSON + JSON Schema (2020-12), one entity per
  file, Ajv in CI/loader only, ICU strings.
- **0003 — Save storage & versioning.** Accepted 2026-07-05 — local-first, client-owned saves; T7
  forward-only migration ladder; cloud sync deferred post-launch.
- **0004 — Platform ordering (native/Steam/bot).** Accepted 2026-07-16 (M4) — web-first ratified as
  the sole launch surface through beta and v1.0; the native/Steam/bot **ordering** is deferred to the
  v1.0 launch gate (T69) with a named trigger, to be logged as **ADR-0004a**.
- **0005 — Cross-run memory persistence.** Accepted 2026-07-16 (M4) — a bounded, local, per-profile
  **Chronicle** plus a capped set of light unlocks (no mechanical head-start); the deterministic
  source the M5 endings (T61/T62) read.
- **0006 — Licensing.** Accepted 2026-07-16 (M4) — the beta ships **all-rights-reserved**; the final
  license selection (open source / source-available / proprietary) is deferred to the coupled T58
  monetization decision with a named trigger, to be logged as **ADR-0006a**.

## Still open (PRD → Open Questions — not yet ADRs)

- **Monetization / business model** — premium / free+cosmetic / episodic. Deferred to **M5** (T58);
  carries the final license selection with it (ADR-0006 → **ADR-0006a**).
- **Numeric metric thresholds (§4)** — finalized after the closed-test telemetry baseline.
