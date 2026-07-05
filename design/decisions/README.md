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

## Decisions still open (see PRD → Open Questions)

- **0001 — Engine language & runtime.** Deferred by design.
- **0002 — Content data format** (JSON vs YAML vs custom).
- ~~**0003 — Save format & versioning strategy.**~~ **Accepted 2026-07-05** — local-first,
  client-owned saves; T7 forward-only migration ladder; cloud sync deferred post-launch.
- **0004 — Platform priority** (web-first confirmed; bot/native ordering TBD).
