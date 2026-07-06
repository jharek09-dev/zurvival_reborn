# Zurvival Reborn — Technical Design

**Version:** 1.0 · **Status:** Pre-production · **Owner:** Jharek
**Reads with:** [`docs/specs/GDD.md`](docs/specs/GDD.md) (what & why) · [`docs/specs/PRD.md`](docs/specs/PRD.md) (what to build & when)

---

## 1. Purpose

The GDD describes the *game*; the PRD describes the *product plan*. This document describes
the *system* — how the software is shaped so it can deliver the GDD's simulation and satisfy
the PRD's requirements. It is **language-agnostic** on purpose: no runtime is chosen yet
(ADR-0001, see `design/decisions/`), and nothing here should assume one. It expands GDD
Part XIV into implementation-facing detail.

Audience: whoever builds the engine, authors content, or writes a client.

## 2. Design goals & constraints

These four constraints are load-bearing. Most decisions below fall out of them.

1. **Deterministic core.** `(state, action, seed) → (state', scene)` is a pure function.
   Same inputs, same outputs, every time. This is what makes the game testable, debuggable,
   save-able, and reproducible from a bug report. (GDD XIV · PRD TEC-01)
2. **Content is data.** Regions, nodes, items, weapons, survivors, zombies, encounters, and
   radio are external, schema-validated data — never hard-coded. A designer adds a location
   without touching the engine. (GDD XV · PRD TEC-02)
3. **Headless engine.** The core knows nothing about rendering. It emits a `Scene`; a client
   draws it. The same core can power a web app, a native app, or a chat bot. (PRD NFR-PLAT-02)
4. **Mobile-bounded performance.** The simulation is bookkeeping, not physics. Per-turn work
   is bounded to feel instant on a mid-range phone. (PRD NFR-PERF-01)

Non-goals for the core: no rendering, no I/O, no wall-clock time, no threads of its own, no
direct randomness outside the seeded RNG.

## 3. High-level architecture

Three layers, one direction of dependency. Content and clients depend on the engine; the
engine depends on neither.

```
┌─────────────────────────────────────────────────────────────┐
│  CLIENTS (renderers)                                         │
│  web UI · native app · Discord/Telegram bot                 │
│  - render Scene → collect the player's Choice               │
│  - never contain game logic                                 │
└───────────────▲─────────────────────────────┬───────────────┘
                │ Scene                        │ Action
┌───────────────┴─────────────────────────────▼───────────────┐
│  ENGINE CORE (pure, deterministic, headless)                │
│  applyAction(state, action) → { state', scene }             │
│  ├─ turn pipeline (fixed order)                             │
│  ├─ subsystems: time, world, actors, zombies, encounters,  │
│  │   combat, economy, shelter, story, director             │
│  ├─ requirements + effects (declarative content runtime)   │
│  ├─ seeded RNG · history log · query API                   │
│  └─ operates only on GameState                             │
└───────────────▲─────────────────────────────────────────────┘
                │ loads & validates
┌───────────────┴─────────────────────────────────────────────┐
│  CONTENT (data + schemas)  →  repo `content/`               │
│  regions · locations · items · weapons · npcs · zombies ·  │
│  encounters · radio · schemas                              │
└─────────────────────────────────────────────────────────────┘
```

## 4. The state model

A single, serializable **GameState** is the entire game. There is no state anywhere else. It
mirrors the six simulation layers of GDD Part IV. Illustrative shape (not a language, not
final — the schema of record lives in `content/schemas/` and the engine repo):

```
GameState {
  meta      { version, seed, createdAt, day, hour, phase }
  player    { condition, inventory[], equipment, skills, traits,
              location, shelterId, reputation, quests[], flags{} }
  world     { weather, season, powerGrid, water, military, broadcasts,
              globalThreat, knownSafeZones[], flags{} }
  regions   { [regionId]: { threat, zombieDensity, loot, survivorActivity,
                            power, water, fire, roads, storyFlags{} } }
  nodes     { [nodeId]: { regionId, searchPct, damage, corpses, blood,
                          barricades, traps, occupants[], discoveries[],
                          playerNotes[], lastVisit } }
  actors    { [actorId]: Survivor }        // companions + tracked NPCs
  groups    { [groupId]: SurvivorGroup }   // factions / rival groups
  hordes    [ { id, size, pos, dest, speed, awareness, types[] } ]
  items     { [itemId]: { type, quality, durability, metadata } }  // artifacts
  story     { progress, lore[], endingFlags{}, mysteries{} }
  history   [ Event... ]                    // append-only Living History
  queue     [ ScheduledEvent... ]           // future/timed events
  rng       { streamStates... }             // seeded, serialized with state
}
```

