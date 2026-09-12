# QA Review — T76 · Horde collision: noise acquires a bill

**Date:** 2026-09-12 · **Milestone:** M4 · **Task:** T76 (design review 2026-09-12, step 3)
**Status:** DONE · **Not byte-identical** — intentional behaviour change, declared like T71/T72/T75.

**CI (clean sandbox):** engine **726** (was 675 at T75) / harness **264** (was 262) /
content-loader **23** / schema gate **160** / a11y gate OK / `tsc --noEmit` clean in all three
packages. Save schema **v10 holds — no migration rung, and no field added to `GameState` at all**.

---

## 1. What was wrong

`state.hordes` had **no mechanical consumer**. Outside `sim/hordes.ts` it was read by one narration
line in `coreActions.ts`, the pacing telemetry, the Living History and the harness soundscape. A horde
standing on the player's node spawned nothing, blocked nothing and wounded nothing — so `FIRE_NOISE 75`
against `MELEE_NOISE 15`, the designed counterweight to the firearm, re-pathed a mass that could not
matter when it arrived.

Two things the design review said about this turned out to be **wrong on the full city**, and both are
corrected in the module headers rather than quietly inherited:

- **"It prints for twenty consecutive turns while nothing arrives."** That is the M3 fun-gate
  transcript, whose player walks a two-node itinerary beside the one seeded mass. Measured on the
  shipped 60-node city with a parked player: the lead fires **0 times in 500 turns across 5 seeds**,
  and no mass ever arrives either. The honest complaint is that the horde was **invisible**, not that
  it cried wolf.
- **`HORDE_HOURS_PER_STEP` 4→2 "so a horde advances on a normal turn".** T74's accumulator already
  delivered exactly that: one horde takes **180 steps over 30 days of ordinary 2-hour turns** — one
  step every four hours, not zero. The retune was **not taken**; see §5.

---

## 2. What shipped

### `sim/overrun.ts` (new) — the collision is a consequence, not a fight

While a mass stands on the player there is **no fight choice at all**: run for a discovered neighbour,
or go to ground. The branch sits above combat in `availableActions`, so a horde walking into a duel
does not queue behind it, and **both verbs end the fight and abandon any engaged encounter**.

- Escape roll = `max(0.6, detectChance(noise, phase, weather))`. The floor is what makes the collision
  cost something at night in fog, where the ordinary stealth roll clamps to 0.
- On a hit: **one wound per 16 bodies above the size floor**, 1 to 3. Its own table
  (`OVERRUN_WOUNDS`), **not** the walker retaliation table: a mass pressing past you mostly claws and
  crushes, so a bite is 1 row in 5 rather than 1 in 2. At the walker table a two-wound overrun infects
  ~75% of the time and the horde becomes an execution; at 1-in-5 it is ~36%.
- **The hold is never omitted.** A node whose neighbours are all fogged would otherwise return an empty
  choice list — a hard softlock, the PL-M5-14 class of bug T75 found in the explore branch.
- **Derived, never stored.** `isOverrun` is a function of horde positions the world sim already writes,
  so there is nothing to desynchronise and no save rung.

### `sim/hordes.ts` (rewritten) — a mass that is made of bodies

- **Seeding is content-driven.** One mass per region whose **authored** `zombieDensity` clears 50,
  sized 8–40 from that density, placed on the node furthest by hop count from the start. The shipped
  city gets **three** — Mercy 35, Downtown 33, Ironworks 27 — and Rivermouth (45, the start region),
  Hillcrest (40) and the Terraces (35) stay horde-free. A content set that authors no dead gets no
  mass, the rule T75's repopulation already keeps.
- **The body trade.** Every node a horde *enters*, it sheds one walker (node contested and under its
  `nodeCeiling`) or absorbs the node's last plain walker (node over it), or does nothing (quiet, at the
  ceiling, or holding only specials). `nodeCeiling` is shared with T75, so there is one definition of
  what a district holds. `sum(rosterOf(node).length) + sum(horde.size)` is **invariant**.
