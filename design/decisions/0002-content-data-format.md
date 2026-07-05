# 0002 — Content data format

- **Status:** accepted
- **Date:** 2026-07-05 (accepted 2026-07-05 by Jharek)

## Context

All game data — regions, locations, items, weapons, NPCs, zombies, encounters, radio — lives
in `content/` as data, not code (GDD Part XIV; `content/README.md`). The format decision
blocks content authoring tooling, the M0 content loader + schemas (T6), and the CI schema
gate (T8). Selection criteria drawn from existing commitments:

1. **First-class runtime validation.** Malformed content must fail the build (FR-CNT-02);
   ADR-0001 already requires runtime schema validation at content load, and the engine is a
   **dependency-free** TS package — the format must parse without adding engine dependencies.
2. **AI-at-volume authoring with cheap review.** M4's content pour is AI-generated behind a
   review-capacity cap (PRODUCTION §2); the format must be trivially machine-generated,
   machine-validated, and diff-clean (one entity per file).
3. **Localization-ready.** Carries ICU MessageFormat strings and stable keys across locales
   (LOCALIZATION §13 — "both JSON and YAML carry ICU fine; decide once").
4. **Modding-friendly** (PRD §15) — a widely known format with off-the-shelf editor support.

## Options considered

**JSON + JSON Schema (recommended).** Parses with built-in `JSON.parse` — zero engine
dependencies, satisfying criterion 1 by construction. JSON Schema lives in
`content/schemas/` as data, validated in CI with Ajv (a *tooling* dependency, not an engine
one) and at load with the same schemas. Unambiguous grammar — no implicit-typing surprises —
which matters when AI generates thousands of files that humans skim rather than read
(criterion 2). Native to every editor, formatter, and mod tool (criterion 4). Weaknesses:
no comments and some verbosity. Mitigations: one entity per file keeps files small; schemas
allow an explicit `"notes"` field anywhere authors would want a comment, which also survives
round-trips through tooling (comments don't).

**YAML.** More pleasant to hand-write: comments, less punctuation, multiline strings. But:
requires a parser dependency; the implicit-typing footguns (`no` → false, `1.10` → 1.1,
accidental octal) are exactly the class of silent corruption the CI gate exists to prevent;
indentation-significant syntax is a worse target for AI generation at volume; and YAML's
spec surface (anchors, merge keys, multiple documents) invites cleverness that fights
"content is data." Whitespace diffs are noisier under merge.

**Custom authoring DSL.** Maximum authoring ergonomics in theory; in practice a solo dev
would own a parser, a validator, an editor mode, and documentation for it — pure tooling
cost that competes with making the game, and it kills criterion 4 (modders would learn a
one-off format). If authoring ergonomics ever become a real pain, a converter that emits
JSON is a later, cheap, non-blocking addition.

**TOML / JSON5 / JSONC (briefly).** TOML handles nesting poorly for entity trees. JSON5/JSONC
add comments but need a parser dependency and lose "every tool on earth reads it" — the small
ergonomic win doesn't justify forking from standard JSON.

## Decision

**JSON**, validated by **JSON Schema** (draft 2020-12) stored in `content/schemas/`, one
schema per content type, one entity per file. Ajv performs validation in CI (T8) and in the
content loader (T6) — Ajv is a tooling/loader dependency; the engine core itself only ever
receives already-validated plain objects. Translatable fields hold ICU MessageFormat strings
keyed per LOCALIZATION §13. Authors use `"notes"` fields for commentary.

## Consequences

Easier: loader is `JSON.parse` + schema check, no parse ambiguity ever; the same schema files
drive CI, load-time validation, editor autocomplete (`$schema` in each file), and future mod
tooling; AI content generation targets the most reliably machine-written format there is.

Harder: no comments (use `"notes"`); hand-authoring is slightly noisier than YAML — accepted,
because at M4 scale most content is machine-written and human-*reviewed*, and review favors
explicitness over brevity.

If accepted: unblocks T6 (content loader + first schemas) and T8 (CI schema gate); the
localization key format is fixed as JSON per LOCALIZATION §13. If vetoed: re-run against the
same four criteria within the M0 time-box.
