# M3 Part 3 — implementation plan (T37–T38)

Working design note for the third block of M3 (People, shelter & first story). Parts 1–2 built the
*people* layer: survivors you can meet, help, wrong, recruit, and lose. Part 3 turns to the second
promise in the milestone name — **shelter** — and gives the run its first *place that is yours*. Until
now every node has been somewhere to pass through: searched, looted, left behind. T37 lets the player
plant a flag — claim a node as a base — and T38 makes that base a live maintenance decision: spend loot
and time to fortify it against the reactive world, and keep spending or watch it decay.

This is the turn where the map stops being uniformly hostile. A claimed, fortified shelter is where you
can rest deeper and stand a better chance through the night; a neglected one erodes back to just another
address. It is the substrate T39 (the shared stash) and the first story arc (T40–T41) will anchor to —
a survivor in trouble, a base to defend, a place to come home to.

Everything obeys the standing engine discipline (ADR-0001): the engine stays pure, deterministic,
dependency-free, integer-only, plain-JSON, and save-round-trippable; all I/O lives in the client. No new
RNG stream is opened — claiming and fortifying are deterministic functions of the choice taken and the
state it acts on — so every M2/M3P1/M3P2 golden run stays byte-identical.

## No schema bump this block — the shape was reserved since T3

Part 2 needed one additive rung (v5→v6, `NPCState.met`). **Part 3 needs none.** The two facts a shelter
introduces already exist in the T3 state shape, reserved and — until now — inert:

- **`Player.shelterId: NodeId | null`** (state/types.ts) — "Established shelter, if any." Created as
  `null` in `createInitialState`, never written by any system before this block. T37 populates it.
- **`NodeState.barricades: number`** (0–100 int) — "barricade integrity." Seeded to `0` in `seedWorld`,
  never mutated by any system before this block. T38 uses it as the shelter's **fortification level**.

Populating reserved fields is not a shape change — exactly the reasoning by which T36 populated the
always-present `actors` collection with no rung. `SAVE_SCHEMA_VERSION` stays **6**; a claimed, fortified
run round-trips losslessly through the existing save path with zero migration work (the round-trip test
deep-equals the whole state, `shelterId`/`barricades` included). Because both fields are untouched in
every prior run (`shelterId === null`, all `barricades === 0`), **every new code path is inert on old
state** and all existing golden runs stay byte-identical — the same safety property every prior block
kept.

## The surfacing seam — how a base reaches the Scene

Part 3 reuses the exact seam T35 built for people, so the single-decision UI contract (FR-UI-01/03) is
untouched. In the explore branch of `availableActions` (no active fight, no loitering walkers — those
still pre-empt), two context-sensitive choices appear:

- **Claim this place** — offered only when you have **no shelter yet** (`shelterId === null`) and you
  have **searched the current node clean** (`searchPct >= 100`). You secure a building before you make it
  home; the search investment (three searches ≈ 9 hours) is the price of admission, and the gate keeps
  claim inert on any run that never fully searches a node — so the T12 start-node choice assertion is
  unchanged.
- **Fortify your shelter** — offered only when you are **standing in your own shelter**
  (`shelterId === here`), you **carry `item.scrap`** (the material already produced by the T17 loot
  tables), and it is **not already at full fortification** (`barricades < 100`). Mirrors the eat/drink
  offer: surfaced only when the resource is carried and the action can do something.

`sceneOf` gains a shelter line in the same narration pass the people/weather leads use: *"This is your
shelter,"* with a read of how sound it is (*"newly claimed and bare"* … *"well fortified"*) and a
carried-scrap hint when fortification is possible. Screen-reader-safe — all words — and it flows through
the existing `describe*`/choice render path with **no client rewrite** (the T20 transcript carries it for
free).

## Build order

`T37 → T38` is the only sensible order: you cannot fortify a base you have not claimed, and the
fortification field is meaningless until a node is a shelter. Both ship in one block, in one new engine
module (`src/sim/shelter.ts`) that owns the constants, the two action resolvers, and the three world
effects, dispatched exactly as `encounters.ts` is.

| Task | Deliverable | Seam | State touched | Retires |
|------|-------------|------|---------------|---------|
| T37 | Claim a node as your base + deeper rest there | `src/sim/shelter.ts` (`claim-shelter`) + `availableActions`/`sceneOf` + stage-4 rest bonus | `Player.shelterId` (**reserved field, no rung**) | FR-SHL-01 |
| T38 | Fortify with loot+time; fortification decays and needs upkeep; the safety payoff | `src/sim/shelter.ts` (`fortify`, decay, muffle, detection floor) + pipeline stage 6 + `stimulusAt` | `NodeState.barricades` (**reserved field, no rung**) | FR-SHL-02 |

## T37 — Claim a shelter (FR-SHL-01)

**Idea.** Give the run a fixed point — the first place on the map that is *yours*. One active shelter per
run (FR-SHL-01): claim is offered only while `shelterId === null`, so the decision is *where* to root,
not how many bases to sprawl. `resolveShelterAction` sets `player.shelterId = here`; the turn spends
`CLAIM_COST` hours and changes the `player` system, so it is a real resolved turn (FR-CORE-04), never a
no-op. A `shelter.claimed` event lands in the append-only Living History (T31), the first beat of the
place's story.

**The payoff — deeper rest (FR-SHL-01 "better rest quality").** Resting at your claimed shelter recovers
more fatigue than resting rough. Applied in the stage-4 needs pass as an *additional* fatigue reduction
after the standard `REST_RECOVERY` (survival.ts stays shelter-agnostic; the bonus is applied in
`tickNeeds`, which already sees the whole state): a base bonus for a bare claim, scaling up with
fortification (T38). Inert unless the action is a `rest` and `player.location === player.shelterId`, so
no prior run is touched.