- **The walk is chunk-exact.** One node per step, re-picking a destination on arrival, re-deriving the
  path each step, and **interleaved across the hordes** so every mass takes its first step before any
  takes its second. The last is not cosmetic: hordes share `nodes` and the `horde` stream, so walking
  one through its whole span first changed both what it found and the draw order — the hazard T75 hit
  with a single shared `repop` stream.
- **`world.flags["hordes.disabled"]`** switches the whole layer off, and `overrunsPlayer` is the one
  definition every dependent system branches on (see §4, finding V-2).

---

## 3. Measured, before → after

Shipped content, same fixtures both trees.

| | T75 baseline | T76 |
|---|---|---|
| Hordes at seed / carried mass | 1 / 24 | **3 / 95** |
| Horde steps over 30 off-screen days | 180 | **540** (57 of 60 nodes touched) |
| Map bodies at day 30 (off-screen) | 132 | **101** (the rest is carried: mass 24 → **120**) |
| Quiet nodes at day 30 | 11/60 | **10/60** (seed-dependent: also 12→11, 11→12, 8→10) |
| Scripted never-fight runs: turns overrun | 0 / 24 / 0 / 0 / 0 of 60/72/52/60/49 | **0 / 8 / 0 / 4 / 6** of 60/40/52/60/49 |
| …consequence of being overrun | **none whatsoever** | 2–18 wounds; runs end 4–5 days in either way |
| World lead fires (parked player, 5×100 turns) | **0** | **7**, longest run 2, against 10 actual overruns |
| `tickHordes` one-shot ≡ chunked (480h, 60 nodes) | **no** (machine-shop vs loading-canal) | **yes**, byte-identical |
| `advanceWorld(200 000h)` | 5 ms | **231 ms** |

**Overrun outcomes** (mass 24, 200 seeds): detected **61%** (the floor, exactly), **2.00** wounds per
detection, bite wounds **23% of wounds** — 0.47 per detection.

**It is avoidable, and that is measured, not asserted.** The one-hop lead preceded **18 of 18**
overruns across five scripted runs. A player who moves away when it fires takes **12 overruns over 304
turns** where the same player ignoring it takes **18 over 261** — 3.9 per hundred turns against 6.9 —
and survives about a sixth longer. That is FR-CBT-08's "routed, funneled or fled" earning its pass for
the first time; through T75 it passed only because the horde had no teeth.

---

## 4. Three audit passes — what they changed

Two adversarial subagents (engineering; completeness-and-honesty), then a **verification** subagent on
the fixes. The third pass earned its budget again — it caught a "fix" that made its own problem worse.

### Pass 1 + 2 — the defects

