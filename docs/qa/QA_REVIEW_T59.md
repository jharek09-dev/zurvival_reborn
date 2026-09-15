# QA Review — T59 · Staged balance pass 1: survivability & scarcity

**Task** T59 (M5, `seq` 113) · **GDD XVI** "Balancing method / Design rules for balance" · **PRODUCTION §8**
staged balance passes 1–2 · **FR-SIM-08** · **FR-ECO-05** · **FR-INJ-04**
**Date** 2026-09-15 · **Build** on T62 · **Closes** PL-M4-16, PL-M4-22 (part), PL-M4-31 (part), PL-M4-37 (part),
PL-M4-40 (part), PL-M5-27, PL-M5-50 · **Re-scopes** PL-M4-54 to T60 · **Declares** PL-M5-76..80
**CI** engine **1339** · harness **346** · content-loader 23 · testlab 22 · schema 190 across 17 types · a11y OK
**Runner** `prototype/harness/measure/t59.ts` (7 modes; asserts nothing, CI does not run it; runs line for
line in **both** trees, so every before/after column below is the same instrument twice)

> **This is the first M5 task that deliberately breaks run-level byte identity.** A balance pass changes
> what runs do; that is what it is for. Nothing here claims to be byte-identical and no gate pretends
> otherwise. What is pinned instead is the **change set** — every constant that moved is enumerated in
> §9, every one of them is covered by a mutant in §8, and 14 existing tests moved with reasons recorded
> in the tests themselves.

---

## 1. The thesis, and the measurement that produced it

**The run is bounded by a water budget of about two and a half units. Because every counterplay in the
game is priced in hours, and every hour is priced in water, every other dial in the game measures
inert.**

That sentence is the whole task. It was arrived at by sweeping dials one at a time against 96 bot runs
across four policies, on the pristine tree, and finding almost all of them dead:

| rebuild sweep (pre-T59 tree) | mean run |
|---|---|
| *(control — proves the instrument)* `HUNGER_RATE` 1 → 12 | 43.3 → **15.6 turns, 95 of 96 runs `starved`** |
| `REST_RECOVERY` 45 → **5** | **byte-identical to doing nothing** |
| `REST_RECOVERY` 45 → **80** | **byte-identical to doing nothing** |
| `FATIGUE_RATE` 2 → **1** | **byte-identical to doing nothing** |
| `FATIGUE_RATE` 2 → **8** | 43.3 → 43.4 |
| `DRINK_RELIEF` 55 → **80** | **byte-identical** (everything above the offer threshold is clamped away) |
| `LOOT_CONTEST_DIVISOR` 50 → 150 | 43.3 → 43.5 |
| `LOOT_POINTS_PER_ITEM` 3 → 1 | 43.3 → 45.6 |
| `searchYieldCap` denominator 800 → 300 | 43.3 → 46.2 |
| `SEARCH_GAIN` 34 → 17 | 43.3 → 45.4 |
| `item.water` loot weight 18 → 40 | 43.3 → 44.1 |
| `LAST_STAND_AT` 80 → 140 | 43.3 → 47.5 |
| `THIRST_RATE` 2 → 1 | 43.3 → 51.0 |
| **thirst AND hunger switched off entirely** | the `medic` policy still dies of **infection 24 of 24** |

Two things fall out of that table and both shaped the build.

**Fatigue is a dead Survival-Triangle corner.** Its rate can be quartered or quadrupled and its recovery
cut ninefold, and *no measured outcome changes*. `NEED_FATAL` does not apply to it; nothing in the engine
reads `needs.fatigue` for a combat, stealth, carry or accuracy malus. A rest bought back a number nothing
spends. GDD XVI rule 2 says *"no strategy escapes the Survival Triangle; every corner has a price"*, and
one corner had none.

**The supply side is worth about three turns.** Every scarcity dial moves the run by 2–3 turns alone,
because the player only searches 3.5 times in a whole run. Tripling the yield of 3.5 searches is nothing.

---

## 2. The demand/supply ledger, and the three counterplays that do not exist

`measure/t59.ts --water` and `--slip`, pre-T59, 120 runs across five policies:

