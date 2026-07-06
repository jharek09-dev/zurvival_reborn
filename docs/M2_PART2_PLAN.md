# M2 Part 2 — implementation plan (T28–T32 + surfacing)

Working design note for the second block of M2 (Reactive world). Part 1 (T23–T27) built the
six-layer world-sim substrate and the first four systems that ride it — off-screen drift, the zombie
state machine, migrating hordes, and multi-system weather. It landed correct, deterministic, and
save-lossless, but the Part-1 QA review filed one High finding and three parking-lot items: the
reactive world is **computed but invisible in play** (H1 / PL-M2-01), off-screen drift **de-escalates**
the opening (PL-M2-03), and weather's `noiseFactor` / `advanceWorld` fast-forward are owed work
(PL-M2-04). Part 2 fills the two remaining world-sim layers (time-of-day, director), gives routes
conditions, records a Living History, lays a telemetry baseline, and — folded into the block — makes
the whole reactive world **perceivable** so the M2 "feels alive" fun-gate can finally be judged.

Everything obeys the standing engine discipline (ADR-0001): pure, deterministic, dependency-free,
integer-only, plain-JSON, save-round-trippable; all I/O lives in the client. The one hard M2 constraint
holds — every new system keeps `(state, action, seed)` reproducible. None of these five tasks needs a
new RNG stream: time-of-day, routes, the director, history, and telemetry are all **pure functions of
existing state** (the clock, weather, roads, region dials), so no existing stream's sequence shifts and
every Part-1 golden run stays byte-identical. The Musts read in this block are FR-SIM-04, FR-MAP-04,
FR-SIM-10, and FR-SIM-11, plus the PRD §4 telemetry proxies.

## The two remaining world-sim layers

`worldSim.ts` still carries `timeOfDay` and `director` as identity no-ops — the last two of the six.
T28 and T30 graduate them to real systems by swapping their `tick`, exactly as T24–T27 did for the
other four; the six ids and their pipeline-stage order never change (the `worldSim`/`pipeline` order
assertions stay green). Routes (T29) are **not** a seventh layer — they are a stage-8 world effect that
also runs off-screen, ticked right after weather (whose `movementDelta`/road pressure they consume), so
`tickWorld` still equals folding exactly the six layers by hand.

## Build order

`T28 → T29 → T30 → T31 → T32 → surfacing` is the clean dependency order. T28 lays the phase-danger read
model the director and surfacing lean on; T29 consumes weather's reserved `movementDelta`; T30 reads
T28's global tide and biases the region layers T24 laid down; T31 observes everything the turn did and
logs the notable; T32 measures the pacing T30 shapes; surfacing narrates all of it.

| Task | Deliverable | Layer / seam | New/expanded state | Retires |
|------|-------------|--------------|--------------------|---------|
| T28 | Time-of-day danger | `worldSim` **timeOfDay** layer + `src/sim/timeOfDay.ts` | — (drives `world.globalThreat`) | FR-SIM-04 |
| T29 | Route conditions | stage-8 world effect + `src/sim/routes.ts` | `GameState.routes` (**schema v4**) | FR-MAP-04 |
| T30 | Apocalypse Director | `worldSim` **director** layer + `src/sim/director.ts` | — (biases regions; `world.flags`) | FR-SIM-10 |
| T31 | Living History log | pipeline stage 13 + `advanceWorld` + `src/sim/history.ts` | — (`GameState.history` exists) | FR-SIM-11 |
| T32 | Telemetry baseline | `src/telemetry/pacing.ts` (client-driven) | — (out-of-state samples) | PRD §4 |
| — | Scene surfacing | `sceneOf` / harness renderer | — | PL-M2-01 / H1 |

Only T29 breaks the state shape, so `SAVE_SCHEMA_VERSION` moves exactly once this block (3 → 4) with
one forward-only, additive migration rung (`migrateV3toV4`, seeds `routes: {}`), per the ADR-0003 ladder.

## T28 — Time-of-day danger (FR-SIM-04)

**Idea.** The clock already rolls through five phases; T28 makes the phase *mean something for danger*.
`src/sim/timeOfDay.ts` owns one phase-danger model with three consumers, each a pure read so nothing
new is randomised:

- **Stealth detection** — `phaseDetectionDelta(phase)` (night +15, dawn/evening +5, else 0). The T15
  `detectChance` inline phase bonus is refactored to source these exact numbers, so combat/stealth
  golden behaviour is unchanged; the model just now has a name and a single owner.
- **Harder searches** — a night/low-light search is louder: the search choice deposits
  `NOISE_SEARCH + phaseSearchNoise(phase)` (night +12, evening +6, else 0) via the action's
  `params.noise` override, so the dead are likelier to hear you rummaging in the dark. This routes
  entirely through the existing T14 model — `noiseOf` is untouched (respecting the Part-1 note that its
  deposit tests are load-bearing).
- **Threat tide** — the **timeOfDay layer body** relaxes `world.globalThreat` toward a phase target
  (night 55, evening 40, dawn 30, morning 25, midday 15) at ~1 pt / 3 h, clamped 0–100. Danger *rises
  after dark and ebbs by day*, as real cyclic world state the director and the Scene both read. It is
  the layer's whole job, deterministic (phase is a pure function of the clock), inert on a zero-hour
  tick, and it moves nothing but `world`.

**DoD.** Night is measurably more dangerous than midday across detection, search noise, and the global
tide; determinism and save-losslessness hold; the `timeOfDay` layer is no longer a no-op.

## T29 — Route conditions (FR-MAP-04)