| | Finding | Fix |
|---|---|---|
| E-1 | **Conservation broken.** `withRoster` DROPS malformed roster entries, so a flat ±1 credit deleted bodies. Reachable from authored content: `seedRoster` copies `zombieTypes` through unfiltered, so a `["", "zombie.riot"]` typo ships a node that eats a body the first time a mass crosses it. Measured 23 → 22 on shed, 25 → 23 on absorb. | Credit the **actual delta** in `rosterOf(node).length`. Conservation now holds by construction. |
| E-2 | **`resolveOverrunAction` had no precondition.** Stage 1 validates only an action carrying a `choiceId`, so a bare `{type:"hold"}` reached the dispatcher on any state — burning a `stealth` draw, clearing `combat`, dropping an engaged encounter and landing up to 3 wounds with no horde on the map. 16 of 30 seeds produced wounds. | `if (!isOverrun(state)) return state;` |
| E-3 | **`hordes.disabled` leaked** into `evaluateEvents`, the Living-History beat and `worldLead`. A frozen mass still shut encounters out of its node and still wrote "a horde came down on you in the open". | All gated. |
| E-4 | **A NaN reached `state.history`.** The beat summed `h.size` raw; `NaN` serialises to `null`, so the save was lossy. | `hordeMassAt`, which scrubs. |
| H-1 | **BLOCKER, stale prose:** "seeds six, totalling 156" — the build seeds three, totalling 95. | Corrected. |
| H-2 | **BLOCKER, over-claim:** "T76 can only ever reduce encounter shadowing, never add to it." The `massAction` invariant is local; the *system* effect is seed-dependent (11→10 and 12→11 on two seeds, 11→12 and 8→10 on two others), because absorbing bodies frees region capacity and T75's repopulation then colonises nodes it would otherwise skip. | Claim narrowed to what is actually proven, with the counter-measurements. |
| H-3 | **Undeclared chunking difference:** the mass traded reads region density once per span. Measured: identical positions, sizes 23/29/37 one-shot against 33/37/40 chunked, 112 map bodies against 91. | Declared, with the numbers. |
| H-4 | **T75's shelter promise was being broken silently.** T75 excludes the player's node *and their claimed shelter*; `repopulate.ts` is explicit that the base assault is T83's, "not this pass's to sneak in". A mass was shedding into the unoccupied base and could pin the player inside it. | The player's node break is kept (it is the task); **the shelter is kept out of both the trade and the collision**. PL-M5-18. |
| H-5 | **Roster laundering:** absorbing the roster tail could swallow an authored special and re-emit it as a plain walker — the exact incoherence T75 removed. | Absorb takes the last **plain walker**; a specials-only node is left alone. |
| H-6 | **`WALKER_WOUNDS` exported for a consumer that does not exist**, with a justifying comment that contradicted two others. | Un-exported; the three comments now agree. |
| H-7..H-9 | Over-claims: "24 consecutive turns" (it is 24 of 72, in stretches of up to four); "leading a mass into a stripped district thins it" (impossible — a shed needs a body already there, so `HORDE_MIN_SIZE` never binds); "the two-node-slice artefact" (playSlice loads the full city; it is the *itinerary* that is two nodes). | All corrected in place. |

### Pass 3 — the verification pass

- **V-1 — the `worldLead` fix made its own problem worse.** Deleting `h.dest === here` helped; widening
  1 hop → 2 more than paid it back. Parked player, 100 turns: two hops fires on **23%** of turns
  (longest run 20) against the pre-fix build's 16% (run 26) and one hop's 8% (run 4). **Reverted to one
  hop**, which measures 7 fires in 500 turns, longest run 2 — and preceded 18 of 18 overruns, so it
  lost no warning at all. *A fix that is not measured is a guess.*
- **V-2 — the shelter exclusion had not been carried to every reader.** The Living History still
  narrated "a horde came down on you in the open" for a mass crossing the player's own base, and the
  encounter guard still fired there, justified by a pre-emption that cannot happen in the shelter.
  Fixed by giving the rule **one definition** — `overrunsPlayer` in `sim/hordes.ts` — that
  `availableActions`, `evaluateEvents`, `recordHistory` and the harness soundscape all read. It lives
  in `hordes.ts` rather than `overrun.ts` so the two sim modules can use it without closing an import
  cycle through `events.ts`.
- **V-3 — the delta credit breached `HORDE_MAX_SIZE`** on malformed input (39 → 42, 476 breaches in
  20 000 property cases), making "never balloons without bound" false on exactly the input the delta
  credit was added for. Clamped.
- **V-4 — two mutants survived all 722 tests** (`hordesEnabled` in `evaluateEvents`; `hordeMassAt` in
  `history.ts`), and the test whose *title* claimed to cover the first asserted nothing about it. Both
  now have discriminating tests; the title was corrected.
- Nits fixed: density is read post-drift, not "as the tick opened"; `WALKER_WOUNDS` has no repeated
  rows so it does not exhibit the weighting idiom; `Horde.types` is dead state and is now declared as
  such rather than left looking live.