| clock | demand a run | supply a run | ratio |
|---|---|---|---|
| thirst | 1.67–3.00 water drunk | **0.00–1.00 found** | up to 4.2 : 1 |
| hunger | 1.13–2.96 rations eaten | 0.00–0.96 found | 2.1 : 1 |
| wounds | **5.79** taken by a bot that never fights | **0.13 medical items** | **45 : 1** |

- A run spends **28.2–39.4% of its turns holding an empty canteen**. "The last can" is not a moment; it
  is the second half of every run.
- `starved` fires in **0 of 120 runs**. Food is not a clock: a ration buys 45 hours against water's 27.5,
  and a run is 89 hours long.
- A **cautious** bot — never enters a fight, slips away from everything — takes 5.79 wounds and 1.17
  bites a run and finds **0.13** medical items, so it treats **0.00** times and ends at a wound burden of
  **157.7** against a Last Stand line of 80. It has done nothing wrong.
- `item.antiseptic`, the cure for the commonest thing that kills you, comes out of a search **0.08** times
  a run. `item.fuel` 0.02. `item.tools` 0.02.

### The purify bridge existed and had no deck

`recipe.purify.boil` / `recipe.purify.filter` turn `item.water-dirty` — **the commoner find of the pair,
0.57 a run against clean water's 0.42, in hand on 36–55% of every run's turns** — into water you can
drink. Measured pre-T59: **offered 0.00 times and taken 0.00 times, in every one of 120 runs.**

Two gates bound it in series, and the measurement separates them cleanly:

| policy | carried a filter's components alongside dirty water | had a bench |
|---|---|---|
| `medic` | **4.50 turns a run** | **0% of runs** |
| `settler` | **0.00 turns a run** | **83.3% of runs** |

`craftable` gated *every* category on `atWorkbench`, so boiling a canteen over a fire required a claimed
safehouse — while both recipe files say *"known from the start"*. And the filter's two components dropped
in **disjoint node kinds** (charcoal in generic/industrial, cloth in store/residential), which is the T85
cistern defect exactly, one task later, in the recipe that matters most.

---

## 3. THE CITY ALREADY SAYS WHERE ITS WATER IS. NOTHING HAD EVER ASKED.

`RegionState.water` and `world.water` have been in the shape since T3. Before T59 they had **no reader
anywhere in the engine** — seeded, saved, and never consulted. So **FR-SIM-08** (*"global infrastructure
decay: power, water, roads, bridges"*) was two-thirds implemented: the grid drains, the roads wear, and
the water simply sat there. The 2026-09 design review's dead-wiring list missed it; this is the eighth
entry on that list, after T62's.

The districts are authored, and they are not the same: downtown 10, rivermouth 20, mercy-hospital 30,
the-terraces 45, ironworks 55, hillcrest 80.

**T59 reads them.** A district's water scales exactly one loot row (`item.water`, and deliberately not
`item.water-dirty` — there is always a puddle; what a district decides is how much of its water you can
drink without boiling it), the stock is **finite and debited** at 4 points a unit exactly as loot is, and
`world.water` falls with `world.powerGrid` on the grid's own banked clock, because pumps need power.

| district | authored | weight of `item.water` | stock (units) |
|---|---|---|---|
| downtown | 10 | 9 | 2 |
| rivermouth *(start)* | 20 | **19** | 5 |
| mercy-hospital | 30 | 28 | 7 |
| the-terraces | 45 | 43 | 11 |
| ironworks | 55 | 52 | 13 |
| hillcrest | 80 | **76** | 20 |
| | | | **58 total — about 66 player-days** |

The number worth noticing is rivermouth's **19 against the pre-T59 flat 18**. T59 does not make the
opening drier. It makes the rest of the city wetter, and gives the player a reason to cross it.

---

## 4. What shipped

Eleven changes, in the order they depend on each other. Every one is a dial or a wiring; none adds state,
and the save schema does not move.

1. **Water is a property of place.** `drinkableWaterOf(region, world)`, `CLEAN_WATER_ITEM`,
   `WATER_LEVEL_NEUTRAL` 50, `WATER_POINTS_PER_UNIT` 4, `DEFAULT_REGION_WATER` 50.
   `itemLootWeight(id, level?)` scales one row, linearly, with a floor of 1 that engages.
