# QA Review — T84 · Exploration, node identity, and loot as a yield

**Date:** 2026-09-14 · **Milestone:** M5 (seventh task, seq 107) · **Task:** T84 (design review 2026-09-12, step 12a)
**Requirements:** FR-ECO-01/02/03 (Must/MVP) · FR-MAP-02 (Must/MVP) · FR-PLR-03 · GDD Part VII *"the map is a journal … design rule 5: the map records the player's story, in their own words where possible"* · GDD Part X *"rough tiers from common junk to rare finds"*
**Closes:** **PL-M4-46** (the add-a-note verb the map screen had advertised since T54) · **PL-M5-25** (the `feeding` arousal rung, inert because nothing wrote `NodeState.corpses`)
**Part-closes:** **PL-M5-03** (the `minBlood`/`minCorpses` requirement predicates, unused by content — one encounter now uses both) · **PL-M5-41** (weapon placement per node KIND — narrowed, not closed; see *Declared limits*)
**Status:** DONE
**Not byte-identical**, declared, like T71/T72/T74–T83. A search returns a haul rather than a token; that is the task.

**CI (clean sandbox):** engine **995** (was 955 at T83, **+40**) / harness **275** (was 273) /
content-loader **23** / testlab **22** / schema gate **174** (was 173 — one new encounter) / a11y gate OK /
`tsc --noEmit` clean in all four packages.

**Save schema v10 holds.** Two new fields, `NodeState.scouted` and `NodeState.scoutedOn`, both
**optional and absent-reads-as-unscouted** (the T74 accumulator precedent). `NodeDef.richness` is
**content read off the graph and never mirrored into state** — the brief asked for
`NodeDef.richness -> NodeState`, and nothing mutates it, so a stored copy would have been dead save
state and a rung bought for nothing (the T79 `lastVisit` precedent: derive from what content already
says). No migration rung.

**Measurement runner committed** at `prototype/harness/measure/t84.ts` (the T77 rule). It runs
unchanged on both trees, so every before/after pair below lines up line for line:

```
npx tsx measure/t84.ts              # structure: what the loot/fog layers could and could not reach
npx tsx measure/t84.ts --cap        # claim 1: is a node's own contribution really <= 2?
npx tsx measure/t84.ts --tax        # claim 2: is the search roll a tax with no upside?
npx tsx measure/t84.ts --tiers      # claim 3: is a pistol as likely as a bandage?
npx tsx measure/t84.ts --frontier   # claim 4: is the frontier always exactly one hop?
npx tsx measure/t84.ts --deplete    # does a real run ever reach the bottom of a region's stock?
npx tsx measure/t84.ts --consume    # who actually drains it — the player, or off-screen rivals?
npx tsx measure/t84.ts --identity   # how much of the 60-node city does one run touch?
npx tsx measure/t84.ts --haul       # POST: what a search returns, and what it costs the pack
npx tsx measure/t84.ts --rich       # POST: does richness separate two nodes of a kind?
npx tsx measure/t84.ts --aftermath  # POST: corpses/blood written, the feeding rung reachable
npx tsx measure/t84.ts --scout      # POST: does buying the look pay?
```

---

## 1. The brief, interrogated before it was built

The fourth task running where measuring the premise first changed what got built. Three of the brief's
four claims held; one had already been shipped by another task; and the measurement it did not have
reframed which half of the task was worth doing.

