# M4 Part 8 — Shelter depth: jobs & craftable rooms (T52 · "the base runs while you're gone")

**Milestone:** M4 (Content-complete city) · **Task:** T52 · **Requirements:** FR-SHL-03 (assignable jobs
that run while the player is away, producing/consuming the shared stash — *Should*, MVP) and FR-SHL-04
(craftable rooms that unlock capability — *Should*, MVP). GDD **Part XI** ("Shelter, Rooms & Jobs" — the
base as a second loop: residents cooking, foraging, building; rooms that unlock what the base *can do*).
**Depends on:** T37/T38 (`Player.shelterId` + `NodeState.barricades` — the claimed base and its upkeep
pressure), T39 (`player.stash` — the shared store jobs draw from and bank into), T45 (companion standing
orders as **flags on the `Survivor`** — the idiom job-assignment copies, so no save rung; and
`tickCompanions`, the stage-5 people tick this hooks beside), T51 (`NodeState.rooms` + the shelter
recipe's `installsRoom` — rooms are already *built by* a recipe; T52 gives four more rooms and makes each
room *do* something; also `world.powerGrid`/`economy.freshness`, the fridge/generator couplings), T23
(`advanceWorld` — the off-screen driver that finally runs the shelter while you're away), T47/T50/T51 (the
content-pool-on-the-`RegionGraph` idiom + the four-part `Choices/isAction/resolve/Line` seam this copies),
T5 (named-stream RNG — **none is added**; every job is a deterministic conversion).

## What FR-SHL-03/04 ask for, and the parking-lot debt they clear

Until now the base is a *sink*: you claim it (T37), fortify it (T38), and bank surplus in its stash (T39),
but it produces nothing and, left alone, is no weaker for it. Keeping people is a *pack* drain — a
companion's needs are relieved only by your give-food from a finite pack (PL-M3-01). And a base abandoned
for days doesn't decay off-screen (PL-M3-05). T52 turns the base into a **second loop that runs on its
own**:

- **FR-SHL-03 — assignable jobs.** Assign a companion to a room's job — garden, kitchen, salvage,
  infirmary, watch, generator — and it **produces or consumes the shared stash over time**, on your turns
  *and while you are away*. The base can now feed itself (closes **PL-M3-01**), and off-screen shelter
  upkeep — barricades decaying, jobs running — lands here (closes **PL-M3-05**, and the off-screen
  companion-order half of **PL-M4-08**).
- **FR-SHL-04 — craftable rooms that unlock capability.** T51 shipped two rooms (workshop, medical) that
  gate *crafting*. T52 ships the rest of the GDD-XI set as **craftable rooms that each unlock a real
  capability**: a job (garden/kitchen/watch/generator), a passive (the radio room lets you broadcast
  without lighting up your own node — **PL-M4-25**), or the fridge (the kitchen keeps the base's fresh
  food from spoiling — **PL-M4-29**), with a **fuel-burning generator that holds `powerGrid` up**
  (**PL-M4-29**).

