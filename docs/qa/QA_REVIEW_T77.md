# QA Review — T77 · Closing the noise → arousal → detection chain

**Date:** 2026-09-12 · **Milestone:** M4 · **Task:** T77 (design review 2026-09-12, step 4)
**Status:** DONE · **Not byte-identical** — intentional behaviour change, declared like T71/T72/T75/T76.
The stealth roll is the thing this task exists to move.

**CI (clean sandbox):** engine **759** (was 726 at T76) / harness **264** / content-loader **23** /
schema gate **160** / a11y gate OK / `tsc --noEmit` clean in all three packages. Save schema **v10
holds — no migration rung, and nothing added to `GameState` at all**. The read is derived.

---

## 1. What was wrong

Three systems described the same thing and never spoke to each other.

- **Noise** (T14) deposited sound into node memory.
- **Arousal** (T25/T46) turned that sound, plus presence, the scent of a bleeding wound, a Stalker's
  night-hunt and a Fresh's speed, into a five-rung `NodeState.zombieState` ladder — consumed by three
  narration strings and the harness soundscape, and nothing else.
- **Detection** (T15/T27/T28) rolled `detectChance(noise, phase, weather)`: three world inputs, blind
  to the dead standing in front of you and to the state of the body carrying the pack.

So a node that had *turned and started toward you* was the same stealth roll as one that had never
noticed you; a player bleeding from three untreated wounds slipped as cleanly as an unhurt one; a pack
stuffed to the brim walked home exactly as quietly as an empty one. `CombatState.alerted` was written
twice and read in no condition anywhere. `woundBurden()` was exported and imported by nobody.

And underneath all of it, **the ladder had already collapsed**. `PLAYER_HERE_BONUS` was 40 — exactly
`CHASE_AT` — so *any* occupied node read `chasing` the instant the player stood on it, at zero noise,
in any weather. Measured on the shipped city before the fix (8 seeds × 2 policies, 400 turns):
**168 of 168 slips happened at a `chasing` node.** The four rungs below it were not rare. They were
unreachable.

---

## 2. What shipped

### `sim/detection.ts` (new) — one composed read

`detectChance` is untouched and still means what it meant: the **world's** half of the read. The new
module composes it with the rest, every term in **percentage points** (the unit `phaseConcealment` and
`weatherDetectionDelta` already use), summed and clamped once.

| term | source | range |
|---|---|---|
| base | `detectChance(noise, phase, weather)` | 0 … 0.9 |
| arousal | `NodeState.zombieState` | +0 … +0.30 |
| alerted | `CombatState.alerted`, on a retreat | +0 … +0.15 |
| scent | `woundBurden` | +0 … +0.10 |
| pack | weight over `PACK_HEAVY` | +0 … +0.10 |
| extra | the caller's own (the Crawler's grasp) | caller's |

`DETECT_MAX` stays **0.9**: nothing is ever certain, and a literal test now pins that so the ceiling
cannot be quietly raised to 1.

### `sim/zombies.ts` — the ladder gets its rungs back

`PLAYER_HERE_BONUS` **40 → 25**, strictly below `CHASE_AT`. Arriving quietly on an occupied node now
reads `investigating`; it takes a bite's worth of blood, a rummage, a shot, a Stalker at night or a
Fresh's speed to reach `chasing`. Three invariants are pinned by test because each is one
plausible-looking retune from collapsing the ladder again:
`INVESTIGATE_AT ≤ PLAYER_HERE_BONUS < CHASE_AT`, `PLAYER_HERE_BONUS + SCENT_BONUS ≥ CHASE_AT`, and
`SHELTER_DETECT_FLOOR_MAX === PLAYER_HERE_BONUS + SCENT_BONUS`.

The scent draw is now a **gradient** (`scentDraw`), scaled by untreated `woundBurden` up to
`SCENT_FULL_AT` = 40 = a bite's severity. One clean sentence: *a bite is what makes them chase you.*
A laceration (30) draws 11 and leaves the node investigating. `treat` therefore pays twice — it slows
the infection track and it quiets the trail.

### `combat/combat.ts` — escapes obey the roads, and avoidance has a price

