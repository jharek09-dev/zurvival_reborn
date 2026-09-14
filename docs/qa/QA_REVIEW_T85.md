# QA Review — T85 · Base tradeoffs: room slots, the claim salvage, a water source, per-unit purification

**Date:** 2026-09-14 · **Milestone:** M5 (eighth task, seq 108) · **Task:** T85 (design review 2026-09-12, step 12b)
**Requirements:** FR-SHL-01/02/04 (Must/MVP) · FR-ECO-05/06 · FR-CORE-03/04 · FR-UI-02 · GDD Part XI *"the base is a set of choices"* · GDD Part X *"water is the hard bottleneck"*
**Closes:** **PL-M5-56** (the leave-behind question was pressure, not a choice — a claim can now hand you more than the pack will take)
**Part-closes:** **PL-M5-03** (the purify recipes finally have a recurring cost, so `item.charcoal` and `item.fuel` have a sink)
**Opens:** PL-M5-57 … PL-M5-61 (below)
**Status:** DONE
**Not byte-identical**, declared, like T71/T72/T74–T84 — a claim now pays out and a purify converts a batch. Both are gated, so **every existing test passed unedited** (995 of 995 before a line of new test was written).

**CI (clean sandbox):** engine **1049** (was 995 at T84, **+54**) / harness **287** (was 275, **+12**) /
content-loader **23** / testlab **22** / schema gate **176** (was 174 — `recipe.shelter.cistern` + `job.water`) /
a11y gate OK / `tsc --noEmit` clean in all four packages.

**Save schema v10 holds.** One new field, `NodeState.stripped`, **optional and absent-reads-unstripped**
(the T84 `scouted` precedent). `NodeDef.roomSlots` is **content read off the graph and never mirrored
into state** — nothing mutates it, so a stored copy would be dead save state (the T79 `lastVisit` / T84
`richness` precedent). No migration rung.

**Measurement runner committed** at `prototype/harness/measure/t85.ts` (the T77 rule). Every mode runs
unchanged on both trees, so the before/after pairs below line up line for line:

```
npx tsx measure/t85.ts             # structure: the room / recipe / job graph as it actually is
npx tsx measure/t85.ts --tree      # claim (a): what the REACHABLE tree costs, and is anything exclusive
npx tsx measure/t85.ts --jobs      # claim (b): "only 2 of 6 jobs can ever be unlocked"
npx tsx measure/t85.ts --water     # claim (c): the water arithmetic, straight off the constants
npx tsx measure/t85.ts --purify    # claim: purify converts the WHOLE stack for one input cost
npx tsx measure/t85.ts --scavenge  # claim: order:scavenge strictly dominates the jobs system
npx tsx measure/t85.ts --kitchen   # claim: spoilage cannot happen (powerGrid never < POWER_SPOIL_AT)
npx tsx measure/t85.ts --afford    # can the cheapest room's entry fee be paid at all?
npx tsx measure/t85.ts --find      # what a real run actually finds
npx tsx measure/t85.ts --settle    # a GOAL-DIRECTED settler: walk to a safehouse, claim, build
npx tsx measure/t85.ts --ceiling   # an IMMORTAL settler: what does the tree allow, given time?
npx tsx measure/t85.ts --slots     # POST: do room slots bind?
npx tsx measure/t85.ts --cistern   # POST: does the water source change the balance?
```

---

## 1. The brief, interrogated before it was built

**The fifth task running where measuring the premise first changed what got built — and this time the
headline finding is the exact opposite of the brief's first sentence.**

The brief says the base *"is finished on day three and has no decisions in it."* Measured on the
pristine tree, a **goal-directed settler** — the most favourable player the engine permits, walking
straight to the nearest safehouse, searching it clean, claiming it, then building everything the bench
will offer — does this:

```
  claimed a base                39 of 40 runs, mean day 1.6
  rooms standing at the end      0.00   (max 0)      <- ZERO of the seven rooms, in 40 runs
  item.scrap found per run       0.65                <- the cheapest room costs 3
  item.tools found per run       0.00   (0% of runs) <- tools drop only in `industrial`
```

An *undirected* bot claims a base in **0 of 40** (T83's `claimable` rule: 14 of 60 nodes, and not the
start node). **The base is never started, let alone finished**, so slots as the brief framed them would
have constrained an empty set — "a fix that is not measured is a guess" (T76).