"Deterministic, save-lossless" (the task's acceptance line) is the spine: every job debits/credits a real
resource, nothing here reads a clock or a global RNG, and — the load-bearing guarantee — **the whole
system is dark without a job pool, so every prior run is byte-identical.**

## The one system: shelter operations, content-driven, room-gated

Rather than bolt on a base-management screen, T52 ships **one content-driven jobs system** (`sim/jobs.ts`)
whose pool rides the transient `RegionGraph` (`graph.jobs`, mirroring `graph.recipes`/`graph.signals`), so
a graph built without it leaves the whole thing inert — no job choices, no production tick, no off-screen
upkeep, no feeding — and **every prior run byte-identical** (golden generators never register a job pool).
One new content type **`content/jobs/`** + **`content/schemas/job.schema.json`** takes the schema gate
**11 → 12 types**.

A `JobDef` carries: `id` (`job.<slug>`), `label` (the assignment row), `worldEffect` (prose — "Rooftop
beds give up a little fresh food"; never a stat), a required `room` (the **capability gate** — a job runs
only where its room is built, which *is* FR-SHL-04), an optional `consumes` (`{item, qty}` drawn from the
stash per cycle), an optional `produces` (`{item, qty}` banked into the stash per cycle), an optional
`holdsPower` flag (the generator: burns its `consumes` fuel to raise `world.powerGrid` instead of banking
an item), and `hoursPerCycle` (how long one cycle of work takes — the first-pass dial, M5 balance). Rooms
are `ContentId` strings threaded through recipes (`installsRoom`, from T51) and jobs (`room`), not a
separate content folder — the same collapse T51 used for "gated by the right room."

## Assignment lives on the companion — **no save-schema rung** (stays v10)

The one genuinely new persistent fact — *which companion works which job* — is stored the **T45 way**: a
`job:<jobId>` flag on the `Survivor`, exactly as standing orders are `order:hold` flags. So, like T45 and
T50, **T52 takes no save-schema rung** (`SAVE_SCHEMA_VERSION` stays 10) and touches no migration code:

- A worker is a companion at the shelter carrying a `job:<jobId>` flag. Assigning sets the flag, forces
  their order to `hold` (a worker stays at their post), and stands them at the base. Re-ordering them
  (follow/hold/scavenge/guard) clears the job flag — one small, safe edit to T45's `withOrder`, a no-op on
  every prior run (no companion has a job flag).
- Everything a job *moves* rides shapes that already exist: `player.stash` (produce/consume),
  `world.powerGrid` (generator), `NodeState.barricades` (watch upkeep), companion `needs` (the base feeds
  them). Rooms already persist in `NodeState.rooms` (v10). Stash spoilage is **rate-based** (no per-stack
  clock, no new field). So there is no new state to migrate — a pre-T52 save (companions with no job flag)
  is forward-compatible by construction.

This is the safest possible shape: no reshape, no rung, save-lossless by inspection (flags and stash are
already round-tripped), and auto-pruning (a worker who dies takes their flag with them).

## The seam — `jobChoices` / `isJobAction` / `resolveJobAction` / `jobLine`

Mirrors `economyChoices` exactly, wired into the same sites in `coreActions.ts`. Every choice is gated on a
predicate **false in every prior golden run** (no job pool ⇒ `jobsActive(graph)` false), so the
available-action list is byte-identical unless you're standing in your own shelter with a companion and the
right room:

- **`assign-job:<companionId>:<jobId>`** (0h, base management like orders/stash) — offered per companion
  present at the shelter × job whose `room` is built and who isn't already on it. Resolve: set the
  `job:<jobId>` flag, force order `hold`, locate them at the base.
- **`clear-job:<companionId>`** (0h) — take a worker off duty (clears the flag). Re-ordering them does the
  same, for legibility.
- `jobLine(state, graph)` contributes to `sceneOf` narration **only on a shelter-ops turn** (an
  `job.assigned` / `job.cleared` / `shelter.produced` / `food.spoiled-stash` beat exists for this turn —
  the same this-turn tail-scan `radioLine`/`economyLine` use), so the base report never clutters an
  ordinary scene. All words; the "daily report" is prose ("The garden gave up fresh food; the workshop, a
  little scrap"), no numbers (FR-UI-02 / NFR-ACC-01).

## The tick — `tickShelterOps`, one transform run on-turn **and** off-screen

The heart of "the base runs while you're gone" is a single pure `tickShelterOps(state, graph, hours)`
called from **both** the pipeline (stage 5, `updateCompanions`, right after `tickCompanions`) and
`advanceWorld` (off-screen) — so a played hour and a fast-forwarded hour do the same thing (the
`advanceWorld == pipeline world-stages` discipline, extended to the base). Gated `if
(!jobsActive(graph)) return state;` and inert on a zero-hour tick, so it graduates stage 5's body exactly
as T51 graduated stage 4's — the stage name and the invariant 14-stage order never move, and every prior
run is untouched. Each cycle (`trunc(hours / job.hoursPerCycle)`, the scavenge idiom):

- **Jobs produce/consume the stash.** For each companion at the shelter with a `job:<jobId>` flag whose
  `room` is present: debit `consumes` from the stash (skip the cycle if it's short — a job with no inputs
  stalls, never goes negative), credit `produces` to the stash. The **generator** (`holdsPower`) instead
  burns its fuel to raise `powerGrid` toward full — the power loop's base sink, and it keeps the fridge
  cold and the T51 carried-food clock at its slow rate.
- **The base feeds its residents (PL-M3-01).** For each resident companion whose hunger/thirst is
  pressing, draw a food/water unit from the stash and relieve them — so a stocked base keeps people alive
  without touching your pack. Deterministic (neediest-first, stable id order); inert on an empty stash.
- **The fridge (PL-M4-29).** Stash `item.food-fresh` spoils to `item.food-spoiled` at a rate **only** when
  the grid is failing (`powerGrid < POWER_SPOIL_AT`, the T51 signal) **and** neither a kitchen (the fridge)
  nor a running generator is keeping it cold — so the kitchen and the generator each *earn their keep* by
  preserving the base's food.

Off-screen only, `advanceWorld` also lands the deferred **barricade decay (PL-M3-05)** — the shelter's
`barricades` erode with the idle hours (the stage-6 upkeep the off-screen path skipped), **halved when a
watchtower stands** (the lookout keeps it up) and offset by a `watch` job. Both are gated on
`jobsActive`, so the existing off-screen suites (worldSim/regionDrift/director/history/routes/pacing, all
pool-free) stay byte-identical.

## Rooms & their capabilities (FR-SHL-04)

| Room | Built by (recipe) | Capability |
| --- | --- | --- |
| workshop *(T51)* | `recipe.shelter.workshop` | crafting/repair (T51) **+** unlocks `job.salvage` (a resident strips the ruins for scrap) |
| medical *(T51)* | `recipe.shelter.medical-bay` | medical crafting (T51) **+** unlocks `job.infirmary` (cloth → bandages) |
| **garden** | `recipe.shelter.garden` | unlocks `job.garden` (grows `item.food-fresh` into the stash) |
| **kitchen** | `recipe.shelter.kitchen` | unlocks `job.kitchen` (fresh → canned, preserving) **+ the fridge** (stash fresh food doesn't spoil while it stands) |
| **watchtower** | `recipe.shelter.watchtower` | halves off-screen barricade decay (a lookout) **+** unlocks `job.watch` (a resident keeps the barricades up) |
| **generator** | `recipe.shelter.generator` | unlocks `job.generator` (burns `item.fuel` to hold `powerGrid` up) |
| **radio** | `recipe.shelter.radio-room` | **passive:** broadcasting from the shelter no longer lights up your own node (PL-M4-25) — a gated one-line change in `radio.ts`, inert without the room |

Five new shelter recipes (garden/kitchen/watchtower/generator/radio) reuse T51's `recipe.schema.json`
(`installsRoom`) — **no new content type for rooms**. Six jobs across the room set demonstrate every job
shape (produce-only, consume→produce, hold-power, upkeep).

## Determinism, RNG, and byte-identity (the discipline)

- **No new RNG stream, no loot-table mutation.** Jobs are pure deterministic conversions moving *existing*
  items (`food-fresh`/`canned-food`/`water`/`scrap`/`cloth`/`bandage`/`fuel`) between the stash and the
  world — **no new lootable item, so the shared `LOOT_TABLES` are untouched** and the
  [[zurvival-byte-identity-loot-hazard]] `floor(f·len)` risk is avoided by construction (the one hazard
  class T50/T51 had to gate, T52 simply doesn't create).
- **Every passive world mutation is gated on the active-system flag**, per the byte-identity rule: the
  generator writing `powerGrid`, the fridge spoiling stash food, and off-screen barricade decay all sit
  behind `jobsActive(graph)` — dark on every pool-free run.
- **The whole system is dark without a job pool.** `jobsActive(graph) = jobPool(graph).length > 0`. Golden
  generators (`playSlice`) register no jobs, so: no job choices, no production tick, no feeding, no
  off-screen upkeep, no scene lines — and no save shape change at all (flags are additive). The 497/9/99
  stay green.
- **Save-lossless across every new path** (`load(save(state))` deep-equal after an assign, a produced
  cycle, a fed resident, a spoiled stash stack, a generator burn).

## Test plan

- **Engine** (`sim/jobs.test.ts`): the generic interpreter over shipped-shaped jobs — a garden banks fresh
  food into the stash per cycle; a kitchen consumes fresh and banks canned; a job short of its input
  stalls (no negative stash); the generator burns fuel and raises `powerGrid`; a job runs only where its
  `room` is built and its worker is a present companion. Feeding: a hungry resident is fed from the stash
  and relieved; an empty stash feeds no one. Fridge: stash fresh food spoils only when the grid is down
  **and** no kitchen/generator; a kitchen or a fueled generator preserves it. Off-screen (`advanceWorld`):
  a day away runs the jobs, decays the barricades (halved under a watchtower), and feeds the residents.
  **Inertness (the key guarantee):** with no job pool, `jobChoices` is empty, `tickShelterOps` a no-op,
  `advanceWorld` unchanged, and a scripted run byte-identical to the pre-jobs engine. Determinism +
  save-losslessness across each path.
- **Save** (no new migration): a v10 save with job flags round-trips deep-equal; a pre-T52 save (no job
  flags) loads and plays on identically — asserted directly, no rung to add.
- **Harness** (`jobs.test.ts`): the shipped `content/jobs/` loads and interprets; a **legibility gate** — a
  job row is all words, states its world-effect, and names its room; the five new room recipes build their
  rooms; a **shipped-content play beat** — claim a base, build the garden, assign a companion, advance a
  day, and watch the stash gain fresh food and the resident stay fed.
- **content-loader**: the schema gate auto-counts the new type (**12 types**); a malformed job is rejected
  (rides the existing malformed-content gate).
- Full CI green in the cloud sandbox before packaging; every prior **497 / 9 / 99** golden byte-identical
  (the no-pool inertness guarantees it), harness smoke + determinism + save round-trip still ✓.

## Definition of done

CI green in a clean sandbox; the legibility gate green; format-patch built + verified (`git am` on a fresh
baseline + `diff -r` empty); changed files synced to the E: mount; `docs/status.json` T52 → done + banner +
parkingLot; `CHANGELOG.md`; `docs/qa/QA_REVIEW_M4_PART8.md`; Mission Control snapshot refreshed. An
adversarial two-subagent audit (engineering: determinism / save-losslessness / **byte-identity of every
prior golden** / loot-draw non-shift / off-screen-tick edge cases / forged-assignment edges; design:
FR-SHL-03/04 fidelity — a real base loop, rooms that unlock real capability, no-number-leak, voice, and
that PL-M3-01 / PL-M3-05 are actually closed).

## Parking lot / deferrals

- **Full off-screen people-sim (PL-M3-02/PL-M4-08 remainder)** — T52 simulates the *base's own* residents
  and jobs off-screen; survivors elsewhere in the city still don't drift or move off-screen (that, and
  desertion/betrayal, is the T53 factions dependency). The shelter half is what T52 lands.
- **Sub-cycle granularity (PL-M2-04)** — a job produces `trunc(hours / hoursPerCycle)` per tick (the
  scavenge idiom), so a short turn under one cycle banks nothing and a single long `advanceWorld` differs
  from many short ones by the truncated remainder. Hour-by-hour off-screen stepping is the deferred
  PL-M2-04; T52 matches the existing scavenge/guard behaviour rather than introducing a second model.
- **Job/room dials untuned (M5 T59/T60)** — every rate (`hoursPerCycle`, produce/consume quantities, the
  generator's fuel burn + power gain, the feed threshold, the stash-spoil + barricade-decay rates, the
  watchtower halving) is a first-pass identity dial, not balanced against a real cross-city run.
- **Morale / friendships from shared labour (FR-NPC-07)** — residents working a base together is the
  natural seat of inter-NPC bonds and shelter morale, but that's the T53 relationship model; T52 ships the
  *production* loop, not the social one.
- **A base under attack (PL-M3-06/08)** — jobs make the base worth raiding, but the live night-siege that
  attacks it is still the deferred contested-world beat.
- **Trading the surplus (FR-ECO-08)** — a self-sustaining base *produces* surplus; exchanging it with
  groups needs factions (T53).