- `escapeTargets` drops a blocked route **while any other route is passable** (see §4 — the
  unconditional version the brief asked for is a stranding bug).
- `escapeExtraCost` charges the worn-road hours `move` charges; a forced blocked crossing is charged
  the worst rate the table has.
- Escape labels carry the same road-condition suffix `move` prints, so the hours are never silent.
- `SLIP_COST` **2 → `MOVE_COST + 1` = 3**. `RETREAT_COST` stays at `MOVE_COST`: a slip is careful and
  slow, a retreat is fast and pays in the alerted term instead.
- `combatNarration` now names the loudest term the roll is charging for — *"they have already turned
  toward you"*, *"your pack shifts and clatters"*, *"you are leaving blood behind you"*. **Signpost,
  don't retune.** A calm, unhurt, empty-handed player gets the exact pre-T77 sentence.

### `sim/overrun.ts` — T76's flight, fixed by inheritance

The overrun rolls the same composed read (floored at `OVERRUN_ESCAPE_FLOOR`, which now binds less
often) and pays the same road bill. T76 reused `escapeTargets`, so fixing it here fixed the overrun's
flight without touching that file — exactly what the shared-definition design was for.

### `actions/costs.ts` (new) — a leaf module

`MOVE_COST` and friends moved out of `coreActions.ts` so `combat.ts` can define `SLIP_COST` in terms of
`MOVE_COST` without closing an import cycle (`coreActions` imports the combat layer). Re-exported, so
every existing importer is untouched. Verified: a value-import cycle detector reports **0 cycles**
before and after.

---

## 3. Measured, before → after

Runner committed at **`prototype/harness/measure/t77.ts`** so every number here can be re-derived
rather than taken on trust — a direct answer to the audit's fair complaint that scratch-script figures
are unverifiable. It plays the shipped city, not a fixture. `npx tsx measure/t77.ts [--curve|--roads]`.

The policies are deliberately crude and **bad at the game**: they slip at every opportunity and never
treat a wound. These are worst-case numbers for the stealth path, not a model of skilled play.

| | before | after |
|---|---|---|
| slips at a `chasing` node | **168 / 168 (100%)** | 127 / 151 (84%) — `investigating` reachable at last |
| slip wound rate (avoid policy) | 29.9% | 60.5% |
| retreat wound rate (fight policy) | 44.8% | 76.0% |
| mean composed detection at an escape | 0.254 (base only) | 0.587 |
| escapes saturated at the ceiling | n/a | 3 / 129 |
| **hours dodged vs the same `move`** | **36** | **0** |
| mean end day | 4.0 | 4.0–4.1 |

**The shape matters more than the level.** How the read escalates across a single run
(`--curve`, 40 seeds):

| | n | mean detection | arousal |
|---|---|---|---|
| slip 1 | 40 | **0.414** | `investigating` 40/40 |
| slips 2–3 | 80 | 0.495 | ~half `chasing` |
| slips 4–9 | 237 | 0.649 | 87% `chasing` |
| slips 10+ | 222 | 0.669 | 98% `chasing` |

**The first slip of every one of 40 runs happens at an `investigating` node** — a state that was
literally unreachable before. The read then climbs as the run wears the player down, which is the exact
inverse of the design review's "being hurt makes the world safer" complaint. The stealth path is not
broken: a stealth-only survivor still traverses the whole region and always gets out. Mean slips before
the first parting wound went **4.15 → 2.92**; no run in 40 got through 10 clean slips, before *or*
after.

**Run length did not move** (mean end day 4.0 both ways). At this build's run length thirst kills
before wounds do, so the harsher roll is not yet observable as lethality. Whether 60% is the *right*
number is T59/T60's to settle — the balance passes were deliberately scheduled after the systems work.
What T77 owns is that the number now **varies with the situation**, which it never did.

---

## 4. Corrections to the brief, all measured

