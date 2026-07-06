# M2 Part 1 — implementation plan (T23–T27)

Working design note for the first block of M2 (Reactive world). M1 built a loop that *grips* — a
fog-of-war region graph, move/search/rest with time cost, avoidable combat, a finite loot economy,
survival pressure that bites turn to turn — and passed the Loop-Feel Check. M2's whole job is
different: **make the world move whether or not the player is watching.** Part 1 lays the foundation
and the first four systems that ride on it — the six-layer world simulation (T23), off-screen
regional drift (T24), the zombie state machine and first distinct types (T25), migrating hordes that
re-path to noise (T26), and weather with multi-system effects (T27).

Everything here obeys the standing engine discipline (ADR-0001): the engine stays pure,
deterministic, dependency-free, integer-only, plain-JSON, and save-round-trippable; all I/O lives in
the client. The single hard constraint the milestone adds is the one PRODUCTION §M2 names: **every
new system must keep `(state, action, seed)` reproducible** — the world may now move on its own, but
it must move the *same* way from the same seed. The Musts read in this block are FR-SIM-01, FR-SIM-03,
FR-SIM-07, FR-CBT-06, and FR-CBT-07 (FR-CBT-08 rides along with T26), plus the Should FR-SIM-05.

## Reconciling the two "six layers"

FR-SIM-01 names six **state** layers — player, companion, local, region, global, story (GDD Part IV,
Layers 1–6). Those already exist in `GameState` and have since T3. What the Must actually demands is
the second half of its sentence: they must be **independently updatable**. In M1 the world only moved
*because the player acted at a place*. M2 makes the world-side layers advance on their own clock.

The T23 note frames the same requirement in M2's operational terms — the world-sim **tick** layers
that have to become independently tickable are: **regions/nodes, hordes, zombies, weather,
time-of-day, and director.** These are not a different six; they are the *world half* of the state
layers (local + region + global), decomposed into the independently-schedulable systems M2 needs.
T23 builds the framework that holds all six; T24–T27 (and later T28/T30) fill four of them in.

## Build order

`T23 → T24 → T25 → T26 → T27` is also the clean dependency order. T23 is the substrate every other
task plugs into. T24 (regions) and T27 (weather) are pure state drift. T25 (zombies) and T26 (hordes)
are the two systems that read the T14 noise layer, and T25 lands first because a Screamer rousing its
neighbours and a horde re-pathing to a gunshot are the same "noise pulls the dead" idea at two scales
— getting the node-local machine right first keeps the horde layer simple.

| Task | Deliverable | Layer | New/expanded state | Retires |
|------|-------------|-------|--------------------|---------|
| T23 | Six-layer world-sim framework | engine `src/sim/worldSim.ts` | — (wiring only) | FR-SIM-01 |
| T24 | Off-screen regional drift | engine `src/sim/regionDrift.ts` | — (RegionState fields exist) | FR-SIM-03 |
| T25 | Zombie state machine + Screamer/Stalker | engine `src/sim/zombies.ts` + `content/zombies/` | `NodeState.zombieState`, `NodeState.zombieTypes` (**schema v3**) | FR-CBT-06, FR-CBT-07 |
| T26 | Migrating hordes re-path to noise | engine `src/sim/hordes.ts` | seeds `GameState.hordes` (shape exists) | FR-SIM-07, FR-CBT-08 |
| T27 | Weather with multi-system effects | engine `src/sim/weather.ts` | — (World.weather exists) | FR-SIM-05 |

Only T25 breaks the state shape, so the `SAVE_SCHEMA_VERSION` moves exactly once this block (2 → 3)
with one forward-only migration rung, per the T7 / ADR-0003 ladder.

## T23 — Six simulation layers updatable independently (FR-SIM-01)