**DoD.** Standing on a node you have searched clean with no shelter yet, "claim this place" is offered;
taking it sets `shelterId`, costs time, logs the claim, and is a resolved turn; resting at the claimed
base recovers more fatigue than resting elsewhere; claim is not offered once you already have a shelter;
deterministic, integer-only, save-lossless with no rung.

## T38 — Fortify & upkeep (FR-SHL-02)

**Idea.** A base is not a one-time purchase; it is a standing maintenance decision against a world that
does not sit still. Fortification is real, decays, and must be topped up — the live upkeep loop the FR
asks for.

- **Fortify** (`fortify`) — offered at your shelter when you carry `item.scrap` and it is below full.
  Spends **one scrap** and `FORTIFY_COST` hours, raising `barricades` by `FORTIFY_GAIN` (capped at 100).
  From bare to full is a real investment (four fortifies: 4 scrap + 12 hours). Changes `nodes` and
  `player` (the spent scrap), a resolved turn; logs `shelter.fortified` when the level actually rose.
- **Upkeep decay** — each turn's hours erode the shelter's `barricades` by `FORTIFY_DECAY_PER_HOUR`
  (pipeline **stage 6**, `updateNode`, alongside the noise decay it already runs). Neglect a base and its
  fortification bleeds down over days; keeping it strong means coming back to spend more scrap. Decay only
  ever touches a node with `barricades > 0` (in practice only the shelter), so every prior run — all
  barricades `0` — is untouched.
- **The safety payoff, scaled by `barricades` (all integer math).** A fortified base earns three
  concrete protections, each a fraction of a tuned maximum scaled by the current fortification level
  (`trunc(max * barricades / 100)`), so a bare claim earns none and a full base earns all:
  1. **Noise muffling** (up to `−SHELTER_NOISE_MUFFLE_MAX`/turn at the shelter node, stage 6 after the
     noise deposit) — the structure absorbs the sound you make at home. Because hordes re-path to the
     loudest audible node (T26 reads `NodeState.noise`), a quieter base **also resists horde drift** —
     one mechanism delivers both "dampen node noise" and "resist horde drift."
  2. **A detection floor against the dead** (up to `−SHELTER_DETECT_FLOOR_MAX` on the node's stimulus in
     `stimulusAt`) — a fortified base blunts the presence/scent/night-hunter bonuses that would otherwise
     rouse the dead onto a resting player. Full fortification cancels the "player is here" bonus outright,
     so a secure base in daylight goes dormant; a stalker at night with a bleeding player is *reduced*,
     never nullified — fortification helps, it is not god-mode ("raise the detection floor against night
     hunters").
  3. **Deeper rest** — the fortification half of T37's rest bonus (a well-built base is a better place to
     sleep).

**DoD.** At your shelter with scrap, "fortify" is offered and raises `barricades` toward 100 for one
scrap + time, logging the beat; fortification decays over time and must be re-spent; a fortified base is
measurably quieter (less horde draw), harder for the dead to detect (dormant by day at full), and a
better rest; every effect scales from zero at a bare claim to full at 100; deterministic, integer-only,
save-lossless, no rung; every prior golden run byte-identical.

## Test & CI posture

Standing gate unchanged: every increment keeps **engine + content-loader + harness** green plus the
content schema gate, run in full in a clean sandbox copy (the mount carries only partial/host-OS deps).
New `test/shelter.test.ts` covers: the claim gate (offered only unclaimed *and* searched-clean; one per
run); claim sets `shelterId`, costs time, logs, and is a resolved `player`-changing turn (FR-CORE-04);
the deeper-rest bonus at the base vs. rough (and that it scales with fortification); the fortify gate
(offered only at your base, with scrap, below full); fortify spends one scrap, raises `barricades`, caps
at 100, and logs only on a real rise; upkeep decay erodes `barricades` over hours and only ever at a
fortified node; noise muffling and the resulting horde-drift resistance; the `stimulusAt` detection floor
(a full base dormant by day, a stalker-at-night reduced not nullified); a full slice
(search→claim→fortify→rest→neglect→decay) byte-identical from its seed and save-lossless; and the M0
empty-turn / no-graph contract still a strict no-op (all shelter branches inert on `shelterId === null`).
The `pipeline.test` 14-stage order assertion, the T13 100-turn FR-CORE-04 audit, the save round-trip, the
harness empty-turn smoke, and the malformed-content rejection all stay green — stage 6's body grows but
its name and the order do not, and no schema or RNG changes.

## What this block deliberately defers

- **Shared stash (FR-SHL-03 / FR-PLR-04)** — deposit/withdraw a store separate from the carry budget is
  **T39**, the next block; this block ships the base and its defence, not its warehouse.
- **The night-attack / raid event** — a fortified base *resists* detection and horde drift, but a
  scripted assault on the shelter (and a raided-stash story beat) belongs to T39/T40's contested-world
  hooks.
- **Off-screen shelter decay** — fortification decays on the player's own turns (stage 6), not inside
  `advanceWorld`; off-screen base upkeep rides with the deferred off-screen people-sim (M3 Part 1/2
  deferral), keeping `advanceWorld` byte-identical this block.
- **Fortify noise, shelter relocation/abandonment, and multiple bases** — fortifying is quiet for the VS
  (the safe-base fantasy over the realism of hammering); claim is once-per-run with no relocate/abandon
  verb yet; both are noted as post-VS tuning/parking-lot levers.
