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

### Decided

- **ADR-0003 — Save storage & versioning is ACCEPTED (M1 · T10)**
  (`design/decisions/0003-save-storage-versioning.md`): saves are **local-first and
  client-owned** — the dependency-free engine keeps doing zero I/O and only emits/consumes the
  T7 `SaveFile` string, which each client persists locally (harness/native → an atomically
  written file under the OS app-data dir; web → **IndexedDB**, not `localStorage`). Persistence
  is a **single rolling autosave slot per run**, written write-temp-then-atomic-rename with a
  retained `.bak`, so no crash can corrupt more than the most recent turn (zero-corruption
  target, NFR-SAVE-02). A save is exportable/importable as text so it doubles as a bug repro
  (DESIGN §9). Migration is the **T7 forward-only ladder** — one integer `SAVE_SCHEMA_VERSION`
  bumped only on a breaking state-shape change, one pure/total `N → N+1` rung per bump,
  newer-than-build refused. Optional cloud sync is deferred post-launch as an additive transport
  over the same string. Unblocks T11+ to autosave real runs toward the M1 lossless quit/resume
  gate.

### Added

- **Per-turn change telemetry — the FR-CORE-04 no-no-op-turn audit (M1 · T13)** (`prototype/engine/src/telemetry/turnAudit.ts`): the Definition-of-Done invariant of the core loop — **every resolved turn moves at least one real system** — is now proven by machine, not by hand. A new telemetry module diffs a turn's before/after `GameState` **by value** (`jsonEqual`, an honest plain-JSON deep-equal that doesn't mis-report a pure stage re-allocating an identical slice) and reports which slices changed (`diffSystems` → `auditTurn` returning `{turn, resolved, changedSystems, ok}`). The tracked systems deliberately **exclude `meta`**: counting the always-advancing clock/turn counter would make the invariant vacuously true, so the audit asks the harder question — did anything change *besides* time? `applyAction` is instrumented to return the `changed` systems on every `TurnResult` (empty for an inert `wait`, which resolves no turn). Pure, deterministic, dependency-free. **12 engine tests** (by-value comparison, `meta` exclusion, per-action change reporting, a fast-check property that every resolved turn over random play changes ≥ 1 system, and a hand-built clock-only turn proving the audit reports `ok: false`) plus a **harness 100-turn telemetry audit** over the shipped Rivermouth region — all 100 resolved turns changed ≥ 1 system, zero violations (PRD §6.1 acceptance criterion). Engine 79 + harness 11 tests green. Feeds T14 (noise as a per-turn node-memory change) and the T21 Loop-Feel gate.

- **Core action loop — move / search / rest with time cost (M1 · T12)** (`prototype/engine/src/time/`, `src/actions/`, `src/pipeline/`): the pipeline's player-facing stages are now real. A new **world clock** (`phaseOf` + `advanceClock`) turns each action's hour cost into advancing time — rolling hour → day → phase and ticking the turn counter — so **time always advances** (FR-CORE-03; move 2h, search 3h, rest 6h). `applyAction(state, action, graph?)` threads the transient region graph and wires the stages: **validate** rejects an action the current node didn't offer (`IllegalActionError`, FR-CORE-01), **resolvePlayerAction** applies the effect — move relocates + visits + lifts fog around the destination, search advances the node's `searchPct` (persistent node memory), rest recovers fatigue — **updatePlayer** drifts hunger / thirst / fatigue by the hours spent, and **generateScene** (`sceneOf`) renders the Four Questions (FR-CORE-05): where you are, what's happening, and what you can do as costed choices with hidden outcomes. The zero-cost `wait` stays inert, so every M0 skeleton test still passes unchanged. Pure, deterministic, integer-only, and **autosave-lossless after every turn** (FR-CORE-07). 14 new engine loop tests (clock, move/search/rest, validation, invariants) + 2 harness integration turns played over the shipped Rivermouth region. Unblocks T13 (per-turn change telemetry), T14 (noise), and T17 (loot yield on search).

- **Region & node graph with fog of war + node memory (M1 · T11)** (`prototype/engine/src/map/`, `content/nodes/`, `content/regions/region.rivermouth.json`): the first real region — **Rivermouth District**, six nodes wired into a ring so scouting the start reveals two neighbors and the rest stay fogged. The node graph is **content**: a new `node` schema + one file per node, with the engine's `buildRegionGraph` enforcing the cross-file integrity JSON Schema can't — symmetric routes, exactly one start node, full connectivity, and known region/node references — throwing `MapError` at run start otherwise. `NodeState` gains a `discovered` fog-of-war flag (FR-MAP-02); *visited* stays `lastVisit !== null`, so a node can be known-but-unentered. `discoverAround` reveals a node and its neighbors; `startRun` bootstraps a playable run — seeds live `regions`/`nodes` from content baselines, stands the player on the start node (visited today), and lifts the fog around them. Pure, dependency-free, integer-only, plain-JSON, deterministic, and save-round-trippable. 21 engine tests (integrity failures, reveal, seeding, a fog property) + 3 harness integration tests over the shipped content. Retires the throwaway `region.test-downtown`. FR-SIM-02, FR-MAP-01..03,06; unblocks T12 (move/search/rest over the graph).

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
  via `cyrb128`; each named stream (`loot`, `encounter`, `combat`, …) is a pure function