1. **`AROUSAL_DETECT` is 5/15/30, not the brief's 10/25/40.** Those are good numbers for a world where
   `chasing` is a spike. It is not one: even with the collapse fixed, the mean arousal term at an
   escape was **38.0 of a maximum 40** and 85% of escapes were from a `chasing` node, because the
   player is almost always bleeding. At +0.40 that is a floor, not a spike — mean whole-roll detection
   **0.716 with 15% of rolls pinned at the ceiling**, i.e. the roll stopped varying, which is this
   task's own failure arriving from the other side. At 5/15/30: mean **0.587**, 2% saturated.
2. **`ALERTED_DETECT` is 15, not 20** — same reasoning, smaller effect.
3. **`woundBurden/10` and `(inventoryWeight − PACK_HEAVY)/10` were re-scaled to percentage points.**
   Read as probability the first is absurd (+4.0 on a number that clamps at 0.9) and the second inert
   (+0.01). Both now land on the same 0–10 point band.
4. **The blocked-route filter must not be unconditional.** The brief asked for `move`'s exact rule.
   PL-M2-05's own recorded text says the hole was *"deliberate so a fight can never strand the player
   behind a blocked road"*, and FR-CBT-05 ("you always get out") is a **Must**. An unconditional filter
   trades one defect for a worse one, so a blocked road is refused only while somewhere else is
   passable — and forcing the last crossing is charged the worst rate the road table has.
5. **`region.fire` is seeded at 0 and written by nothing** — one third of the review's "fast-travel
   network through blocked routes" reading. But see §5: the rest of that claim was mine and was wrong.
6. **PL-M2-02 is only half closed.** Its text is *"couple the T25 zombie state machine **+ types** to
   combat/encounters (zombieState biases danger; **Screamer/Stalker fight differently**)"*. The state
   machine is coupled; **no per-type combat behaviour was added** and the `ENEMIES` table is untouched.
   The Stalker gains a rung a plain node cannot reach; the **Screamer gains nothing specific** — its
   `SCREAM_NOISE` deposit already fed `detectChance` through the noise term before this task. The
   remainder is recorded as **PL-M5-26** and belongs with T80/T82.

---

## 5. Audit — three passes, and passes 1 and 2 caught a blocker I had written into a comment

Two independent adversarial passes (engineering; completeness-and-honesty) plus a verification and
mutation pass.

**The blocker.** The first draft of `escapeTargets` filtered blocked routes unconditionally, and its
comment justified the safety of that with a measurement: *"no route on the shipped content ever
blocks"* — every region at `roads: 100`, `fire: 0`, worst weather adding only 30 against
`ROUTE_BLOCKED_AT` 80. **Both auditors independently proved it false.** `tickWeather` degrades
`RegionState.roads` **monotonically and never restores them** (`roadPressure` 2 under storm, 1 under
snow; `seedWorld` says outright that roads "degrade during play, never tick up on their own"), and
`targetWear` is `(100 − min(roads)) + fire + movementDelta × 15`. Re-measured and now committed in
`measure/t77.ts --roads`: **a route blocks on day 9–10 under sustained storm and day 14–15 under
snow.** Because road decay hits every region alike, when one route blocks they nearly all do at once —
so the unconditional filter could leave a player with `['fight']` as their entire choice list, boxed in
until they died of thirst. Fixed (the §4.4 fallback), and the comment rewritten to say what is actually
true.

**Other findings fixed:**

- `scentDraw` was **not total**. A hand-edited save with a wound missing `severity` makes `woundBurden`
  NaN; `desiredRung(NaN)` fails every comparison and returns 0, so every node the player stands on
  relaxes to `hibernating` — **switching the arousal ladder and this task's own detection term off**.
  The pre-T77 flat bonus could not do that. Guarded, and tested.
- `clampPoints` **failed open** on `Infinity` (reachable: `JSON.parse("1e999")`), reading an infinitely
  bleeding body as unhurt while `scentDraw` read it as fully bleeding — the exact disagreement between
  the two halves the module says must not exist. Fixed; then mutation testing showed the explicit
  `POSITIVE_INFINITY` branch was **dead code** (`Math.min` already did it), so it was deleted and only
  the `NaN` guard kept.