| Brief's claim | Verdict |
|---|---|
| The reachable tree is claim + fortify + garden + watchtower = **5 scrap, 2 water, 12 hours**, finished on day 3 | **FALSE, and backwards.** The tree is **7 rooms / 44h / 16 scrap / 2 tools / 2 cloth / 2 fuel / 2 batteries / 2 water**. Five rooms are buildable in a bare shelter, two are gated behind the workshop. And **none of them is ever built** |
| Nothing is mutually exclusive; `NodeState.rooms` is an unbounded array | **TRUE.** A plain array, appended at `economy.ts:398`, with no cap anywhere |
| **"No recipe installs `room.workshop`"** | **FALSE.** `recipe.shelter.workshop` installs it (3 scrap + 1 tools) and has since M4 Part 7. The **third** design-review claim to fail on measurement |
| **"Only 2 of 6 jobs can ever be unlocked"** | **FALSE as stated, TRUE in effect, for a different reason.** All **6 of 6** are graph-reachable (`--jobs`). But `item.tools` drops **only in `industrial`** (0.19/search), a settler reaches an industrial node in **10%** of runs, and found **0.00 tools in 40 runs**. So the workshop is unreachable *in practice*, and with it salvage, generator and radio |
| `item.blueprint.antibiotics` "unlocks nothing" | **FALSE.** It gates `recipe.medical.antibiotics`, which needs `room.medical` — 2 scrap + 2 cloth, buildable in a bare shelter |
| Water's only source is a loot draw in **2 of 6** node kinds | **TRUE.** Clean water: `generic` (0.13/search) and `store` (0.44/search) only. **No job in the game produced water of any kind** |
| Player needs **~0.87/day**, a based resident **~1.2/day**, at **40 relief** against the player's **55** | **ALL THREE EXACT.** 48 thirst/day ÷ 55 = 0.87; ÷ 40 = 1.20; a resident costs **1.38×** what the player does |
| `purify` converts the **entire** carried stack for one set of inputs | **TRUE.** 1 fuel → 1 unit, or 1 fuel → 10 units. The correct play was always to hoard to the pack limit and purify once |
| **`order:scavenge` strictly dominates the jobs system** | **FALSE, and the truth is better.** It nets **+10.2 food/day** — and **−2.4 WATER/day** (`SCAVENGE_EXTRA_DRAIN` 2/h on *both* needs). **The one companion order that produces anything runs on the one resource nothing in the game produces** |
| `job.kitchen` guards spoilage that cannot happen; the grid never falls below `POWER_SPOIL_AT` 40; *"the drain is `trunc(powerPressure*h/6)`, 0 on a 2h turn"* | **Conclusion TRUE, stated cause STALE.** T74 already replaced that truncation with banked hours. But over **2426 turns across 40 runs the grid's floor is 95** — nothing drains it fast enough, so `refrigerated` is always true. (The **pack's** own 48h clock is unaffected and does fire, so canning is not worthless — the *fridge* is) |

**Five of ten claims false or misattributed.** The measurement the brief did not have is the one that
set the task: the base economy has **no entry fee it can pay**.

### The deadlock, stated exactly

> **`job.salvage` produces `item.scrap` and is gated behind `room.workshop`, which costs 3 scrap and an
> `item.tools` that drops only where the player does not go. The job that makes the resource is locked
> behind a room that costs it.**

Per-search yields at a full-stock node (800 direct `resolveSearchLoot` samples per kind, `--afford`):

| kind | items/search | scrap | water | tools | fuel | cloth |
|---|---|---|---|---|---|---|
| generic | 1.00 | 0.20 | 0.13 | — | — | — |
| store | 3.08 | — | 0.44 | — | — | 0.65 |
| medical | 3.85 | — | — | — | — | — |
| police | 2.43 | — | — | — | — | — |
| residential | 2.00 | 0.31 | — | — | — | 0.32 |
| industrial | 2.51 | 0.53 | — | **0.19** | 0.16 | — |

The settler searches **97.5% generic** — 1.00 items per search at 0.20 scrap — because that is where it
is. Runs end **day 3.5** after ~10 searches. Expected scrap over a whole run ≈ 2, against a cheapest
room of 3.