| Brief's claim | Verdict |
|---|---|
| Loot is a region pool: `searchYieldCap = trunc(regionLoot/8) − trunc(searchPct/34)`, so a node's own progress subtracts at most 2 from a cap "that starts at 8–10" | **TRUE, with a correction.** The cap starts at **6–10**, not 8–10 — `region.hillcrest` (loot 50) and `region.the-terraces` (55) both start at 6, so a node's own contribution is up to a third of a poor district's cap. 60 nodes resolve to **6** cap classes and **6** table classes across **23** (region, kind) pairs; the largest interchangeable class is **8 `industrial` nodes in `region.ironworks`** |
| The search roll is a tax, not a yield: `drawInt(1, rawCap)` decides the debit, and you always receive exactly ONE item | **TRUE, and now exact.** Items per search flat at **1.00** at every cap, while the mean take runs **1.00 → 5.45**. *The richer the district, the more of the shared stock you burn for the same single item* — an inverted incentive under the whole scavenging loop |
| Make `drawPick` weighted so rarity tiers exist; "today a pistol is exactly as likely as a bandage at 25%" | **FALSE — T81 already shipped this.** On the pre-T84 police table `item.pistol` comes out of **4.2%** of searches against `item.bandage`'s **24.5%**. The residual is narrower and real: **non-weapon items are still exactly uniform** — medical reads 20.9 / 20.4 / 20.0 / 19.6 / 19.1%, so a course of antibiotics is exactly as likely as a bandage |
| The roll burns the finite, **shared** region stock | **TRUE but economically trivial, and this is new information.** The player's searches are **10.4%** of what drains the city (22.6 of 216 points a run). **89.6% is the off-screen contest** — a wall clock the player cannot touch |
| `fogOfWar` reveals 1 hop on arrival, so the frontier is always exactly one hop wide and there is never a routing decision | **TRUE mechanically** — three `discoverAround` callers, radius 1 — but the horizon is not what binds |
| `corpses` / `blood` seeded and never written; `minBlood`/`minCorpses` can never fire | **TRUE.** One writer each, both `map/seedWorld.ts` writing 0. No shipped encounter uses either predicate, so nothing was blocked *in practice* — the gate was a dead predicate waiting for content |
| The add-a-note action the map screen advertises at `screens.ts:730` | **TRUE.** `NodeState.playerNotes` had exactly one writer in the engine: the seed, writing `[]` |

### The measurement the brief did not have, and what it changed

A run **discovers 7.1 of 60 nodes**, **searches 3.23 distinct nodes**, sees **2.98 of 6 kinds**, and
ends on **day 3.6**. Pack load peaks at **19.04 of 40** and PACK_HEAVY is reached on **0.7% of turns** —
so the GDD's *"recurring, honest question: what do I leave behind?"* is, in the shipped build, never
asked at all.

That reorders the brief's three parts:

- **Part 2 (loot as a yield) is the one that pays**, and it pays three systems at once: the roll gets an
  upside, the pack starts to bind, and per-node depth becomes legible **inside a single turn** — the only
  timescale a 3.6-day run has.
- **Part 1 (richness) is right, for a different reason than the brief gives.** The brief wants *"the
  pharmacy at the end of the block is still untouched"* to be a fact the player learns, remembers and
  comes back to. A run that searches three nodes and dies on day four never comes back. What richness
  actually buys is **the pick among the two to four places in front of you right now**.
- **Part 3 (scout) was built, but not as the brief specified.** *"Stop auto-revealing on move"* was
  **refused on measurement**: travel already offers **no choice at all on 52.7% of turns**, `move`
  requires `discovered`, and removing the free reveal would leave a player who does not scout shuttling
  between two nodes — against the testlab's own "availableActions is never empty" invariant, and for a
  wider map the run has no days to walk. The verb ships as **reconnaissance, not fog-lifting**: the
  two-hop reveal is the cheap half, and what it sells is knowing what is standing in the next block.

---

## 2. What shipped

**Per-node loot depth.** `NodeDef.richness` (0–250, default 100) scales the **region's** term of the
yield cap — `trunc(regionLoot × richness / 800) − trunc(searchPct / 34)`, which is the pre-T84 formula
exactly at 100. Behind an **active-system gate** (`richnessAuthored`, the T83 `NodeDef.claimable`
precedent), so a set that authors none computes the identical cap. **All 60 nodes are authored**, from
each one's own description: `node.ironworks.warehouse-row` at 200 (*"everything here comes in bulk"*),
`node.mercy-hospital.pharmacy-wing` at 200 (*"behind every lock the staff had time to throw"*),
`node.the-terraces.overlook-road` at 20 (a switchback with nothing on it).

**Loot as a yield.** The draw is unchanged — one `drawInt(1, rawCap)` on the `loot` stream — but the
number it produces is now the **haul** rather than the **fee**: `ceil(points / LOOT_POINTS_PER_ITEM)`
items, each drawn from the table, and the region is debited by what was actually carried away. The
**full-pack rule is preserved exactly, generalized per unit**: the first thing that will not fit ends
the haul, the rest stay in the world, and the region is debited only for what left it.