2. **The mains follow the grid**, monotonically, on the existing `powerDrainHours` bank. No new clock.
3. **`item.water` is tiered at 48**, where it had fallen through to `BASE_LOOT_WEIGHT`'s 18 — *below*
   `item.water-dirty`'s junk tier of 28. T84 wrote that by accident when it tiered the junk.
4. **Purification left the workbench** (`BENCHLESS_CATEGORIES`). Exactly one category wide.
5. **`item.cloth` joins the generic loot table**, so the filter's two components share a node kind.
6. **The two purify recipes stop dominating each other**: boil 2 → **4** units (rare, heavy, one
   component, big batch), filter stays at **3** (common, light, two components, smaller batch).
7. **A search pays a haul**: `searchYieldCap` denominator 800 → **400**, `LOOT_POINTS_PER_ITEM` 3 → **2**,
   and `LOOT_CONTEST_DIVISOR` 50 → **120** so the city does not strip itself first.
8. **Six searches to a node, in the same six hours**: `SEARCH_GAIN` 34 → **17** with `SEARCH_COST` 2 → **1**.
   The node's time economy is *identical*; the player gets six decisions where they had three. This is the
   only lever in the build that buys run length in decisions without buying it in survival hours.
9. **A relief is offered at its own value** (`reliefOfferAt`, `RELIEF_OFFER_CEILING` 70), computed from the
   relief the run will *actually* apply (i.e. through the difficulty dial).
10. **Stopping is worth something**: `REST_WOUND_CARE` 4/hour, capped at `REST_WOUND_CARE_MAX` 16 per stop.
11. **PL-M5-27**: the parting blow gets its own `PARTING_WOUNDS` table, one bite in four.

### On FR-INJ-04, head on

FR-INJ-04 is *"health is treated, not **auto**-regenerated"*, and GDD Part VI says in the same document
*"Health is restored by treatment and rest, not by walking it off."* T59 reads `auto` as the operative
word. Care is applied **only** for an action the player deliberately chose — `rest`, `sleep`,
`quarantine` — each of which costs hours, and every hour costs hunger, thirst, the director's drift, the
region's contest and a night moving closer. Time still heals nothing. Walking still heals nothing.

`wounds.test.ts` now holds **both** halves of that reading, which is strictly more than the pre-T59 pair
asserted: *walking it off does nothing*, and *care only ever comes from a turn the player spent stopping*.

---

## 5. Results

`measure/t59.ts`, 120 runs across five policies, same instrument on both trees.

| | pre-T59 | post-T59 |
|---|---|---|
| mean run | 43.8 turns | **51.3** |
| median run | 44 turns | **51** |
| mean end day | 3.71 | **4.17** |
| turns holding an empty canteen | 28.2–39.4% | **6.4–20.0%** |
| water found per day (settler / medic) | 0.15 / 0.22 | **0.65 / 0.54** *(need: 0.87)* |
| searches a run | 3.5 | **6.2** |
| items a run | 4.2 | **9.8** |
| items per search | 1.20 | **1.58** |
| mean search cap where the player stands | 4.45 | **9.15** |
| **purify taken a run** | **0.00 in every one of 120 runs** | **0.13 – 0.67** |
| commonest death | `dehydrated` **45.0%** | `lastStand` **40.8%** |
| death causes represented | 3 of 4 (`starved` never) | **4 of 4** |
| turns at or over `PACK_HEAVY` (settler / medic) | 0.9% / 6.1% | **38.9% / 61.1%** |
| `world.water` after an immortal 200-day run | **100.0** (dead) | **6.5** |
| a district strips itself (idle) — the two liveliest | day **2.1 / 2.3** | day **5.0 / 5.6** |
| bite share of a *detected slip* (drifter / medic / forager) | 58.3 / 49.2 / 28.6% | **18.2 / 15.9 / 20.8%** |

**The testlab soak moved for the first time in six tasks.** PL-M5-50 records T83, T84, T85, T86, T87 and
T62 all landing byte-identical in the Lab (`{lastStand 10, infection 6, dehydrated 8}`, 985 actions).
T59 reads **`{dehydrated 14, infection 4, lastStand 6}`, 1092 actions, 257 encounters** — because unlike
every task in that streak, this one changes dials the Lab's four policies actually touch.