---

## 2. What shipped

### (1) `NodeDef.roomSlots` — a building holds a bounded number of rooms

`sim/rooms.ts` (new). 1–6, clamped on read, default 3, **read off the graph and never stored**. Gated on
`roomSlotsAuthored` — a content set that authors no slots keeps the unbounded array, so every fixture
and every pre-T85 run is untouched. All **60 nodes** authored by what the building actually is.

The 14 safehouses are deliberately **spread**, because they are the only nodes the rule can bind on:

```
  Meridian Tower 5 · Community School 5 · Faculty Housing 4 · Library Stacks 4 · Machine Shop 4 ·
  Fire Station 4 · Foreman's Office 3 · Marina 3 · Maple Street 3 · Rooftop Garden 2 ·
  Observatory 2 · Radio Mast 2 · Chapel of Rest 2 · Corner Chapel 2
```

**Eight rooms in the tree; the roomiest safehouse holds five.** Which building you claimed now carries
three things at once — how many rooms it holds, what its local loot table is, and what stripping it paid.

### (2) The claim strips the building — the entry fee the base economy never had

Claiming already required `searchPct` 100: you have taken the place apart. It bought a flag and nothing
else. Now it pays `trunc(CLAIM_SALVAGE_BASE × richness / 100)` scrap, **reusing T84's authored richness
axis rather than inventing a second one** — Machine Shop (richness 175) pays 7, Maple Street (45) pays
1, a building at richness 24 or below pays nothing at all.

Paid into the **pack**, bounded by `CARRY_CAPACITY`, so T84's pack-weight pressure decides whether you
can carry your own entry fee. **A building is stripped once** (`NodeState.stripped`).

### (3) `demolish` — what makes a slot a decision rather than a trap

2 hours, returns half the room's scrap cost rounded down. A garden installed on day two can become a
cistern on day nine. Without it, slots would be a trap the player cannot see coming.

### (4) A water source: `room.cistern` + `job.water`

3 scrap, bare-buildable. **It collects; it does not purify** — `job.water` banks `item.water-dirty`,
which makes the purify recipes the recurring sink `item.fuel` and `item.charcoal` never had:

```
  a resident drinks 1.20/day of CLEAN water; the catchment banks 8.00/day of DIRTY
    boiled  by recipe.purify.boil     4 crafts/day = 4x fuel/day + 4h of somebody's time
    filtered by recipe.purify.filter  3 crafts/day = 3x charcoal + 3x cloth/day + 3h
```

**That is the game's first real X-or-Y: fuel burned on water is fuel not burned on the generator or on
molotovs.**

**The cistern's cost was set by measurement, not by theme.** A first cut priced it at 2 scrap + 1 cloth —
and it was built in **0 of 40** settler runs, because cloth drops in `store`/`residential` and a settler
reaches those in 12.5% of runs. *The room that fixes the reachability problem had re-created it.* At 3
scrap it is payable out of the claim's own salvage, and it became the **most-built room in the game**.

### (5) Per-unit purification

`RecipeDef.purifyUnitsPerCraft` — boil 2, filter 3. A recipe that authors none converts the whole stack
exactly as before (the content-field gate, the T83 `claimable` shape). The filter yields more per craft
but spends two components against the boil's one, so neither dominates.

### (6) Legibility — the screen acquires the sentence the engine acquired

The T84 dead-affordance lesson, pointed the other way. The base screen used to list every unbuilt room
under **Could build** whatever the building could hold, so a player at a full base read an offer the
bench would refuse and was never told why. Now: `Rooms:` carries *"room for 2 more"* / *"the building is
full — something must come out first"*, and a full base reads *"nothing more will fit. cistern, workshop
and radio would each need a room torn out."* The Scene's base paragraph carries `roomsLine`, in words —
never a bare integer (FR-UI-02). Both new beats read in the log.

---

## 3. What it did to the game

| | PRE-T85 | POST-T85 |
|---|---|---|
| rooms standing at the end of a settler run | **0.00** | **0.63** (max 1) |
| settler runs that build **anything** | **0%** | **65%** |
| `item.scrap` found per settler run | 0.65 | **3.67** (97.5% of runs find some) |
| the most-built room | *(none)* | **`room.cistern`, 47.5% of runs, mean day 2.0** |
| jobs that produce water | **0** | **1** |
| water per fuel, purifying a stack of 10 | **10** | **2** |
| runs ending `dehydrated` | 6 of 40 | **9 of 40** |