**Ordinary-item tiers.** `ITEM_LOOT_WEIGHT` tiers the non-weapon rows against each other —
**normalised** by `tieredOrdinary` so each table's ordinary total stays exactly `rows × BASE_LOOT_WEIGHT`,
which is what keeps T81's swept weapon rates intact (see *Defects*, #2).

**The `scout` verb.** One hour, no noise, two hops. Reveals and **marks looked-at**; travel choices then
report what is standing in a scouted neighbour, and the mark **goes stale** after `SCOUT_MEMORY_DAYS`.

**The map journal.** `add-a-note` — free, one contextual phrase at a time, chosen from the node.

**Aftermath.** `killEnemy` writes `corpses` +1 and `blood` +18; blood fades 2/hour (on-screen and
off-screen alike), corpses never. One new encounter, `encounter.common.the-killing-floor`, is gated on
`minCorpses: 2 · minBlood: 10 · maxWalkers: 0`.

---

## 3. Measured: before → after

| | pre-T84 | post-T84 |
|---|---|---|
| items per search (probe, cap 10 → cap 1) | **1.00 flat** | **2.96 → 1.00**, scaling with the cap |
| region points paid per item (cap 10 → cap 1) | **5.45 → 1.00** | **2.67 → 1.00**, roughly flat |
| distinct yield caps in a region | **1** | **6–10** |
| cap spread within an interchangeable class (same kind, same district) | **0.00** | **5.54** over 13 classes |
| `region.ironworks`, its 8 `industrial` nodes | 7 / 7 / 7 / 7 / 7 / 7 / 7 / 7 | **15 / 13 / 12 / 11 / 10 / 9 / 8 / 4** |
| mean cap across the city | 6.62 | **6.67** — the authoring redistributes, it does not buff |
| pack load peak (of 40) | **19.04** | **22.57** |
| turns at or over PACK_HEAVY | **0.7%** | **14.3%** |
| node-turns at `zombieState: "feeding"` | **0, by construction** | **345 of 2198** |
| bodies left on the map per run | 0 | **5.22** across 2.65 nodes |
| runs where `the-killing-floor` fires | unreachable | **30 of 40** |
| `NodeState.playerNotes` writers | **1** (the seed, writing `[]`) | 2 |

**Does scouting pay?** A bot that looks before it walks against one that never does, 120 runs a side
(the honest N — a 40-run reading showed no survival difference and was noise):

| | scout | blind |
|---|---|---|
| mean end day | **4.2** | 3.8 |
| fight actions | **8.7** | 12.1 |
| walked into the dead | **1.84** | 3.08 |
| nodes on the map | **10.9** | 8.3 |
| runs ending in a Last Stand | **53%** | 69% |

---

## 4. Dials — every one swept by rebuild

**`LOOT_POINTS_PER_ITEM` = 3.** The pack is the competing pressure.

| points/item | items per search | pack mean | turns ≥ PACK_HEAVY | full-pack turns |
|---|---|---|---|---|
| 2 | 1.41 | 25.23 | 29.1% | 0.1 |
| **3** | **1.15** | **21.99** | **11.4%** | 0.0 |
| 4 | 1.01 | 20.28 | **0.7%** | 0.0 |
| 6 | 0.94 | 19.64 | 0.6% | 0.0 |

**4 and 6 are dead knobs** — they reproduce the pre-T84 reading (19.04 / 0.7%) almost exactly, i.e. at a
divisor of 4 or more this task does nothing in play. 3 is a 16× lift on the measured symptom without
ever pinning the pack full; 2 is a 41× lift and reaches a full pack in one run in ten. **3** is the
conservative end of a live range, which is the right choice for a systems task — forcing the
leave-behind *choice* is a balance question and T59/T60 owns it.

**`BLOOD_PER_KILL` = 18**, against the one thing that reads it:

| blood/kill | eligible node-runs for `the-killing-floor` | runs where it fired |
|---|---|---|
| 6 | **2** | 2/30 |
| 12 | 50 | 20/30 |
| **18** | **49** | **20/30** |
| 30 | 49 | 20/30 |

**6 is a guillotine** (two kills reach 12 and decay past the threshold within the hour). **12, 18 and 30
are indistinguishable on every consequence the build can currently read.** 18 is chosen for how long a
single kill stays visible — nine hours against six at 12 — which is **a claim about headroom for a
second reader, not a measured improvement over 12**, and it is worth saying which of those it is.

**`SCOUT_COST` = 1.** A dearer look avoids more and survives less — walk-ins 2.17 / 1.83 / 1.60 at
1 / 2 / 3, end day 4.2 / 4.1 / 3.9. The hour comes straight out of the needs clock.

**`SCOUT_HOPS` = 2.** Close to a dead knob on outcomes (end day 4.2 / 4.2 / 4.0 at 1 / 2 / 3); what it
moves is the map (9.4 / 11.3 / 13.3 nodes). 2 is the design reason, not a measured optimum: one hop
further than arriving already gives you free.

**The richness form was chosen by measurement, not by taste.** Scaling the whole expression against
scaling the region's term only:

| variant | zero-cap (node, searchPct) pairs of 180, at stock ×1 / ×0.75 / ×0.5 / ×0.35 | mean cap ×1 | class spread |
|---|---|---|---|
| pre-T84 | 0 / 0 / 0 / **32** | 6.62 | 0 |
| whole-expression | 2 / 10 / 31 / 77 | 6.19 | 5.31 |
| **region-term (shipped)** | 11 / 21 / 38 / **63** | **6.67** | **5.54** |

Neither reaches zero — **and neither does the pre-T84 tree**: a thinned district has always been able to
offer a search worth nothing. The region-term form redistributes a district's yield rather than
shrinking it, separates two nodes of a kind further, and degrades more gracefully exactly where a real
run lives. The early-game cost is paid in words instead: a search at a zero cap is labelled **"it looks
stripped"**. It is deliberately still offered — searching is the only way to reach `searchPct` 100,
which is what claiming a safehouse requires, so withdrawing it would strand a node in a thin district.

---

## 5. Defects this build introduced, and what found them

Nine real defects, from a 29-finding adversarial audit of the finished tree.

1. **`NaN` reached the save as `null`, in the same shape T83's audit found one task ago.**
   `clampNodePct(undefined + 1)` is `NaN` — `Math.min`/`Math.max` do **not** scrub it — and the poison is
   *absorbing*: every later kill keeps it `NaN`, and it silently switches off every reader T84 had just
   given these fields. A string was worse: `"3" + 1` clamps to a plausible **31**. Fixed by making the
   clamp total *and* scrubbing the existing value **before** the increment, so a kill on a junk node
   still leaves a body rather than a scrubbed 0.
2. **The tiering silently re-weighted every weapon and undid T81's measured sweep.** Weights are
   relative, so cutting the ordinary rows shrank each table's denominator. Caught by re-running **T81's
   own instrument** on both trees: the firefighter's axe went **32.5% → 43.5%** — past the 41% that T81
   had explicitly *rejected* when it swept that dial — and `item.pistol`, which T81 brought from 24.6%
   down to ~4.2%, was back up at 7.8%. Fixed by normalising each table's ordinary total to exactly what
   it was (`tieredOrdinary`), which restores the axe to **29.5%** and the pistol to **4.8%**.
3. **The byte-identity claim was false, and asserted in four places.** The gate pins the *cap*; it
   cannot pin the run, because the draw count per search is now variable. Every claim rescoped.
4. **The first fix for the zero-cap searches made them worse.** An audit measured 2 of 180 zero-cap
   pairs at full stock under the whole-expression multiply; "fixing" it by moving the multiply to the
   region term produced **11**. Measured both rather than guessing again (table above) and kept the form
   that is better where a run actually lives, plus the label.
5. **Blood never faded off-screen.** `advanceWorld` decays noise and nothing added blood, so a played
   hour and a fast-forwarded hour did not cost a node the same thing — the T74 invariant.