Key modeling rules:

- **Nodes remember.** Node state is never reset within a run (GDD VII). It is the backbone of
  "the world remembers."
- **Regions live on their own clock.** They evolve during the world-update stage whether or
  not the player is present (GDD IV).
- **Items can be artifacts.** Significant items carry `metadata` (provenance, history, prior
  owners) so identical items are not interchangeable (GDD V, Principle 6).
- **Infection/stress/morale are fields, never surfaced as numbers.** The client is not sent a
  bar; it is sent symptoms in the `Scene` (GDD VI · PRD FR-INJ-05).

## 5. The turn pipeline

Every turn runs the same fixed sequence (GDD IV). The order is invariant — it is what
guarantees reproducibility while still allowing emergence. Each stage is a pure transform of
GameState.

```
applyAction(state, action):
  1. validate(action) against the current Scene's offered choices
  2. advanceTime(action.timeCost)
  3. resolvePlayerAction  → effects (loot roll, move, attack, rest, craft…)
  4. updatePlayer         (needs, wounds, infection stage, stress/morale)
  5. updateCompanions     (their needs, AI intents, relationships)
  6. updateNode           (search %, damage, noise deposit, occupants)
  7. updateRegion         (threat/density/loot drift, infrastructure)
  8. updateWorld          (weather, season, grid, broadcasts, global threat)
  9. moveHordes           (evaluate noise, re-path, migrate)
 10. moveGroups           (off-screen survivor-group goals)
 11. tickDirector         (read tension/pacing → set biases; never forces)
 12. resolveQueue         (due scheduled/random events)
 13. evaluateStory        (requirements over world state → fire story events)
 14. generateScene        (systemic snapshot → next Scene)
  → return { state', scene }
```

Noise is deposited in stage 6 and consumed by stages 9–10, which is why a gunshot "this turn"
pulls a horde "next turn." The director (11) only adjusts probabilities used by 12–14.

## 6. Subsystem decomposition

Each subsystem is a module operating on a slice of GameState through small, testable
functions. They do not call each other ad hoc; they are sequenced by the pipeline.

| Subsystem | Responsibility | GDD |
| --- | --- | --- |
| **Time** | phases, time costs, scheduling | IV |
| **World** | weather, season, infrastructure decay, global threat, broadcasts | IV, XIII |
| **Region/Node** | per-region evolution; per-node memory | IV, VII |
| **Actors** | player + survivors: needs, wounds, infection, mind, relationships | V, VI, XII |
| **Zombies/Hordes** | zombie state machines, senses, horde movement/migration | IX |
| **Encounters** | pool filter → weight → cooldown → select → resolve | VIII |
| **Combat** | exchange resolution, stealth/detection, fear/panic, Last Stand | IX |
| **Economy** | loot tables, search, inventory, crafting, spoilage, trade | X |
| **Shelter** | rooms, jobs, daily report, night-attack resolution | XI |
| **Story/Radio** | condition-gated story events, radio network, endings | XIII |
| **Director** | pacing meta-controller; biases, never forces | IV, XVI |

## 7. Requirements & Effects (the content runtime)

Two tiny, general systems keep content declarative and let the engine stay closed to content
churn.

- **Requirements** — a predicate over GameState. Content (an encounter, a story beat, a
  dialogue option) lists what must be true to be eligible. Example, as data:

  ```
  requires: [ "infection.stage >= symptomatic",
              "region.downtown.threat > 0.8",
              "flag.met_sarah == true" ]
  ```

- **Effects** — a declarative change to GameState, applied uniformly and logged. Example:

  ```
  effects: [ { op: "adjust", path: "player.stress", by: +10 },
             { op: "set",    path: "flag.pharmacy_alarm", to: true },
             { op: "spawnHorde", region: "downtown", size: "medium" } ]
  ```