**Mutation testing.** 18 mutations of the new bounds were applied, run against the full suite and
reverted; all but the two above were killed by a named test. The two survivors are the finding V-4.

---

## 5. Corrections to the task note — measured, not argued

1. **`HORDE_HOURS_PER_STEP` stays 4.** T74's accumulator already made a horde advance on an ordinary
   turn (180 steps over 30 days of 2-hour turns). At 2 a horde's 2h/node would match the player's own
   `MOVE_COST`, so a fleeing player could never gain ground — the opposite of FR-CBT-08.
2. **Three hordes, not 4–6.** Counterfactual on the finished build with the threshold at 1 so all six
   regions seed: overrun on **12–22 of 41–58 turns** for **12–28 wounds**, every seed dead on day 4–5;
   at three, **0–8 of 40–60 turns** for **2–18 wounds**, with two of five seeds never meeting a mass.
   Six does not make the horde deadlier so much as constant. Three also leaves the start region clean,
   so a mass is something you meet by pushing into the three richest districts.
3. **T76 does NOT close PL-M2-05.** PL-M2-05 is that slip and retreat ignore route conditions where
   `move` honours them. T76's flight reuses `escapeTargets` and so *inherits* that hole; **T77 owns it**.
4. **"A horde on a high-density node grows" is inverted.** A horde grows by absorbing from a node OVER
   its ceiling, and higher density means a higher ceiling — so a dense district feeds a mass less
   readily than a stripped one. What grows a horde is an over-populated node, wherever it is.
5. **"A horde that sits on a node adds walkers per tick"** — the trade fires on node **entry**. Entry is
   what carries the walk's chunk-exactness; a per-tick sit needs a second accumulator whose period does
   not divide the movement period, and re-opens the oscillation the ceiling fixed point closes.
6. **Spawn / split / merge were not built.** `state.hordes.length` is invariant for the life of a run.
7. **FR-CBT-08 is satisfied for *fled* and *routed*, not *funneled*.** There is no funnelling mechanic;
   the noise lure (routed) is pre-existing T26. Only the fled half is new.

---

## 6. Declared limits

1. **Chunk-exactness holds for a horde set that shares a speed** — every set the engine produces. The
   interleave orders steps by index, which is hour order only while the masses tick in lockstep.
2. **Two chunking differences are inherent**: the noise re-path is evaluated once per tick against that
   tick's opening noise; the mass traded reads region density once per span (positions stay exact,
   sizes do not).
3. **The claimed shelter is a hard sanctuary from this system** until T83 — no bodies shed there, no
   collision while standing in it. **PL-M5-18.**
4. **A horde cannot be dispersed.** A shed needs a body already standing there, so walking a mass into a
   stripped district thins it by nothing. `HORDE_MIN_SIZE` never binds in shipped content;
   `HORDE_MAX_SIZE` binds constantly (all three masses saturate at 40 by about day 15). **PL-M5-16.**
5. **`Horde.types` is dead state** — written once at seeding, read nowhere. **PL-M5-17.**
6. **Performance:** `advanceWorld(200 000h)` goes 5 ms → 231 ms, linear in hours, because the walk is a
   loop of single steps rather than arithmetic. **PL-M5-19.**
7. **The overrun is not scaled by the difficulty dials** (`difficulty.ts` has five and T76 reaches
   none), and the pacing telemetry has no collision signal. **PL-M5-20** — the T75/PL-M5-11 precedent:
   a dial that nothing reads is a defect, so the knob is parked rather than added dead.

## 7. Not to be over-read

T76 gives the *horde* teeth. It does not touch the arousal ladder, `alerted`, pack weight or
`woundBurden` (T77), nor `region.threat` or the director (T78). PL-M4-26's upward-driver half stays
open. And **T75's headline finding still stands**: T78 is a prerequisite for the density dial to mean
anything, so T57's exit-gate playtest should run against a build that includes it.