6. **Walking gave away the whole return on the `scout` verb.** `isScouted` read
   `scouted === true || lastVisit !== null`, so a player who had once stood anywhere got intel on
   everything beside it — and the label read the **live** walker count, so a node glanced at on day one
   reported its day-four population. Now an explicit mark written by `applyMove`, with a freshness window.
7. **Six note choices flooded the Scene.** Caught by `loop.test.ts` before it reached a measurement: it
   would have handed a random-picking bot a proportionate chance of journalling instead of playing —
   the T81 probe-defect class. One contextual note instead.
8. **The map screen silently removed information** it used to give (walker counts on any discovered
   node). That removal is the *point* — it is what `scout` now sells — but it is a removal, and it was
   undeclared until the audit named it.
9. **Three dead guards with comments claiming they protected something.** An exhaustive probe over
   `offered` 1..60 showed the debit's `Math.max(1, Math.min(offered, …))` could never engage either way.
   Removed; the arithmetic already gives what the comment promised.

Sixteen further findings were **doc corrections** — claims asserted in comments that were not true of the
code as written, including *"a gunshot is gone in twenty hours, what a fight left on the floor takes the
better part of two days"* (it is nine hours), *"the only verb in the explore branch that leaves nothing
behind"* (`rest`, `eat`, `drink` and `treat` are all silent too), *"all six phrases"* (there are four),
and a claim that the pack had become "a decision" against the same instrument recording **0.0 full-pack
turns and 0.00 drops** across 40 runs.

**One audit finding was investigated and refuted rather than accepted.** The audit read the newly-live
`feeding` rung as an undeclared stealth discount — killing at a node making it easier to sneak past
forever. It is not: `stealthRead` reads the node the player is **standing in**, and T77's guard refuses
to let a node stay `feeding` while they are in it. T77 wrote that guard against a rung that was then
unreachable; **T84 is what makes it load-bearing**, and `sim/zombies.ts` now says so instead of still
claiming the rung is inert.

---

## 6. Mutation — 53 mutants, three rounds: 36/53 → 11/17 → 3/3

Round 1 killed **36 of 53**. Round 2 added nine tests and killed **11 of the 17 survivors**. A third
round of 4 covered code the round-2 fixes had *moved* — the T83 discipline that a mutation score is a
measurement of the tests at one instant — and killed 3, the fourth being a guard the run proved
redundant, which was then deleted rather than left in with a comment claiming it did something.

**Six of the seventeen round-1 survivors were audit fixes shipped with no test of their own**
(`clamp-not-total`, `clamp-no-prescrub`, `offscreen-no-blood`) or test defects that could not have
failed (`corpses-per-kill-0` asserted `toBe(CORPSES_PER_KILL)` against an initial value of 0 — a
constant against itself; `within-unsorted` used a line graph where walk order *is* sorted order). **This
is the T77 lesson, hit for the fourth consecutive task** (T82, T83, now T84). It is stable enough to be
a rule rather than a recurring surprise: **an audit fix is a change like any other and does not get to
skip the suite.**

The five surviving mutants, each accounted for rather than excused:

- **the intentional no-op control.**
- **`LOOT_POINTS_PER_ITEM` 3 → 2** — a balance dial with no behavioural contract. The tests are written
  *relative to it* (`unitsForPoints(p) === ceil(p / P)`), which is correct: its value is justified by the
  published sweep above, and pinning it in a test would be a constant against itself.
- **`Math.min(regionLoot, cap)` removed** — PROVEN unreachable: `cap ≤ trunc(loot × 250 / 800) =
  trunc(0.3125 × loot) ≤ loot`. It is a backstop tied to `RICHNESS_MAX` and starts binding the moment
  that ceiling passes 800.
- **`Math.max(1, …)` in `tieredOrdinary` removed** — PROVEN unreachable for any table drawn from the
  shipped weight range: the smallest apportioned share is at least `floor(min × BASE / max) = floor(4 ×
  18 / 30) = 2`.
- **`found.length === 0 ? 0 : …` removed** — PROVEN equivalent: `offered ≥ 1 ⇒ units ≥ 1`, so an empty
  haul cannot equal `units` and the fallback yields `0 × P = 0`.
