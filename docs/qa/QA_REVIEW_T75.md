# QA review — T75 · Zombie repopulation: density becomes bodies

**Task:** M4 · T75 — design review 2026-09-12 (`docs/qa/DESIGN_REVIEW_2026_09.md`) **step 2 of 12, the keystone**
**Date:** 2026-09-12 · **Status:** done
**Build:** engine **675** / harness **262** / content-loader **23** / schema gate **160** / a11y OK
(engine was 637 at T74; +38 from the new `test/repopulate.test.ts`)
**Byte-identity:** **intentionally broken**, declared here the way T71/T72 were. A seeded run diverges
from a pre-T75 build: the world now refills, and `seedWorld` gives one authored node a body it never had.
**Save schema:** **v10 holds — no migration rung.** Both new fields are optional-tolerated-absent (the
T74 idiom).

---

## 1. What was wrong

`NodeState.walkers` was written in exactly three places — `seedWorld` (init), a kill in `combat.ts`, and
the `seedWalkers` encounter effect (four authored uses across three nodes) — plus the v1→v2 save-migration
rung. **Nothing in the director, the drift model, the hordes or the difficulty dials ever added one back.**
The player stripped a finite city of 105 bodies and the map never refilled.

The consequence is the one the design review leads with: `region.zombieDensity` — the dial the whole
escalation story runs on, the one the director nudges, the one T24's relaxation moves, the one
`directorAggression` scales — was read only by the director, the drift model and pacing telemetry. Pin it
at 100 and the only observable difference was one line of narration. **Density had no body.**

Second, the **type/population divorce**. A node carried `walkers: number` and `zombieTypes: ContentId[]`
with nothing reconciling them, so:

- `zombieTypes: ["zombie.riot"]` with `walkers: 3` fought **three** armored dead (5 hp behind armor 1 —
  about ten hours of melee and a ~92% bite risk each);
- killing the riot decremented the count but never removed the *type*, so the next fight was another
  riot, forever, until the count hit zero;
- a node with a type and `walkers: 0` (`node.rivermouth.marina`, a stalker) was never offered as a fight
  at all, because every gate reads `walkers > 0`. Exactly one shipped node is in that state.

## 2. What shipped

**`prototype/engine/src/sim/roster.ts` (new).** A per-node roster: one content id per standing body.
`walkers` becomes its length, `zombieTypes` its distinct non-walker set, so every existing consumer keeps
working unchanged *as code*. `withRoster` writes all three coherently; `rosterOf` reconciles a stored
roster that disagrees with `walkers` (treating `walkers` as authoritative, because that is the field every
gate branches on) and synthesizes one for a pre-T75 save, ordering types most-dangerous-first so a
truncated legacy list still yields the enemy the save said was standing there.

**`prototype/engine/src/sim/repopulate.ts` (new).** A repopulation pass inside the `regions` layer
(pipeline stage 7), after T24's drift so it reads this tick's density. Per region, per banked 6-hour
period, one *attempt*: a roll against density decides whether a body arrives, a weighted pick decides
where (base 1, `+noise/10`, `+searchPct/20`, `+3` for a visit in the last 2 days), and a density-gated
table decides what (walker 60 always; fresh/crawler at 30; screamer/stalker at 50; bloated/riot at 70).

Bounded by three constructions that can only ever **deny** a spawn: a per-node ceiling
`min(6, 1 + density/20)`, a region capacity `nodes × density / 20`, and two hard exclusions — never the
node the player is standing on, never their claimed shelter. It never culls. `world.flags["repopulate.disabled"]`
switches the whole pass off, mirroring the director, so T57's playtest can A/B it.

**Clock:** banked hours (T74), with the idle-HOLD rule covering all four ways a region can be unable to
act. **RNG:** a new named stream **per region** (`repop:<regionId>`), so no existing sequence moves and a
region's spawns depend on neither the hour chunking nor how many other regions exist.