### Two things got harder, on purpose

- **The pack finally binds.** T84 shipped the haul and declared honestly that the leave-behind *choice*
  was not yet forced (0.0 full-pack turns, 0.00 drops). It is forced now: 26.6–61.1% of a run's turns are
  spent at or over `PACK_HEAVY`, peak load 33.3 against a capacity of 40.
- **A safehouse costs six searches.** The settler policy's claim rate falls 83.3% → 62.5%. Paid
  deliberately for the decisions, and measured rather than discovered later.

---

## 6. What this pass does NOT fix, stated plainly

**A run is 51 turns, and the GDD asks for two to six hours.** That is the honest headline and it is not
close. The reason is structural rather than a dial that was missed: the run is the **minimum of four
independent clocks of roughly the same length** — thirst, hunger, infection, and the Last Stand — and
each of their counterplays is supply-limited by a run that is too short to gather supply. Removing one
clock exposes the next; the sweep table in §1 shows it happening (halving thirst moves `dehydrated` 35 →
13 and `infection` 9 → 27). With thirst and hunger switched off *entirely*, the `medic` policy still dies
of infection 24 times out of 24.

So T59 moves the curve as far as survivability and scarcity dials honestly can — **+17% mean, +16%
median, the dry share down three- to fivefold, the core verb nearly doubled, and a whole recipe family
brought back from nothing** — and hands the remainder to T60 and to the owner as a decision rather than
a dial. The measured remainder is:

- **the mortality curve** (PL-M5-62 / PL-M5-65, and now PL-M5-76): five tasks have declared into it;
- **the medical economy** (PL-M5-77): 0.75 medical items a run against 10–17 wounds is still 15 : 1;
- **`LAST_STAND_AT`** unscaled by difficulty (PL-M5-45, sixth consecutive task to say so).

---

## 7. The adversarial audit — 20 real findings, every one fixed or declared

An adversarial audit of the first cut returned **20 REAL findings and 3 plausible**, reproducing most of
them. Nine of the twenty were defects in the code and eleven were claims the code made about itself that
were not true. The nine worst:

1. **THE DISTRICT WATER STOCK WAS DECORATIVE.** The first cut used a compressed ×0.5–×1.5 spread, so a
   district the engine said was empty still weighted `item.water` at **24 — above the pre-T59 flat 18** —
   and 200 searches at `region.water: 0, world.water: 0` pulled **147 clean units out of a stock of
   zero**. The finite-water claim was false, and the `Math.max(1, …)` floor was dead code justified at
   length. Fixed by going linear: the floor engages, the stock is real, and rivermouth still reads 19.
2. **A NaN INTO THE SAVE — THE THIRD IN THREE TASKS, AND THE SECOND IN THIS ONE.** The new
   `region.water` debit used the module's non-total `clampPct` **four lines below a comment explaining
   why `waterPct` exists**. A hand-edited `region.water` of NaN reached `JSON.stringify` and serialised
   as `null`. The lesson is sharper than "clamp your inputs": T59's own test had already caught the same
   hole on the *read* path, and the defect was on the **write** path. If a field can come out of a save,
   clamp it totally on both.
3. **A FORGED `craft` RODE A BENCHLESS `purify` RECIPE ACROSS THE MAP.** `assertLegal` only compares the
   `choiceId`, and `resolveEconomyAction` never asked whether the *verb* matched the recipe's *category*.
   Unreachable before T59 (every verb needed the bench); opened by making one category benchless.
   Reproduced: it burned the fuel, purified nothing, and wrote a `craft.done` beat into the append-only
   Living History. This is T87's forged-project finding in a smaller key, and the same fix — re-derive
   the verb from the data.
4. **A NIGHT'S SLEEP OUT-HEALED THE BEST MEDICAL ITEM.** `REST_WOUND_CARE` was swept for a four-hour
   rest (16) and then applied per hour to every stopping action alike: `quarantine` 32, `sleep` **36**,
   against `TREAT_CARE`'s 25 — free, repeatable every night, in the pass whose entire scarcity thesis is
   that medical items do not exist. `quarantine` also double-dipped, curing the infection *and* closing
   the bite driving it. Capped at `REST_WOUND_CARE_MAX` 16.