Because eligibility and consequences are data, most content ships without engine changes
(PRD FR-CNT-03). The "flag philosophy": prefer meaningful world state (a region's threat, a
node's damage) over a sprawl of ad-hoc booleans; reserve flags for genuinely discrete facts.

## 8. Content pipeline

```
author (content/*.json|yaml)
   → validate against content/schemas/*  (CI gate: malformed content fails the build)
   → load & index at engine init (build content registries)
   → reference by id from GameState at runtime (never embed content in state)
```

Rules: one entity per file; schema before scale; every entry passes the five-question test
(GDD XV / `CONTRIBUTING.md`). Content is versioned alongside the save schema (§9).

## 9. Determinism, RNG & saves

- **RNG.** All randomness derives from `meta.seed` via named streams (e.g. `loot`,
  `encounter`, `combat`) whose states serialize with GameState. No use of wall-clock or global
  RNG anywhere in the core. Replaying the same actions on the same seed reproduces the run.
- **Saves = snapshots.** Because the whole game is one serializable GameState, saving is
  serializing it. Autosave occurs at turn boundaries (PRD FR-CORE-07); a save is safe to stop
  on. Save carries `meta.version` + a one-line "where you are" summary.
- **Migration.** A documented migration path upgrades old saves as the schema evolves; no
  silent corruption (PRD NFR-SAVE-02). Save-schema version and content version are checked on
  load.

## 10. Engine ↔ client contract

The client boundary is deliberately tiny:

```
type Scene = {
  context:   { where, day, hour, phase, weather },   // for the header
  status:    { visibleStats },                       // critical stats only; no infection bar
  text:      string[],                               // the prose (the star)
  choices:   Choice[],                               // each with known costs, hidden outcome
  ambience?: { audioCues, tone }                     // hints for the adaptive mix
}
type Choice = { id, label, knownCosts, microChoice?: bool }
type Action = { choiceId, params? }
```

Contract rules: the client renders `Scene` and returns an `Action`; it holds **no** game
logic, derives everything from `Scene`, and never sees raw hidden state (infection number,
loot rolls, director biases). This keeps a chat-bot client as viable as a rich web UI
(GDD XVII · PRD NFR-PLAT-02).

## 11. Testing strategy

- **Determinism tests** (core): `(state, action, seed)` reproduces byte-identical `state'`;
  guards the whole architecture. (PRD NFR-REL-01)
- **Unit tests**: each subsystem's transforms; each `effect` op; representative `requirements`.
- **Content validation** in CI: every content file against its schema; a malformed encounter
  fails the build, never the player's run. (PRD FR-CNT-02)
- **Property tests**: invariants that must always hold (no negative inventory, node memory
  never resets mid-run, every resolved turn changes ≥ 1 system — PRD FR-CORE-04).
- **Golden-run tests**: a fixed seed + scripted actions produce an expected run summary;
  detects unintended balance/logic drift.
- **Integration**: full turn + save/load round-trip equality.
- **Playtest instrumentation**: telemetry against PRD §4 targets (run length, death causes,
  "last can" occurrence, encounter-repeat rate).

## 12. Performance

- Per-tick work is bounded; region/horde updates are O(regions)/O(hordes) with small
  constants and, where needed, amortized across ticks so no single turn spikes
  (PRD NFR-PERF-02).
- Content registries are built once at init and referenced by id; GameState stores ids, not
  copies.
- Target: turn resolve + render < 100 ms on a mid-range 2022 phone (PRD NFR-PERF-01).

## 13. Repository mapping

| Path | Holds | This doc |
| --- | --- | --- |
| `docs/specs/GDD.md` | creative & systemic vision | source for §4–§7 semantics |
| `docs/specs/PRD.md` | prioritized requirements | traceability for every constraint |
| `content/` | schema-validated game data | §7, §8 |
| `content/schemas/` | validation schemas | §8, §9 |
| `design/decisions/` | ADRs (open technical decisions) | §14 |
| `design/diagrams/` | pipeline & architecture diagrams | §3, §5 |
| `prototype/` | future engine code (empty until ADR-0001) | §2–§12 |

## 14. Open technical decisions

Tracked as ADRs in `design/decisions/`; mirrors PRD §15.

1. **ADR-0001 — Engine language & runtime.** *Blocking* for `prototype/`. Criteria: strong
   web-deploy story, first-class testing of a deterministic core, viable shared core across
   web + bot.
2. **ADR-0002 — Content data format.** JSON vs YAML vs a custom authoring format (affects
   tooling and modding).
3. **ADR-0003 — Save storage & versioning.** Local vs optional cloud sync; migration policy.
4. **ADR-0004 — Platform ordering.** Web-first is set; native/Steam/bot order is open.

## 15. Glossary

- **GameState** — the single serializable object that is the entire game.
- **Scene** — the systemic snapshot the engine emits for the client to render.
- **Effect / Requirement** — declarative change / declarative precondition used by content.
- **Director** — the pacing meta-controller that biases probabilities without breaking logic.
- **Living History** — the append-only log of significant events, queryable across a run and
  between runs.
- **Artifact** — a significant item carrying provenance/history metadata.