**Fixes at the call sites:** `enemyForNode` reads the roster; `killEnemy` removes the body it fought;
`seedWalkers` appends bodies; `seedWorld` seeds a roster (giving the marina's stalker its body);
`combatNarration` names what stands behind the body you would fight first.

## 3. Measured, before → after

Same fixtures, same seeds, run against both the pristine T74 baseline and this build.

| | T74 baseline | T75 |
|---|---|---|
| Seeded bodies | 105 | **106** (the marina's stalker) |
| 30 off-screen days (2h turns) | 105 → **105**, flat forever | 106 → 115 (d1) → **125 (d3)** → 126, then flat |
| Downtown stripped to 0, 7 days | 0, 0, 0, 0, 0, 0, **0** | 2, 4, 5, 8, 10, 11, **12** (13 by d10) |
| Scripted never-fight run, same seed | 9 of 25 turns faced a fight prompt | **12 of 25** |
| Walkers alive at the end of that run | 105 | **122** |
| Quiet nodes (where encounters can fire) | 17 / 60, constant | 17 → **12 / 60** by day 3 |
| Player's node / shelter after 480h | 0 / 0 | **0 / 0** (the exclusions hold) |
| Living-History beats over 30 days | 811 | **811** (see §5) |

**Determinism:** identical twice from the same seed; save → load → continue byte-identical to continuing
straight through; save size +2.0% (+3.3 KB) at day 30; `advanceWorld` cost 1.52× baseline
(849 ms vs 559 ms for 4320 × 2h on the 60-node world).

## 4. The honest verdict: this is a refill mechanic, not yet an escalation one

**The mechanism works. Its input does not.** Pinning density each tick over the same 30 days gives
**106 / 149 / 240 / 300** bodies at density **20 / 50 / 80 / 100** — and **20 is what T24's equilibrium
actually produces.** Measured equilibrium densities over 30 off-screen days: downtown 80→21, mercy 85→17,
ironworks 60→18, rivermouth 45→25, hillcrest 40→**2**, the-terraces 35→**0**. At those densities the
shipped city is already *above* its carrying capacity, so every region takes the HOLD branch by ~day 3 and
the totals stop moving.

The flat line is not a bug — it is a saturated city with nobody killing anything — and the refill that
follows a **cull** is real and is what the design review asked for. But two claims in the task note do not
survive measurement and are corrected here:

- ❌ **"all four difficulty dials acquire teeth."** Measured at day 30: **Story 127 / Survivor 128 /
  Hardcore 128 / Nightmare 128** — a one-body spread across the whole range. `sim/difficulty.ts` has
  **five** dials, of which T75 reaches exactly one (`directorAggression`, indirectly), and drift pushes
  density down faster than the director's clamped +1 pushes it up. A repopulation dial was deliberately
  **not** added: it would be a dead knob for the same reason (the T56 / T74 dead-knob lesson).
- ❌ **"the drift model acquires teeth."** Drift's only effect on this pass today is to switch it off.

**T78 — narrowing `playerDistressed` and anchoring drift on the authored baseline — is a PREREQUISITE
for T75's value, not a follow-up.** Running T57's exit-gate playtest against T75 alone would be testing a
system that switches itself off on day three. The Riot/Bloated rows of the spawn table are dormant for the
same reason: **+0 riots and +0 bloated over 30 days**, against +14 walkers.

Also corrected: T75 **closes PL-M4-10** (the marina's inert stalker). It **advances but does not close**
PL-M2-05 (needs T76) or PL-M4-26 (needs T78) — it never writes `region.threat`.

## 5. What T75 costs elsewhere — declared, not discovered

**Encounters and the explore branch are shadowed.** `walkers > 0` gates the whole explore branch
(`coreActions.ts`) and all encounter selection (`events.ts`). Quiet nodes fall 17/60 → 12/60 (10–13 across
six seeds), and **2 to 6** of the 9 node-gated authored encounter bindings are shadowed at day 30
depending on seed. `node.the-terraces.garden-center` carries three of the nine on its own — the
before/during/after evolution triple, where three of the four authored `seedWalkers` effects live — so one
body there shadows the whole chain. Nothing becomes unreachable (a contested node always offers the
fight), and the node the player is standing on can never gain a body under them, so clearing where you
stand keeps it clear while you are there. But an authored beat at a repopulated node now costs a fight
first. The marina cabin is now behind its stalker; the harness test asserts that sequencing explicitly.

**The Living History does not mention any of it.** `recordHistory` diffs weather, nightfall, hordes,
routes, combat, people, shelter and infection; nothing reads `walkers`. 811 beats before, 811 after.
Parked (PL-M5-13) rather than bolted on: a new beat kind touches the history schema, the telemetry and the
harness screens, and it belongs with T78.

**A soundscape cue was un-suppressed.** `seedWalkers` used to union the literal `"zombie.walker"` into
`zombieTypes`, which the harness read as "a special is here" and used to suppress the collective-moan cue.
`distinctTypes` drops it, so the moan now fires at those three nodes. A fix, but an undeclared FR-AUD
change until now.

**Pre-T75 saves lose orphaned types.** A pre-T75 kill decremented `walkers` but never removed the type, so
a converted save's already-cleared nodes still claim their special is standing there. T75 reads those as
empty and drops the type the first time anything writes the node: **17 of 34 typed nodes within 10 days**.
Mostly stale residue being swept up, which is right — but a genuinely authored ambient type is
indistinguishable from residue in a v10 save and is swept up with it. Flavour only (`hasTag`, the screamer
prose, the moan cue); never a fight, because those nodes have no bodies.

## 6. Audit — three passes, as T74 established

Two adversarial subagents (engineering correctness / completeness-and-honesty), then a third
**verification** subagent on the fixes. The third pass again earned its budget.

### Pass 1 — engineering (11 findings, 2 HIGH)

1. **HIGH — the idle-HOLD rule was incomplete.** It checked density 0 / no nodes / at capacity, but not
   "every legal node is already at its ceiling". A region under capacity whose only remaining nodes are the
   player's and their shelter rewrote the region slice **on every tick, forever** — the exact churn T74's
   rule exists to prevent. Reachable on shipped content (the-terraces at density 39 with the player and
   their shelter both in the district: occupancy 19 against capacity 21, ceiling 2). **Fixed:** the
   eligible set is computed once per region and folded into the HOLD predicate.
2. **HIGH — one shared `repop` stream broke chunking invariance.** All regions interleaved their draws on
   a single stream, and the interleaving order depended on how the hours were chunked: `12×2h` and `1×24h`
   produced 121 vs 116 bodies. Adding a region to the content set shifted every other region's spawns.
   **Fixed:** one stream per region, `repop:<regionId>`.
3. MED — the draw-count comment was false (a failed roll costs 1 draw, a success costs 3). **Corrected.**
4. MED — `rosterOf` truncated a legacy type list in *listed* order, so a combat-distinct type past index
   `walkers` vanished and the save faced a weaker enemy than it said. **Fixed** with `ROSTER_COMBAT_PRIORITY`
   (a drift-guard test asserts it equals `COMBAT_PRIORITY`).
5. MED — legacy orphan types erased on first write. **Declared** (§5) rather than papered over.
6. MED — `rosterOf` trusted a stored roster whose length disagreed with `walkers`, so one kill could
   delete several bodies. **Fixed:** reconcile on read.
7. LOW — `killEnemy`'s `idx < 0` fallback rewrote an empty node. **Fixed** (reference-stable, type list
   intact).
8. LOW — a comment claimed leftover attempts were protected when they are dropped. **Corrected.**
9. LOW — `hours = NaN` was not inert (`Math.max(0, Math.trunc(NaN))` is `NaN`, which is not `=== 0`) and
   could spend a banked step. **Fixed** with `wholeHours`. House-wide idiom; noted for T66.
10. LOW — a node whose `regionId` names no live region is invisible to the pass. **Documented.**
11. INFO — the marina seeding change. **Declared.**

Clean in: weighted-walk off-by-one, `pickWeighted`'s zero-total fallback (unreachable, correctly shaped),
stream collisions, `seedWorld` spread order, the sole-writer invariant, save losslessness, the bounds,
edge inputs (`hours = 100000`, empty regions, capacity 0), reference stability of the roster helpers, and
`seedWalkers` count semantics.

### Pass 2 — completeness and honesty (18 findings, 2 BLOCKER)

Both blockers were **over-claims, not code**: the "all four difficulty dials acquire teeth" sentence and
"an abandoned district refills whether or not you are watching". Both are corrected in §4 and in the module
header, with the measurements that disprove them. The pass also caught the "10 hp" riot (it is 5 hp behind
armor 1 — the design review's "10h" is ten *hours*), the PL-M2-05/PL-M4-26 mis-attribution, the
`withRoster`-is-the-only-writer claim (`seedWorld` is a second writer; three harness test helpers write the
triple incoherently), the un-declared encounter shadowing, the dormant Riot/Bloated rows, the soundscape
cue, the `zombie` RNG stream named in `worldSim.ts` that has never existed, and the `NodeDef.walkers`
authoring-contract change the node schema did not mention. All corrected.

**Its most valuable finding was test quality.** Five mutations survived the entire 665-test suite:
`< ceiling` → `<= ceiling`; `occupancy >= capacity` → `> capacity`; deleting the density probability roll;
`.sort()` → `.reverse()` on node iteration; `bodyIndexFor(...)` → `0`. The two "bounded by construction"
tests were mutually shadowed — each fixture made the *other* bound the binding one — and the "spawn rate
tracks density" test measured carrying capacity, not rate. Rewritten so each bound is the sole binding
constraint, and the rate test now pins capacity equal in both arms and compares **time-to-fill**
(24 nodes @ 25 vs 6 nodes @ 100, both capacity 30: 30 attempts vs >60).

### Pass 3 — verification of the fixes (3 survivors + 4 new findings)

Confirmed F1–F6 behaviourally, exhaustively where it could: 1600/1600 reachable `enemyForNode` cases agree
with the baseline across `walkers 0..4` × all 400 type lists of length 0..3; `rosterOf(...).length === walkers`
in 2940/2940 cases; the five previously-surviving mutations are now caught, along with 11 of its own.

But **three of the fixes had no discriminating test** — the same failure mode pass 2 had just flagged:

- the HOLD test used 6-hour ticks, where the banked remainder comes back equal to the carry, so it could
  not tell a correct HOLD from a missing one (2-hour ticks discriminate: 0/12 vs 12/12 slice rewrites);
- the NaN-hours test used a carry smaller than one period, so the unfixed code had no step to spend
  (a carry of 30 spawns five bodies);
- the `killEnemy` empty-roster fallback had no assertion at all.

All three now have tests that fail against the unfixed code. It also found:

- **`test/worldSim.test.ts` asserted an invariant repopulation violates.** "The live regions layer moves
  only the regions slice" checked `after.nodes === state.nodes`, and passed only because one density roll
  happened to fail on that fixture at 6 hours — at 30 hours it goes red. A load-bearing architecture
  assertion one RNG draw from failure. **Rewritten** to assert the real boundary: the layer writes
  regions + nodes + rng, never the player, the world dials, the hordes or meta; and it never culls.
- **Chunking exactness is conditional.** A region that *saturates mid-span* banks differently on the two
  paths (one-shot banks the whole span's remainder before its loop; chunked HOLDs the moment it saturates).
  Bounded at `REPOP_HOURS_PER_STEP − 1` hours, i.e. one later attempt — measured 7 vs 6 bodies after a
  subsequent cull. **Declared** rather than "fixed": re-banking unused hours instead would let a
  200,000-hour advance carry an unbounded remainder into the save.
- The shadowing figure was the best case (2 of 9 on one seed, **6 of 9** on another), and the garden-center
  block. **Corrected.**
- The `killEnemy` fallback comment still claimed a byte-identity it does not have. **Corrected.**

## 7. Parking lot added

- **PL-M5-10** — the encounter/explore gate is `walkers > 0`, which was cheap when walkers were static and
  is expensive now. Should an ambient encounter be allowed to fire alongside one body? Touches T77.
- **PL-M5-11** — repopulation has no difficulty dial, deliberately; revisit with T78.
- **PL-M5-12** — Riot/Bloated spawn rows (density ≥ 70) are dormant at shipped equilibrium densities.
- **PL-M5-13** — repopulation leaves no Living-History trace.
- **PL-M5-14** — **pre-existing softlock, found while measuring, NOT caused by T75:** a scripted run
  reached `node.rivermouth.corner-store` with fatigue 100, no shelter, at dawn, and `availableActions`
  returned **[]** — a turn with no legal action at all, from which the run cannot continue. Reproduces
  identically on the T74 baseline. Belongs to T66 (reliability) but is severe enough to flag now.
- **PL-M5-15** — `hours` below 1 are dropped rather than banked (harmless today: every `timeCost` is an
  integer), and `Math.max(0, Math.trunc(hours))` is the house-wide idiom that lets NaN through. T66.