The dehydration rise is the per-unit purify doing exactly what it was shipped to do, and it is declared
rather than tuned away: water is now genuinely scarce, and the cistern is the answer to it.

---

## 4. Adversarial audit — findings, and the three defects this task introduced

A full pass over the diff. **Three real defects, all found by this task's own instruments**, and each
fix carries a test written against the unfixed code (the T77 lesson — **fifth consecutive task**, so it
is a rule and not a surprise).

**D1 — THE SALVAGE WAS FARMABLE.** Found by `--ceiling`, which reported rooms *"built in 245% of runs"*:
the immortal bot was claiming, abandoning and re-claiming the same building, because `searchPct` stays
at 100 and nothing recorded that a claim had happened. Fixed with `NodeState.stripped`; the reading fell
to 72.5%. **This is the one honest reason to store rather than derive** — there is no other record.

**D2 — THE SALVAGE BROKE THE PACK-WEIGHT INVARIANT.** `sim/inventory.ts` documents `inventoryWeight <=
CARRY_CAPACITY` as an invariant its own `addItemBounded` preserves, and an unbounded grant in
`claimShelter` was the one hole in it: a near-full pack claiming a rich building ended over capacity.
Now bounded — and **what will not fit is left in the building**, which gives PL-M5-56's leave-behind
(measured by T84 at 0.00 drops across 40 runs) an occasion that forces it. Note the mark is set on the
**claim**, not on what fitted: marking it on `took > 0` would have re-opened D1 (arrive full, claim for
nothing, drop a can, abandon, re-claim).

**D3 — THE CLAIM LINE PROMISED WALLS THAT WERE ALREADY BARE.** After D1's fix, a re-claim pays nothing —
but `shelterLine` still offered *"there is usable material still in its walls"*. A dead affordance in the
prose rather than in a verb. (It also read *"there is enough of usable material"*, which is not English.)

**Three probe defects, each of which would have put a false number in this document:**

- **The immortal settler was not immortal.** It zeroed needs and cleared wounds but not
  `condition.infection`, and all 40 runs duly ended in `infection` at turn ~275 — a probe answering a
  question about the economy with a fact about the bot's blood (the T81 class).
- **The immortal settler measured its own policy.** It sat at its own exhausted base "searching" and
  reported a ceiling of 0.72 rooms that was really a ceiling on where it stood. It now forages and
  walks home when the pack can pay for a room.
- **`--water` asked the wrong question.** It checked for a job producing `item.water` and duly reported
  *"NONE — no job makes water"* on the post-T85 tree, where `job.water` banks `item.water-dirty` on
  purpose. And `--cistern` printed *"supports 6.7 residents"* off the raw catchment rate, which is the
  whole point missed: what it banks is not drinkable, and **the bill is the purification**.

**Investigated and found to be a behaviour, not a bug:** demolishing `room.workshop` leaves a
`room.generator` built through it standing. Defensible — you built the generator; tearing out the bench
does not unbuild it — and it cannot be farmed, since demolition always returns less scrap than the room
cost (asserted as a property).

---

## 5. Mutation testing — 43 mutants, two rounds

**Round 1: 35 of 43 killed.** **Five of the seven first-round survivors in the first batch were tests
that asserted a constant against itself** — `expect(roomSlotsOf(...)).toBe(ROOM_SLOTS_DEFAULT)` cannot
fail when the constant moves. That is T84's `corpses-per-kill-0` defect exactly, and **this is the fifth
consecutive task to hit it**. Seven replacement tests pin the dials by consequence instead: an
unauthored node holds three rooms *and the fourth is refused*; an authored 0 or −99 still leaves a base
that can hold a room; an authored 9999 is still capped below the tree; tearing a room out *moves the
clock*; the salvage truncates rather than rounds (richness 40 → 1, not 2); a homeless player has no
rooms; and building-then-demolishing always loses material.

**Round 2: 6 of 7 re-killed.** Batches 2 and 3 (economy, shelter, the screen): **13/14** and **9/9**.