5. **THE OFFER THRESHOLD IGNORED THE DIFFICULTY DIAL IT WAS DERIVED FROM.** `reliefOfferAt` used the raw
   constant while `drink`/`eat` apply `scaleInt(relief, needRelief)`. Story poured 22.5% of the canteen
   away after all; Nightmare withheld the prompt for 17 points of thirst it did not need to — a
   survivability regression on the hardest mode, inside the survivability pass. The doc's own selling
   point ("raise `DRINK_RELIEF` and the prompt follows it for free") was exactly the bug.
6. **`RELIEF_OFFER_AT` WAS MARKED DEPRECATED AND "NOTHING GATES ON IT"; FOUR LIVE SITES GATED ON IT.**
   `sim/encounters.ts` offers `give-food`/`give-water` on it. **The fix was to keep it and say why, not
   to change it** — sharing is the moral verb GDD X's "last can" exists to protect, not an efficiency
   one, and "fixing" it measurably stops `npc.ruth`, the Vertical Slice's desperate survivor, from ever
   being offered water, because her authored need sits between the two thresholds. Content authored
   against the low bar is the reason the low bar stays.
7. **THE REBALANCE NERFED THE ONLY REACHABLE WATER BRIDGE.** A first cut fixed the boil/filter domination
   by taking the filter from 3 units to 2 — and measurement says **every purify a run actually takes is a
   filter** (`item.fuel` appears 0.02 times a run and 0.00 turns are spent holding fuel and dirty water
   together). So the "fix" made the reachable path worse to balance it against one nobody can reach. The
   boil went to 4 instead.
8. **`world.water` WAS CLAIMED TO FOLLOW THE GRID BOTH WAYS.** `job.generator` pushes `powerGrid` back
   toward 100, and nothing raises `world.water`, so *"a run in which the grid never fails is a run in
   which the taps never fail either"* was exactly backwards for the only player who can do anything about
   it — and the wrong fiction besides. The drain is monotone by design, and now says so.
9. **THE WORKSHOP SCREEN WAS STILL BENCH-ONLY.** The two recipes T59 put in the player's hands were the
   only two whose *"needs: charcoal ×1 · cloth ×1"* could never be shown to them — the ACCESSIBILITY §6
   clause T59 itself invokes over the relief threshold.

Eleven further findings were claims rather than code: *"its absence is the exact pre-T59 lookup"* (false —
water's own base moved 18 → 48), *"a pool-less run is unaffected"* (false — T59 moves every run, by
design), *"one point per third of its progress"* (it is one per sixth), a `{@link}` that rendered as
*"the whole city carries **4**-worth of drinkable water"*, `LOOT_POINTS_PER_ITEM` changing with no
rationale at all, `treatWound`'s contract comment claiming *"time/rest/movement can never call it
implicitly"*, a recipe description reading *"up to 2 carried units"* over a field of 3 **embedded verbatim
in the shipped client**, and the parting-blow retune quoted as a win without its other half (per *slip*
the bite share fell; per *run* the careful bot now takes 11.17 wounds against 5.79, because it lives long
enough to slip away from twice as many things).

**T61's lesson, confirmed from the other side: prose is a claim about mechanics, and more than half of
this task's audit findings were sentences rather than statements.** A balance pass is mostly numbers
written into comments, and a number in a comment is a test nobody runs.

One audit finding was **declared rather than fixed** — see PL-M4-54 in §10.

---

## 8. Tests and mutants

**14 existing tests moved**, every one a place a dial was load-bearing, and every one carrying its reason
in the test file: the pinned pre-T84 cap formula, "three searches exhaust a node", the shelter slice's
three searches, a thin-search difficulty probe at loot 8 (now 4), the wasted-relief assertion, three
"ignore the bite" scripts that were quietly *resting the bite closed*, a weapon end-to-end test that now
gets two weapons from one search, and the two FR-INJ-04 guardians, rewritten to assert both halves.