**Idea.** Give the world a single, uniform way to tick that does not depend on a player action. Today
the world only advances as a side effect of `applyAction`: the loot contest and noise decay run
inside the pipeline's world stages, driven by the hours the *player's* action spent. T23 lifts that
into a first-class abstraction — a **world simulation** made of six named, independently-tickable
layers — so the same systems can be advanced by an arbitrary number of hours with **no player action
at all**. That is what "independently updatable" means operationally, and it is the substrate every
other M2 task plugs a real behaviour into.

**Where it lives.** New module `src/sim/worldSim.ts`. It defines:

- `SimContext` — everything a layer may read that isn't in `GameState`: the `hours` this tick spans
  and the transient region `graph` (present for a real run, absent off-screen or pre-content). RNG is
  *not* in the context — it flows through `GameState.rng` and each layer draws from its own named
  stream, so layers stay independent and reproducible.
- `SimLayer` — `{ id, tick(state, ctx) => state }`, a pure transform, exactly the pipeline-stage
  contract but named and addressable.
- `WORLD_SIM_LAYERS` — the six layers in canonical order: **regions, zombies, hordes, weather,
  timeOfDay, director**. For T23 five are structured no-ops (`identity`) and `regions` wraps the
  existing T17 loot contest, so behaviour is byte-identical to today; T24–T27 swap the no-ops for real
  systems without touching the wiring.
- `tickWorld(state, ctx)` — fold the layers in order. `advanceWorld(state, hours, graph?)` — the
  **off-screen driver**: decay node noise by the hours, then `tickWorld` for those hours. This is the
  function that proves the point: `advanceWorld(state, 24)` moves the world a day forward with no
  action submitted.

**Wiring (pipeline invariance preserved).** The fixed 14-stage names and order do **not** change — the
`pipeline.test.ts` order assertion stays green. Each world stage's *body* is re-pointed to call the
matching layer: stage 7 `updateRegion` → `regions` layer; stage 6 `updateNode` keeps the T14 noise
step and adds the `zombies` layer; stage 8 `updateWorld` → `weather` then `timeOfDay`; stage 9
`moveHordes` → `hordes`; stage 11 `tickDirector` → `director`. The canonical layer order equals the
pipeline order, so a pipeline turn's world effect and `advanceWorld` over the same hours run the same
layers in the same order — `advanceWorld` omits only the action's own stage-6 noise *deposit* and the
player stages, since off-screen there is no action.

**DoD.** `advanceWorld` advances the tracked world slices with no action, deterministically (same
seed + hours ⇒ byte-identical), and a state carried through it round-trips losslessly (T7). Each layer
is independently tickable — ticking one leaves the others' slices untouched (property test over the
no-op layers). The 14-stage order is unchanged and all M1 suites stay green (T23 adds structure, not
behaviour). The FR-CORE-04 no-op-turn audit is unaffected: a resolved player turn still moves a system.

## T24 — Off-screen regional drift (FR-SIM-03)

**Idea.** A region must get more dangerous (or quieter) while the player is elsewhere. Today
`RegionState.threat`/`zombieDensity` never move on their own; only `loot` falls, via the T17 contest.
T24 makes threat, density, and loot **evolve every tick from the region's own condition**, so leaving
Downtown to fester and coming back to a worse place is real, systemic state — not a scripted event.

**Where it lives.** New `src/sim/regionDrift.ts`, called by the `regions` layer *before* the existing
loot contest. No new stored state — `threat`, `zombieDensity`, `loot`, `fire`, `roads`,
`survivorActivity` all already exist on `RegionState` — so **no `SAVE_SCHEMA_VERSION` bump.**

**The drift (per elapsed hour, small integer steps, clamped 0–100).**

- **Zombie density** relaxes toward a region equilibrium set by its `threat` and `survivorActivity`
  (activity culls; threat breeds), so an untouched region trends to its natural carrying capacity
  rather than sitting frozen.
- **Threat** tracks density and local fire, and bleeds off slowly as the dead disperse — a spike from
  a horde or a fire decays over days, never instantly.
- **Loot** keeps falling via the T17 contest (unchanged); T24 only adds the threat/density half.