**Idea.** Edges between nodes stop being free and identical. Each undirected route carries an integer
`wear` (0–100) in a new `GameState.routes` slice, keyed by the sorted node-id pair. `wear` maps to a
condition — clear (`<25`) · costly (`<50`, +1 h) · flooded (`<80`, +2 h) · **blocked** (`≥80`, the route
is not offered). `src/sim/routes.ts` ticks every route toward a target `wear` derived from the world:
weather's reserved `movementDelta`, the endpoint regions' `roads` passability, and any `fire`. Wear
**rises fast** under a storm / iced roads and **recovers slowly** once it clears, so a flood persists —
hysteresis, not a light switch. Deterministic, integer-only, no RNG. Routes seed at `wear: 0` (clear),
so a fresh run and every Part-1 test see the M1 move cost of exactly `MOVE_COST`.

**Where it bites.** `availableActions` computes each move's cost as `MOVE_COST + extraCost(wear)` and
drops a blocked route from the offered set (availability change, per FR-MAP-04). A missing route entry
(an old save mid-run) reads as clear — a graceful, non-breaking default. Routes tick as a stage-8 world
effect just after weather, and again in `advanceWorld`, so they shift off-screen too.

**DoD.** A route's condition measurably worsens under sustained bad weather / low roads and eases when
it clears; move cost and availability follow; a blocked route is never the *only* thing a node offers
(rest/search remain). Schema `v3 → v4`; determinism + save-losslessness hold.

## T30 — Apocalypse Director (FR-SIM-10)

**Idea.** The director is a **bounded bang-bang pacing controller**, not an author. Each tick it reads a
pressure signal (T28's `world.globalThreat` blended with the player's current region threat) and the
player's distress (in combat, untreated wound, a critical need, symptomatic infection), then nudges the
current region's `zombieDensity`/`threat` **by one clamped point**:

- pressure **below** the low band and the player *not* distressed → **escalate** (the world festers
  while you coast — the direct answer to PL-M2-03, with T24 the neutral relaxation substrate beneath);
- pressure **above** the high band, or the player distressed → **relief** (ease off);
- in between → **hold**.

Because every nudge is a clamped ±1 toward a legal 0–100 value, the director **can never manufacture an
impossible state** — the invariant T24's design promised it would lean on. It is deterministic (no RNG)
and gated by `world.flags["director.disabled"]`: flip the flag and the nudges stop but the world still
runs on the drift substrate. Self-limiting by construction — escalation raises pressure out of the low
band, which stops the escalation, giving the spacing of pressure and relief the FR asks for.

**DoD.** Disabling the director changes the T32 pacing metrics over a seeded run (proven by the
telemetry harness) but **never** produces an out-of-bounds state; determinism preserved.

## T31 — Living History — append-only world log (FR-SIM-11)

**Idea.** `GameState.history` (the `HistoryEvent[]` that has existed since T3) starts recording. A single
observer, `src/sim/history.ts`, diffs the turn's *before* and *after* and emits the **notable** events —
a weather turn, nightfall, a horde stepping or re-pathing, a route changing condition, a walker put down
/ a fight cleared, the run ending — each stamped with `{day, hour, turn}` from the resolved clock, then
**appended, never rewritten**. It is deliberately *selective*: logging every turn would bloat the save
and make `history` a vacuously-always-changed system in the FR-CORE-04 audit, so the log records only
what a survivor would actually remember. Wired at pipeline stage 13 (`evaluateStory`, threading the
turn's opening snapshot) and inside `advanceWorld`, so off-screen fast-forwards leave a trace too.

**DoD.** Notable on- and off-screen events land in `history` in order; the log is append-only and never
mutated retroactively; save-lossless; deterministic. No schema bump (the field already exists).

## T32 — Telemetry instrumentation baseline (PRD §4)

**Idea.** `src/telemetry/pacing.ts` exposes `samplePacing(state)` — a pure, deterministic snapshot of the
pacing/pressure proxies (global threat, region threat/density, walker + horde load, combat/distress,
blocked routes, whether the director is on) — plus `summarizePacing(samples)` computing the pacing
**metrics** M5 will balance against and the T30 DoD leans on: mean/peak pressure, high-pressure and
relief turn counts, pressure/relief oscillations, longest calm streak. Capture is **client-driven**:
nothing in the pipeline records unless a client asks (so it is off by default in shipping builds), and a
seeded run yields identical samples every time. The block's proof of the T30 DoD is a telemetry harness
that runs the same seed director-on vs director-off and shows the metrics move while every sample stays
in-bounds.

**DoD.** Deterministic capture over a seeded run; off by default; metrics distinguish director-on from
director-off without either run ever leaving 0–100.

## Scene surfacing (addresses H1 / PL-M2-01)

A light pass so the reactive world reaches the player, all through the existing `sceneOf` narration and
the harness `describe*` seam (no new UI): an atmosphere line for phase + weather; a "what changed" read
when regional threat/density is rising; an approaching-horde threat lead; a roused/screaming node in
prose; and each move choice labelled with its route condition and any added cost. This is what lets the
M2 "the slice feels alive" verdict finally be taken — Part 1 held it precisely because the world was
silent.

## What this block deliberately defers

Weather's `noiseFactor` into the T14 deposit and the hour-by-hour `advanceWorld` fast-forward (PL-M2-04,
L1–L3) stay owed; coupling the T25 zombie **types** to combat (PL-M2-02) remains M2 follow-up work. This
block's job is the five named tasks plus making the world visible — not re-opening the Part-1 systems.