**New:** `prototype/engine/test/balance59.test.ts`, 31 tests. Nine of them are audit-fix tests, and **all
nine were run against `/root/zb-unfixed`, the pre-fix snapshot: eight fail there.** The ninth (the mains
are monotone) passes against the unfixed code because that finding was a false *comment* over correct
behaviour — it ships as a regression guard and is labelled as one.

**48 mutants, 47 killed.** The distribution is the interesting part and it is T77's lesson for the tenth
consecutive task:

| round | killed | survivors |
|---|---|---|
| water geography (10) | 10 | — |
| stock / debit / scarcity dials (10) | 7 | `contest-divisor-50`, `points-per-item-3`, `no-cloth-in-generic` |
| rest-care / relief threshold (10) | 8 | `offer-no-finite-guard`, `eat-ignores-dial` |
| bench gate / verb guard / mains (10) | 8 | `parting-uses-walker-table`, `mains-not-in-identity` |
| tail (8) | 6 | `parting-table-one-in-two`, `seed-water-ignores-author` |
| **after closing the gaps** | **47 / 48** | **`points-per-item-3`** |

**Seven of the nine first-round survivors were test gaps, and every one was in a half I had not just
thought hardest about**: PL-M5-27 — the parking-lot item this task exists to close — had **no test at
all**, both of its mutants survived, and I had written 200 lines about it; the `canEat` half of a pair
whose `canDrink` half was covered; a `fc.double` property that was not reliably generating NaN, so
dropping a finite guard survived a test that claimed to cover it; a seeded probe that covered the
*unauthored* district default and not the *authored* one; and a weather identity clause whose
discriminating case had to be constructed (snow at six hours, not a storm — a storm leaves a road
remainder every tick and rebuilds the world for another reason).

Two survivors were closed with **content properties rather than magnitudes**, which is the T85 lesson
applied: *a field recipe must be assemblable from what one kind of place yields* (killed
`no-cloth-in-generic`), and *no district may strip itself before the Shock phase is over* — five days,
which binds the dial against the authored content so that either drifting fires it (killed
`contest-divisor-50`).

**The one survivor is declared, not papered over.** `LOOT_POINTS_PER_ITEM` 3 → 2 is a pure balance
magnitude; a test pinning it would be a test asserting a constant against itself, which is exactly what
T85's audit criticised. The pressure it trades against is the pack, and that is *measured* — in
`--scarcity`, on both trees — rather than asserted.

---

## 9. Every constant that moved

| constant | file | before | after |
|---|---|---|---|
| `LOOT_CONTEST_DIVISOR` | `sim/loot.ts` | 50 | **120** |
| `LOOT_POINTS_PER_ITEM` | `sim/loot.ts` | 3 | **2** |
| `searchYieldCap` region denominator | `sim/loot.ts` | 800 | **400** |
| `searchYieldCap` picked-over denominator | `sim/loot.ts` | 34 | **17** |
| `ITEM_LOOT_WEIGHT["item.water"]` | `sim/loot.ts` | *(untiered, 18)* | **48** |
| `ECONOMY_LOOT.generic` | `sim/loot.ts` | 3 rows | **+ `item.cloth`** |
| `SEARCH_GAIN` | `actions/coreActions.ts` | 34 | **17** |
| `SEARCH_COST` | `actions/costs.ts` | 2 | **1** |
| `RegionState.water` seed default | `map/seedWorld.ts` | 0 | **50** |
| `recipe.purify.boil.purifyUnitsPerCraft` | content | 2 | **4** |
| `recipe.purify.filter.purifyUnitsPerCraft` | content | 3 | 3 *(unchanged — see §7.7)* |

**New:** `WATER_LEVEL_NEUTRAL` 50 · `WATER_POINTS_PER_UNIT` 4 · `DEFAULT_REGION_WATER` 50 ·
`CLEAN_WATER_ITEM` · `drinkableWaterOf` · `RELIEF_OFFER_CEILING` 70 · `reliefOfferAt` ·
`REST_WOUND_CARE` 4 · `REST_WOUND_CARE_MAX` 16 · `BENCHLESS_CATEGORIES` · `PARTING_WOUNDS`.