A tiny per-region jitter drawn from a named `region` RNG stream keeps two regions from moving in
lockstep, while staying fully reproducible. Drift is **monotone-bounded** — it can never push a value
outside 0–100 and can never manufacture an impossible state (the property T30's director will lean on).

**DoD.** A region's `threat` measurably changes across in-game days with the player never present
(the PRODUCTION §M2 exit line), proven by advancing a run and asserting the delta. Density converges
toward its equilibrium from both above and below. Deterministic, integer-only; a zero-hour tick is
inert (empty-turn contract holds).

## T25 — Zombie state machine + first distinct types (FR-CBT-06, FR-CBT-07)

**Idea.** The walkers loitering at a node (T15's `NodeState.walkers`) are currently inert until the
player arrives. FR-CBT-06 makes them **simulated agents with states** — dormant, wandering,
investigating, chasing, feeding, hibernating — that transition on **senses**: what they *hear* (the
T14 node noise), what they can *reach* (an adjacent noisy or bloody node), the *time of day*, and the
*scent* of a bleeding player. FR-CBT-07 adds the first two distinct **types** — the **Screamer**,
harmless alone but its shriek rouses the whole neighbourhood, and the **Stalker**, patient and
night-hunting — as content, so variety is data, not code (ADR-0002).

**Where it lives.** New `src/sim/zombies.ts` owns the machine; the `zombies` layer runs it each tick
inside stage 6 (node update), after noise. Two new fields on `NodeState`:

- `zombieState` — the aggregate behavioural state of the dead at this node (the six-state enum). One
  state per node rather than per-corpse keeps the sim phone-cheap (GDD perf note) while still giving
  the player a legible, systemic read ("the marina has woken up").
- `zombieTypes` — content ids of the special types present here (`[]` for a plain node), seeded from a
  new optional `NodeDef.zombieTypes`.

Both are additive state ⇒ **`SAVE_SCHEMA_VERSION` 2 → 3** with one forward-only rung `migrateV2toV3`
(every node gains `zombieState: "dormant"`, `zombieTypes: []`), mirroring the T15 v1→v2 rung.

**The machine (deterministic thresholds; a `zombie` stream only for wander tie-breaks).**

- **dormant → wandering** when ambient noise crosses a low bar; **wandering → investigating** on a
  louder, nearer stimulus; **investigating → chasing** when the player is here or adjacent and the node
  is loud; **chasing → feeding** when there are corpses/blood to settle on; quiet + time relaxes
  states back down toward **dormant**, and a long-quiet node **hibernates** (cheap, and a nice "you can
  let a place go cold" affordance).
- **Screamer**: on reaching investigating/chasing it **rouses neighbours** — deposits awareness/noise
  into adjacent nodes so the alarm cascades (needs the `graph`). This is FR-CBT-07's "calls others"
  made mechanical and is the node-scale twin of T26's noise re-pathing.
- **Stalker**: biases hard toward chasing during **night**, and barely stirs by day — the "hunts you
  at night" identity, keyed on `meta.phase`.

**Content.** New `content/zombies/zombie.screamer.json`, `zombie.stalker.json` (and `zombie.walker`
as the plain baseline) plus `content/schemas/zombie.schema.json` (id/name/description + behavioural
tags: `rousesNeighbours`, `nightHunter`, sense multipliers). The schema gate validates them; the
malformed-content rejection test still holds.

**DoD.** A node's `zombieState` advances under sustained noise and relaxes when it goes quiet, both
proven from seeded runs. A Screamer node rouses its discovered neighbours (their state/awareness
rises) where a plain node does not. A Stalker node reaches chasing at night from a stimulus that
leaves it dormant by day. The new zombie content passes the schema gate; deterministic and integer-only
throughout.

## T26 — Migrating hordes that re-path to noise (FR-SIM-07, FR-CBT-08)

**Idea.** Above the node-local machine sit **hordes** — moving masses with a size, position,
destination, speed, and awareness (`GameState.hordes`, shaped since T3 but never populated). FR-SIM-07:
a horde **evaluates noise** each tick and, if a loud node lies within its awareness, **re-paths**
toward it; otherwise it drifts along its migration. FR-CBT-08: a horde is something you **route around,
funnel, or flee**, never out-trade — so the systemic lever is the same gunshot the player already
understands, now pulling a mass across the map.

**Where it lives.** New `src/sim/hordes.ts`, run by the `hordes` layer (stage 9). It needs the region
`graph` to path over the node network, so it is active for a real run and inert off-screen without a
graph. A small starter set of hordes is seeded for Rivermouth at run start (engine constants, a bridge
until horde content lands — exactly as the T17 loot tables are today); the `hordes[]` shape already
serializes, so **no schema bump.**

**The behaviour.** Each tick, for every horde: find the loudest node within `awareness` hops of its
position; if that noise clears a re-path threshold, set it as the new `dest` (the gunshot redirect); then
step `pos` toward `dest` by `speed` along a graph shortest-path, decaying `awareness`/momentum as it
goes. Arrival deposits pressure (density/noise) and picks a fresh wander destination. All choices come
from a named `horde` stream so a seed reproduces the migration exactly.

**DoD.** A logged gunshot (the T15 `FIRE_NOISE` deposit) re-paths a nearby horde toward that node in
the target share of seeded cases (PRODUCTION §M2 exit line) — asserted as a rate over many seeds, not a
single run. A horde with no stimulus migrates deterministically. Hordes move over the graph without
ever entering an impossible node. Deterministic, integer-only; inert with no graph and on a zero-hour
tick.

## T27 — Weather with multi-system effects (FR-SIM-05)

**Idea.** Weather is a **mechanic, not a backdrop** (GDD Part IV). `World.weather` is a single content
id that has never changed. T27 makes it **transition over time** and, crucially, **touch multiple
systems at once**: rain quiets footsteps and cuts visibility but threatens power; fog helps stealth but
hurts navigation; a storm hides noise yet blocks roads and knocks the grid down; snow slows movement and
brings cold. One weather state, several systems moved — the multi-system coupling is the requirement.

**Where it lives.** New `src/sim/weather.ts`, run by the `weather` layer (stage 8). It owns a
`WEATHER_EFFECTS` table keyed by weather id (noise multiplier, stealth/detection modifier, road and
power pressure, movement cost modifier) and a deterministic transition model over the weather set
(clear · cloudy · rain · storm · fog · snow · wind), drawn from a named `weather` stream with sticky,
plausible transitions (clear tends to cloud before it storms). Effects are applied as small clamped
pressures on `World.powerGrid` and regional `roads`, and exposed as a pure `weatherEffects(id)` other
systems consult — the T15 stealth `detectChance` and the T14 noise model read the modifier, so weather
changes how loud you are and how easily you're seen. `World.weather` already exists ⇒ **no schema bump.**

**DoD.** Weather transitions across days from a seed, reproducibly, and never lands on an unknown id.
A wet/foggy state measurably lowers effective stealth-detection (or noise) versus clear, and a storm
applies road/power pressure — i.e. one weather change is observable in more than one system, the
FR-SIM-05 "multi-system" bar. Deterministic, integer-only; inert on a zero-hour tick.

## Test & CI posture

Unchanged standing gate: every increment keeps **engine + content-loader + harness** green plus the
content schema gate, run in full locally (the sandbox mount carries only partial deps, so packages are
installed and tested in a clean copy). Each task adds engine unit + property tests; T25 additionally
extends the schema gate over the new `content/zombies/` set and adds a v2→v3 save-migration test
(an old save loads forward with the new node fields defaulted). The T13 100-turn telemetry audit and
the zero-corruption save round-trip must stay green throughout — and now get a stronger workout, since
the world moves every turn. No client changes ship in Part 1; the Reactive-world systems are proven at
the engine layer first, and surfaced to the player in a later M2 block.