- **T77 created a `feeding` discount.** With presence at 25 the rung *ties* `RUNG.feeding`, so a
  feeding node stayed feeding under the player's feet — and `AROUSAL_DETECT.feeding` (5) is cheaper
  than the `investigating` (15) an ordinary node charges, so standing on a nest mid-meal was safer than
  standing on an empty one. Unreachable today (nothing writes `NodeState.corpses` — PL-M5-25), which is
  precisely why it needed a test. Closed.
- **`stealthTell` was dead code**, exported with a comment claiming it delivered the review's
  "signpost, don't retune" discipline. The player's wound rate had doubled with nothing telling them
  why. Now wired into `combatNarration`, and tested end to end.
- **Three parking-lot ids were cited in code as "recorded" and did not exist** (PL-M5-22/23/24). They
  exist now, along with PL-M5-25/26.
- **Stale prose:** `sim/hordes.ts` still declared that T77 had not yet fixed the route hole; four
  comments still promised "every discovered neighbour"; `overrun.ts` claimed its pacing was untouched
  when flight now pays road costs; `zombies.ts` claimed "arrive bleeding ⇒ chasing" when the gradient
  makes that true only for a bite; the test header claimed *every* test failed against the unfixed code
  when the house-rules block deliberately does not. All corrected.
- **An over-claim, withdrawn.** The `treated < 100` → `isWounded` swap was justified in the comment by
  a bug that does not exist: `treatWound` **removes** a wound at `treated >= severity`, so the two
  predicates agree on every reachable state. The swap is kept as a consistency tidy and the comment now
  says so. Its mutant survives, correctly — an equivalent mutant is not a test gap.
- Dead exports trimmed (`relocatePlayer`, `SCENT_DETECT_PER_BURDEN`, `PACK_DETECT_PER_UNIT` off
  `index.ts`; the unused `StealthOpts.from` knob deleted).
- The **Crawler's grasp** is now clamped with everything else, where it used to be added after
  `detectChance`'s clamp and could reach a *guaranteed* catch (1.05 at a noise-100 node). Slightly
  weaker at the very loudest nodes, far stronger everywhere else. Documented at the constant.

**Pass 3 — mutation testing.** 22 mutants applied and reverted. **20 killed by a named test.** The two
survivors are both correct: the `treated < 100` revert (provably equivalent on reachable states) and,
before it was deleted, the dead `POSITIVE_INFINITY` branch. Three mutants survived the *first* round —
every one of them a fix made in response to the audit **without a test**, which is the T75/T76 lesson
arriving a third time: *a fix without a test is a guess that happens to be right today.*

---

## 6. Declared limits and what this does not do

- **Wound burden is charged twice, on purpose** — once by raising the node's rung (`scentDraw`, worth
  up to a whole rung) and once by its own `scentDetect` term. Blood both rouses the nest and makes you
  trackable; those are different facts. Bounded and stated rather than left to be discovered.
- **`CombatState.alerted` is read in a condition at last, and is still structurally always true** in
  any reachable live fight (`beginCombat` seeds it false; the same turn's strike or shot sets it before
  an escape can be offered). The observable effect today is a flat retreat-over-slip penalty. It
  becomes a real two-valued input when a fight can begin unnoticed — an ambush, or T82's grab.
  **PL-M5-22.**
- **A horde has no arousal state of its own.** The overrun's arousal term reads the node's own
  loiterers, so a mass on an otherwise empty node contributes nothing and the floor carries the roll.
  Right outcome, reached by accident. **PL-M5-23.**
- `sim/director.ts` still uses the old `treated < 100` idiom for `playerDistressed`. Equivalent on
  reachable states; that function's real problem is the threat curve's. **PL-M5-24.**
- The `feeding` rung is **entirely inert** — nothing in the engine writes `NodeState.corpses`.
  **PL-M5-25.**
- **PL-M2-02's per-type combat half is not done.** **PL-M5-26.**
- **Balance is not this task's.** The parting-wound table (`WALKER_WOUNDS`, a bite 1 row in 2) was left
  alone deliberately: detection roughly doubled, so the infection-per-slip rate roughly doubled with
  it, and T76 set the precedent that a mass uses a gentler table for exactly this reason. Retuning it
  here would be fitting a dial to a system that T79–T87 are about to reshape, which is the stated
  reason T59/T60 sit after the systems work. Recorded for them.