**Two survivors, each PROVEN rather than excused:**
- `ctl-noop` — the control.
- `purify-made-guard` (`made <= 0` → `made < 0`) — **provably unreachable**: `dirty >= 1` is checked
  above and `purifyBatchSize` floors at 1, so `made >= 1` always. Kept as a total guard, with the proof
  written into the comment rather than an excuse (T84's "dead guards with comments claiming they
  protected something", answered the other way).

The pre-flight residue check earned its keep again, and so did the hazard it guards: **a 10-minute Bash
timeout killed the first sweep mid-mutant and left `salvage-no-richness` applied in the working tree.**
Caught by a full-suite run showing 3 failures, restored, and the sweep re-run in chunks of ≤10 against a
scoped 232-test suite (7.4s a run instead of 32s). **That is the T80 lesson and the T83 recurrence,
hit a third time — chunk before you sweep.**

---

## 6. Declared limits — do NOT re-claim these

- **PL-M5-57 — ROOM SLOTS BARELY BIND, AND THAT IS A MATERIALS PROBLEM, NOT A SLOT-COUNT PROBLEM.** An
  **immortal** settler foraging for 1500 turns ends with **0.97 rooms** (max 2), fills **0%** of its
  base's capacity, and is refused a room by the slot rule in **2 of 40** runs. Slots are all but inert
  today. They are shipped anyway because they are content plus one predicate, they are what makes the
  *claim* a decision, and they become load-bearing the moment the material economy closes — the T77
  guard/T84 `corpses` precedent. But nothing in this document claims they bite yet.
- **PL-M5-58 — `room.workshop` IS STILL UNREACHABLE, AND WITH IT THREE ROOMS AND TWO JOBS.** `item.tools`
  drops only in `industrial`, at 0.19/search, and a settler reaches an industrial node in 10% of runs;
  **0.00 tools across 40 runs, and 0 across 40 immortal runs.** `room.workshop`, `room.generator`,
  `room.radio` and `room.medical` were **never built even immortal**. Fixing it means moving loot
  between node kinds, which is T84's byte-identity hazard (weights are relative), so it is T59/T60's or
  a content task's, not this one's.
- **PL-M5-59 — THE CATCHMENT'S OUTPUT CANNOT ACTUALLY BE PURIFIED.** Boiling its 8 dirty units/day costs
  **4 fuel/day**, and `item.fuel` is found in **5%** of settler runs. The X-or-Y is real and the fuel is
  not there yet. The cistern still pays for itself well below full output.
- **PL-M5-60 — THE KITCHEN'S FRIDGE IS DEAD AND T85 DID NOT REVIVE IT.** `powerGrid` floor over 2426
  turns is **95**; `refrigerated` is always true; `job.kitchen` converts fresh food (60 relief) into
  canned (45), destroying 15 relief per unit against a stash spoilage that cannot happen. Inventing a
  power drain belongs with the director work, not here.
- **PL-M5-61 — `order:scavenge` IS NOT RECONCILED, IT IS EXPLAINED.** Its −2.4 water/day is now
  *answerable* (one worked cistern covers three scavengers) but nothing was changed about the order
  itself, and no measurement here shows a player actually making that trade.
- **INERT IN THE TESTLAB SOAK, for the same measured reason T83 was.** The soak is **byte-identical to
  T84's** — `{lastStand 10, infection 6, dehydrated 8}` / 985 actions / mean day 3.8 — because the four
  policies claim a base in 0 of 32 runs (**PL-M5-50**). A settling policy would make both T83 and T85
  visible there.
- A run still touches ~3 nodes and ends day 3.5 (**PL-M5-54**); run length is T59/T60's.
- `NodeState.stripped` has exactly one writer and two readers (`claimShelter`, `shelterLine`).

---

## 7. Verdict

**PASS.** The brief asked for a base with decisions in it and the measurement found a base with no way
in. Both shipped: the claim now pays the entry fee, the slots make it a choice, the cistern is the first
thing in the game that produces water, and purification is a batch rather than a button. Settler runs
went from **0% building anything** to **65%**. What did not move — the workshop, the slot rule biting,
the fuel to boil a full catchment — is named above with the number that shows it, and is not claimed.