**Unchanged and deliberately so:** `THIRST_RATE` 2 and `HUNGER_RATE` 1 (thirst is the sharpest clock by
design, GDD V — the problem was supply, not the clock), `DRINK_RELIEF` 55, `EAT_RELIEF` 45,
`NEED_FATAL` 100, `LAST_STAND_AT` 80 (T82 swept it against both ends of the player spectrum; its
*difficulty scaling* is PL-M5-45's, i.e. T60's), `WALKER_WOUNDS` (one bite in two is right for a body you
are trading blows with by choice), `CARRY_CAPACITY` 40, `MOVE_COST` 2, and every `sim/difficulty.ts`
profile.

**No new state. No save rung. `SAVE_SCHEMA_VERSION` is untouched**, and `balance59.test.ts` asserts a
lossless round-trip with every numeric leaf still an integer.

---

## 10. Parking lot

**Closed**

- **PL-M4-16** (encounter dials), **PL-M4-22** (infection dials), **PL-M4-31** (economy dials),
  **PL-M4-37** (job/room dials), **PL-M4-40** (social dials) — these record *"untuned against a real
  cross-city run, M5 balance T59/T60"*. Pass 1 has now been run against the real cross-city run; the
  remaining per-system magnitudes ride the difficulty modes, which are pass 4 (T60). Marked
  half-closed with the numbers above rather than closed outright, because T59 owns survivability and
  scarcity and T60 owns pacing and modes.
- **PL-M5-27** (the parting-wound table after T77 doubled detection) — **closed**, with its own table and
  its own test. Bite share of a detected slip 49.2% → 15.9% (medic), 58.3% → 18.2% (drifter).
- **PL-M5-50** (six consecutive tasks inert in the testlab soak) — **closed**: the soak moves.

**Re-scoped to T60**

- **PL-M4-54** (the dial-resolution floor) — **T59 did not close this and an audit caught a comment
  claiming it had.** Two halves: the `lootContest` half was already fixed by T74 (the dial rides the
  *period* and is exact for any chunking), and the `lootYield` half **cannot be closed from here**.
  `lootYield` is only ever read as a boolean gate (`if (yieldCap <= 0)`); the draw uses the raw cap. So
  it does anything at all only where `trunc(cap × mult)` is 0, i.e. only at `cap === 1` — where
  Hardcore's 0.8 and Nightmare's 0.6 are byte-identical to each other. T59 made it **narrower**: halving
  the denominator moved the band that produces `cap === 1` from `loot 8..15` to `loot 4..7`, and the
  measured share of searches the dial can touch fell **12% → 7%**. Closing it means changing what
  `lootYield` *scales*, which is difficulty-mode work.

**Declared (new)**

- **PL-M5-76** — the run is 51 turns against a GDD target of 2–6 hours, and the cause is structural:
  four clocks of the same length, each with a supply-limited counterplay. §6 has the measurement.
- **PL-M5-77** — the medical economy is still 15 : 1 against the player (0.75 items a run against 10–17
  wounds). `rest` is now a counterplay; an item economy is not.
- **PL-M5-78** — fatigue is still a corner with no price of its own. T59 gave *rest* a job; it did not
  give *fatigue* one. PL-M4-22's own suggestion (an awareness/accuracy malus above a threshold) is
  unspent.
- **PL-M5-79** — the pack now binds hard (up to 61% of turns at or over `PACK_HEAVY`) and no verb helps:
  `drop` is offered, the stash needs a base, and nothing weighs a decision for the player.
- **PL-M5-80** — `world.water` is monotone and has no repair path. That is deliberate ("civilization
  dies slowly") but it means a very long run ends with a dry city and only the purify bridge, which is
  worth playing before it is called correct.

---

## 11. Verdict

Pass 1 of four. **The thing it set out to prove — that the whole dial surface of this game was inert
behind one unpayable clock — is proved, and the clock is now payable at a price.** Water has a
geography, a finite stock and a bridge from the dirty half; a search is worth taking; stopping is worth
doing; the cautious verb no longer hands you the disease; and for the first time in the project's
measured history a bot starves to death.

What it did **not** do is make the run long. That is stated as the headline limit rather than buried,
because the next pass should be chosen with it in view: the honest read is that the remaining distance is
not in these dials.
