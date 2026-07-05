# Changelog

All notable changes to the Zurvival Reborn design and repository are recorded here.
The format is loosely based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Milestone

- **M0 — Foundation is COMPLETE.** The deterministic skeleton runs: a fixed 14-stage turn
  pipeline, seeded named-stream RNG, a content loader + schema gate, versioned lossless
  save/load, and a terminal harness that resolves an empty turn. Definition of done met —
  `applyAction(state, action)` runs the full pipeline deterministically (same seed + state =>
  byte-identical result), a save round-trips losslessly, and CI rejects malformed content.

### Added

- **Terminal harness — runs an empty turn (M0 · T9)** (`prototype/harness/`):
  `@zurvival/harness`, the first headless client of `@zurvival/engine`. `runEmptyTurn()`
  creates a run, resolves one turn through the pipeline, renders the `Scene`, and asserts the
  two M0 exit proofs — byte-identical determinism and a lossless save round-trip. Runnable via
  `npm start` (tsx); 5 Vitest + fast-check tests.
- **CI + content schema gate (M0 · T8)** (`.github/workflows/ci.yml`,
  `prototype/content-loader/src/validateCli.ts`): a merge-blocking gate that loads the whole
  `content/` tree through the loader and exits non-zero on any malformed file (bad JSON,
  schema violation, duplicate id, or a populated type with no schema). CI typechecks and tests
  every package, runs the harness empty-turn smoke check, and proves the gate rejects
  deliberately malformed content (FR-CNT-02 — volume can never corrupt a run).
- **Save / load — versioned lossless round-trip (M0 · T7)** (`prototype/engine/src/save/`):
  a `SaveFile` envelope (format + save-schema version + one-line "where you are" summary +
  state) with a migration-ladder hook (empty at v1) and `SaveError` on corrupt, foreign, or
  future-versioned blobs. `saveGame`/`loadGame` deep-equal round-trip including `rng`,
  `history`, and `queue`; pure, clock-free, and part of the dependency-free engine core. 10
  tests (QA TC-DET-05 / TC-DET-07).
- **Content loader + first schema (M0 · T6)** (`prototype/content-loader/`):
  `@zurvival/content-loader` — a separate Ajv-backed package (never imported by the
  dependency-free engine) that validates `content/` against JSON Schema (2020-12), indexes
  entries by id, and reports every issue together. First `region` schema + one throwaway test
  region. 9 tests.
- **Seeded RNG with named streams (M0 · T5)** (`prototype/engine/src/rng/`): `sfc32` seeded
  via `cyrb128`; each named stream (`loot`, `encounter`, `combat`, …) is a pure function of
  the run seed, serializes with GameState as plain-JSON uint32s, and advances via a pure
  functional draw API (`drawFloat`/`drawInt`/`drawPick`). 9 tests incl. determinism, stream
  independence, and save round-trip.
- **Turn pipeline shell — 14 no-op stages (M0 · T4)** (`prototype/engine/src/pipeline/`):
  `applyAction(state, action)` runs the fixed DESIGN §5 stage order as pure context
  transforms and returns `{ state, scene }`; a system lands by replacing one identity
  function. 7 tests incl. stage-order lock + property determinism.
- **First engine code — GameState shape (M0 · T3)** (`prototype/engine/`): `@zurvival/engine`
  package (pure, dependency-free, TS strict) with the full DESIGN §4 state shape in
  `src/state/types.ts`, `createInitialState()` factory, and Vitest + fast-check tests proving
  plain-JSON serializability, lossless round-trip, integer discipline, and
  `SAVE_SCHEMA_VERSION = 1` from the first format.
- **ADR-0002 — Content data format** (`design/decisions/0002-content-data-format.md`) —
  accepted 2026-07-05: JSON validated by JSON Schema (draft 2020-12) in `content/schemas/`,
  one entity per file, Ajv confined to the loader/CI (never the engine), ICU strings.
- **ADR-0001 — Engine language & runtime** (`design/decisions/0001-engine-language.md`) —
  accepted 2026-07-05: TypeScript, a pure dependency-free engine package, Node >= 22, tested
  with Vitest + fast-check. Retires the "undecided stack" stall risk.
- **Pre-production** — GDD, PRD, DESIGN, Production Plan, QA Plan, and the Ashfall & Ember
  visual design system + wireframe kit.