- **`params: { noise: 0 }` removed from the scout action** — PROVEN equivalent: `noiseOf` returns
  `NOISE_REST` (0) for any type it does not name, and it does not name `scout`. The explicit parameter
  is kept as a statement of intent.
- **`noteFor`'s `notes.length >= NOTE_MAX_PER_NODE` guard removed** — PROVEN unreachable while the
  offered vocabulary (4 phrases) is smaller than the cap (6).

The runner does a **pre-flight residue check** — every mutant's original text must be present before a
single one is applied — and runs in chunks of ≤14. It earned its keep: after round 2 it correctly
refused to run the round-1 list, because three of those mutants targeted code the totality fix had
changed.

---

## 7. Declared limits — do NOT re-claim these

- **PL-M5-53 — the player is 10% of the loot economy.** Off-screen rivals drain **89.8%** of what a run
  consumes (204.7 points against the player's 23.3). "The search roll taxes a finite, *shared* stock" is
  true and economically trivial: the shared half is a wall clock the player cannot influence. Whether
  that is right is a balance question for T59/T60; it is recorded here because this task measured it and
  did not change it.
- **PL-M5-54 — a run still touches three nodes.** Post-T84: **3.15 distinct nodes searched**, **2.85 of
  6 kinds**, mean end day **3.9**. Sixty nodes of authored richness are read by a run that visits five
  percent of them. Per-node identity is now *in the build*; whether a player ever sees enough of it to
  learn the city is a run-length question, and run length is T59/T60's.
- **PL-M5-55 — nothing narrates a haul.** `SearchHaul` carries `found` / `offered` / `taken` /
  `packFull` and `applyPlayerAction` takes `.state` and drops the rest, so the player learns what a
  search returned by reading their pack. The one player-facing consequence this task did owe them — a
  word for "there is nearly no room left" — ships in `sceneOf`. A find list is a narration task.
- **PL-M5-56 — the leave-behind question is pressure, not yet a choice.** PACK_HEAVY on **14.3%** of
  turns against 0.7%, but **0.0 full-pack turns and 0.00 drops taken** across 40 bot runs. The pack is
  now something a run notices; it is not yet something a run has to answer.
- **PL-M5-41 is narrowed, not closed.** The firefighter's axe still comes out of the `police` *kind*, so
  city hall and the evac checkpoint can yield it. Richness makes `node.the-terraces.fire-station` (170)
  the **best** place to look for it rather than the *only* one. Node-specific placement is still a real
  axis and still unbuilt.
- **`BLOOD_PER_KILL` above 12 is a near-dead knob** for the only reader that exists today.
- **`blood` has exactly one reader** — the authored `minBlood` gate. `corpses` has two (the `feeding`
  rung and `minCorpses`). Both are now live rather than seeded-and-forgotten, which is the claim; that
  is not the same as saying either is deeply consumed.
- **`nodesWithin` ignores route conditions**, so `scout` sees past a blocked or flooded road the player
  cannot walk. Looking around a corner does not require walking it, so this is left as designed — but it
  is a real asymmetry with `move`, which does check.
- **The ordinary-item tiers are gated on the weapon pool.** `lootEntriesFor` is only reached when a
  weapon content set is registered, so a set with recipes and a radio but no weapons draws a flat
  ordinary table. The gate belongs to a different system than the feature; it is where the gated table
  builder already was.
- **Richness is content read off the graph, never state.** A run cannot change how deep a place is, only
  how picked over it is. "The pharmacy is still untouched" is therefore a fact about the world, not a
  thing the world can learn.

---

## 8. Definition of done

- [x] `docs/status.json` — task note, `parkingLot` stamps, `updated` banner
- [x] `docs/qa/QA_REVIEW_T84.md` (this file)
- [x] `CHANGELOG.md` entry
- [x] Full CI green in all four packages + both gates + `tsc --noEmit`
- [x] Measurement runner committed and re-runnable on both trees
- [x] Adversarial audit of the finished tree (29 findings, 9 real defects, 1 refuted with a probe)
- [x] Mutation sweep with a pre-flight residue check; every survivor accounted for
- [x] Verified `git format-patch` at `.sandbox/T84.patch`
