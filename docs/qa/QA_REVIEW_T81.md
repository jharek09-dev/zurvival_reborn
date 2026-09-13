# QA Review — T81 · Melee weapon content: the firefighter's axe

**Date:** 2026-09-13 · **Milestone:** M5 (fourth task, seq 104) · **Task:** T81 (design review 2026-09-12, step 6)
**Requirements:** FR-CBT-04 (Must/VS) · FR-PLR-04 (Must/VS) · GDD Part IX "Weapons" · GDD Part X "Legendary items"
**Status:** DONE · **Not byte-identical for a run that registers the weapon content set** — declared, like
T71/T72/T74–T80. A run that registers no pool draws loot bit-for-bit as before, and that is tested.

**CI (clean sandbox):** engine **880** (was 846 at T80, **+34**) / harness **270** (was 264, **+6**) /
content-loader **23** / testlab **22** / schema gate **173** (was 160 — a fourteenth content type) /
a11y gate OK / `tsc --noEmit` clean in all four packages.
**Save schema v10 holds and this task adds NO new state shape.** A found weapon is an `ItemInstance` in
the `items` registry and an `InventoryEntry` with an `itemId` — both have existed since T51 and both
round-trip through `saveGame`/`loadGame` today; the only thing that changed is that something other than
the crafting bench now creates one. There is no migration rung.

---

## 1. What was wrong — and the half of it the brief did not know about

The task note says T81 is *"pure content once T80 exists"*. **It was not**, and the first thing this task
did was measure rather than trust that. `measure/t81.ts` on the **pre-T81 tree**:

| probe | pre-T81 |
|---|---|
| melee profiles in `WEAPONS` | **2** (`weapon.bare`, `item.tool-reinforced`) |
| melee weapons in any loot table | **0** |
| scavenging runs that ever held a melee weapon (30 runs × 300 actions, shipped city) | **0 / 30** |
| combat turns fought armed | **0 / 316** |
| `item.pistol` share of a police search | **24.6%** — a gun exactly as likely as a bandage |
| `content/weapons/` | an empty directory with a `.gitkeep`, since M0 |

The content gap was the visible half. The invisible half is worse and is the reason this task is not pure
content: **`player.equipment[WEAPON_SLOT]` had exactly one writer in the entire engine** — the crafting
bench's artifact mint in `sim/economy.ts` — and `ItemInstance` was only ever constructed there too. So a
weapon dropped into a loot table would have arrived as a *stack*: no durability to wear, no ledger to
repair, no provenance, and **no way into a hand**. Shipping the roster alone would have produced a pack
full of nouns and changed nothing about a fight, which is the exact dead-wiring pattern the 2026-09 design
review exists to end — one task after naming it.

The design review's finding V put the stakes plainly: XP and character levels are forbidden twice in the
GDD (FR-PLR-10, *"attempts to add one should be rejected"*), which makes **gear the only progression axis
in the game**, and it was empty.

## 2. What shipped

### `src/combat/weapons.ts` — four new fields and eight new melee rows

`WeaponDef` gains **`category`** (the GDD Part IX family), **`startDurability`** (what a *found* one
arrives at; `null` = no artifact behind this profile — bare hands, and every firearm, which is an
ammunition-fed stack), and **`lootWeight` / `lootKinds`** (where it is found and how rare). Rarity is
authored on the weapon rather than in the loot module deliberately: a weapon's dials and its scarcity are
one decision, not two.

| id | family | dmg | noise | pierce | wear | retal | dur | carry | weight | found in |
|---|---|---|---|---|---|---|---|---|---|---|
| `weapon.bare` | improvised | 1–2 | 15 | 0 | 0 | 0 | — | — | — | always |
| `item.chair-leg` | improvised | 1–2 | 12 | 0 | 4 | 0 | 25 | 2 | 6 | residential, store, generic |
| `item.pipe` | improvised | 1–3 | 15 | 0 | 3 | −5 | 40 | 3 | 5 | industrial, residential, generic |
| `item.knife` | bladed | 1–3 | **8** | 0 | 3 | **+10** | 45 | 1 | 4 | residential, store, police |
| `item.machete` | bladed | 2–4 | 12 | 1 | 4 | −5 | 60 | 3 | 2 | industrial, generic |
| **`item.axe-fire`** | bladed | **3–5** | **30** | **2** | 3 | **−15** | 100 | **8** | **1**→2 | **police** |
| `item.hammer` | blunt | 2–3 | 20 | 1 | 2 | +5 | 60 | 3 | 3 | industrial, residential |
| `item.bat` | blunt | 2–4 | 25 | 0 | **1** | −10 | 80 | 4 | 3 | residential, store |
| `item.crowbar` | blunt | 2–3 | 22 | 1 | **1** | −5 | **90** | 5 | 2 | industrial, store |
| `item.tool-reinforced` | blunt | 2–3 | 20 | 1 | 2 | −10 | 100 | 6 | **0** | the bench only |

The crafted tool is deliberately left **out of every loot table**. Now that the world hands out weapons,
the bench's distinction is that it starts *and repairs to* a full 100 where a found weapon starts below it.

**The anti-power-tier rule is enforced, not asserted.** GDD Part IX: *"weapons are tools with trade-offs,
not power tiers."* A test walks every melee row against every other on the seven axes the player pays on
— damage, noise, wear, retaliation, pierce, durability, carry weight — and fails if any row is ≥ on all of
them and > on one. It passes: **no melee profile is strictly dominated.**

### `content/weapons/*.json` + `content/schemas/weapon.schema.json` — a fourteenth content type

Thirteen files filling a directory that has been empty since M0, under a new schema the merge-blocking
gate validates (160 → **173** entries across **14** types). The engine keeps the authoritative dials, as
it does for `ENEMIES`, and a **harness drift-guard test asserts the two agree 1:1 with no orphan in either
direction** — every field, both ways. Moving the dials into content would have re-pointed every T80
measurement at a JSON file mid-flight; the drift guard buys the same protection without that.

### `RegionGraph.weapons` — the pool, and what it actually gates

The T50/T51/T52 discipline: transient content registered by the client, absent ⇒ the system is inert.
Here it gates **loot placement only**. A graph without it draws the exact pre-T81 uniform table, which is
what keeps every prior run and every pool-less fixture byte-identical — the `floor(f·len)` hazard that
`byte-identity-loot-hazard` exists to warn about. Registered by `playCli.ts`, `testlab/boot.ts` and both
web builds; golden transcript generators still pass nothing and stay byte-stable.

### `drawWeighted` — the rarity primitive `drawPick` could not express

One draw over the total weight, then a walk. **It costs exactly one `drawInt` step, the same as
`drawPick`**, so swapping a uniform pick for a weighted one advances the RNG stream identically and only
the chosen value can differ — pinned by a test. Non-positive weights are skipped rather than read as 1,
so "authored but never placed" is expressible.

### `pocketWeapon` (`sim/loot.ts`) — a found weapon becomes a tracked artifact

Durability at the profile's `startDurability`, provenance `{ foundDay, foundAt, repairs: [] }` — the same
`metadata` shape the repair ledger has appended to since T51, so `recipe.repair.tool` works on a found axe
with no change at all. It is **taken up on the spot only when that is not a decision**: empty hands, or a
broken weapon. Choosing between two working weapons is the equip verb's job; doing it here would quietly
overwrite the axe with the chair leg you just found. A full pack declines it and the region is **not**
debited — the T18 rule, preserved and tested.

### `src/actions/gear.ts` (new) — the equip verb, and the reason this task is not pure content

One free verb (`EQUIP_COST` 0, the T18 *"managing the pack costs no in-game time"* rule that `drop` and
the T39 stash verbs already use), offered in the quiet explore branch only, once per carried melee
artifact that is not already in your hands. A fight, an overrun, an active encounter or loitering walkers
all pre-empt that branch, so **you cannot swap weapons mid-fight** — what you walked in holding is what
you fight with. That is deliberate: a free in-fight swap would collapse the carry-weight trade the whole
roster is balanced on.

### `dropArtifact` — because otherwise the pack ratchets shut

`dropItem` only ever touched non-unique stacks, which was correct while the one artifact in the game was
something you had built and would never abandon. With the world handing out chair legs, every junk weapon
a run picked up would have been **welded into the pack for the rest of the run**. Artifacts now drop by
*instance* (two found crowbars are two crowbars, Principle 6), which also empties the hand that held it
and forgets the instance — its provenance goes with it, which is what abandoning a thing means.

### Provenance in words (closes the rendering half of PL-M4-33)

`artifactMarks(item)` → `"mended once"` / `"mended twice"` / **`"it carries the marks now"`** (SCR-10's own
sentence, at the third repair) / `"about to go"` / `"worn"` / `"broken"` / `""`. Repairs outrank condition,
because they say different things: history, then state. **No durability number ever reaches a label**, at
any point on the track — a test loops the band edges and asserts the label matches no digit.

It surfaces at the point of decision: *"Strike with the baseball bat (worn)"*.

**One T80 label was rebaselined, deliberately.** T80 let the weapon suffix simply vanish when the weapon
broke — *"the tell that the thing in your hands has stopped being a weapon"* — which was fine while the
only breakable thing was a bench tool with fifty swings in it. T81 hands out chair legs with **six**, so a
silent fall back to plain *"Fight the walker"* would leave the player no way to learn their axe had
snapped. It is now named: *"Fight the walker — the reinforced tool is broken"*.

## 3. Measured, before → after

`measure/t81.ts`, committed. Runs against the pre-T81 tree unchanged (everything new is looked up off the
engine namespace with a fallback), which is what makes the columns comparable.

### Reachability — the headline

| | pre-T81 | post-T81 |
|---|---|---|
| runs that ever held a melee weapon (60 × 300 actions) | **0 / 30 (0%)** | **34 / 60 (57%)** |
| mean day of the first weapon | — | **1.26** |
| mean searches to the first weapon | — | **3.9** |
| combat turns fought **armed** | **0 / 316 (0.0%)** | **123 / 528 (23.3%)** |
| mean run length (days) | 4.70 | 4.63 |
| runs that found the **firefighter's axe** (300 full police sweeps) | **impossible** | **32.0%** |

### The loot table, per node kind (4000 sampled searches each)

| kind | P(melee weapon) | what changed |
|---|---|---|
| residential | **12.8%** | chair-leg 3.6 · pipe 3.1 · knife 2.6 · hammer 1.8 · bat 1.7 |
| store | **10.2%** | chair-leg 4.3 · knife 2.6 · bat 2.1 · crowbar 1.2 |
| generic | **9.7%** | chair-leg 4.3 · pipe 3.9 · machete 1.5 |
| police | **9.1%** | knife 6.3 · **axe 2.9** · and **pistol 24.6% → 4.7%** |
| industrial | **8.9%** | pipe 3.6 · hammer 2.2 · crowbar 1.6 · machete 1.5 |
| medical | 0.0% | unchanged — no weapon is authored for a clinic |

### The duel table (3000 duels per cell, strike only, fought to the end)

| weapon | walker E[h] / P(hurt) / P(bite) | riot E[h] / P(hurt) / P(bite) | E[noise] walker / riot |
|---|---|---|---|
| bare hands | 2.26 / 56.2% / 30.4% | 10.09 / 99.1% / 88.8% | 33.9 / **151.3** |
| chair leg | 2.25 / 56.7% / 30.6% | 10.05 / 99.3% / 89.2% | 26.9 / 120.6 |
| pipe | 1.77 / 32.2% / 16.6% | 5.34 / 88.9% / 62.4% | 26.6 / 80.1 |
| knife | 1.77 / 41.7% / 21.5% | 5.41 / 96.1% / 74.9% | **14.2** / 43.3 |
| machete | 1.33 / 15.6% / 8.0% | 2.11 / 48.0% / 24.0% | 16.0 / **25.3** |
| **axe** | **1.00 / 0.0% / 0.0%** | **1.66 / 23.0% / 11.1%** | 30.0 / 49.7 |
| hammer | 1.50 / 28.0% / 14.7% | 2.25 / 58.7% / 30.9% | 30.0 / 45.0 |
| bat | 1.33 / 12.6% / 6.8% | 2.83 / 58.8% / 33.7% | 33.3 / 70.9 |
| crowbar | 1.48 / 21.5% / 10.5% | 2.25 / 50.0% / 27.2% | 32.6 / 49.5 |
| reinforced tool | 1.50 / 20.1% / 9.8% | 2.26 / 46.4% / 24.2% | 30.0 / 45.1 |

## 4. The dials the measurement forced

**(1) `BASE_LOOT_WEIGHT` = 18, swept by rebuild.** The denominator every `lootWeight` is read against.
Sweep over 60 scavenging runs each:

| base | runs that ever held a weapon | searches to the first | mean run length |
|---|---|---|---|
| 12 | 68% | 3.3 | 4.68 d |
| **18** | **57%** | **3.9** | **4.63 d** |
| 24 | 45% | 3.7 | 4.63 d |
| 36 | 37% | 4.0 | 4.68 d |

18 is the **smallest value at which a majority of short runs ever hold something**, and it keeps a weapon
at roughly one search in nine — rarer than any consumable category. Run length is flat across the whole
sweep, so the dial is a pure frequency choice and not a survivability one.

**A probe defect caught in the sweep, and worth recording.** The first cut of the scavenging bot preferred
the `equip` verb above everything else. `equip` is free, so the bot ping-ponged between two carried
weapons forever, burning its action budget — and the sweep duly reported *"more weapons ⇒ shorter runs"*
(3.78 d at base 12 against 4.48 d at base 36), a clean monotone trend that was entirely an artifact of the
measuring instrument. Removing `equip` from the bot's preference list flattened it to 4.63–4.68 d. **A
measured trend is only worth what the probe behind it is worth.**

**(2) The axe's `lootWeight` = 2, swept the same way** (200 full police sweeps each, at base 24):
1 → 12.5% · **2 → 22.0%** · 3 → 30.5% · 4 → 41.0% and as likely as a pistol, which is not a legendary.
At the shipped base 18, weight 2 measures **32.0%** over 300 sweeps — roughly one thorough run in three
ever holds it. Weight 1 left it at one in eight, which is decoration wearing a legendary's name.

**(3) Damage buys noise per BLOW. Per KILL it does the opposite — and that was a surprise.** The roster is
authored so that harder hitters are louder, and the dominance check confirms no row escapes that. But
**noise is deposited per swing**, so a weapon that ends a fight in fewer swings deposits less of it.
Measured: putting a walker down with the axe (noise 30, one blow) banks **30.0** points; doing it
bare-handed (noise 15, E[2.26] blows) banks **33.9**. Against a Riot it is **49.7 against 151.3**. So
*arming yourself makes the city quieter*, and the axe's real price is **not** the sound of it — it is
rarity, carry weight 8 (a fifth of the pack), and 33 swings before it needs a bench.

This is **not dialled away here**. If noise is meant to price power, the deposit has to scale with the
damage dealt rather than with the swing, and that is a balance-pass decision, not a content task's —
recorded as **PL-M5-40** for T59/T60.

## 5. The adversarial audit

42 mutants across the six touched modules, run with the process the T80 failure forced: a pristine-tree
`diff -r` guard that **refuses to start** unless the working tree matches a snapshot, an anchor check that
every `old` string matches exactly once, restoration after every mutant, and a re-verified `diff -r`
afterwards — all under `nohup` with polling rather than inside one tool call.

**Round 1: 39 killed / 3 survived. Round 2 (survivors only): 3/3. Round 3 (full 42, current tree): 42/42,
tree pristine.**

**All three survivors were TEST defects, not code defects**, and two of them were the same mistake:

1. **M40 — "the pipeline never tells loot the weapon set is live."** Every find test called
   `resolveSearchLoot` *directly*, so none of them could see whether `applyPlayerAction` ever passed
   `weaponsActive(graph)` at all. That is exactly the dead-wiring class this task exists to close, and the
   suite would have shipped blind to it. Fixed with an **end-to-end** test: choices from
   `availableActions`, taken through `applyAction`, on a graph that registered the pool.
2. **M28 — "the gate is bypassed."** The pool-less test emptied the pack between searches to keep the
   probe alive (a full pack declines every find) and then asserted on the **final** inventory — throwing
   away the evidence it had spent 400 searches collecting. Fixed by recording every pass.
3. **M20 — "two artifacts minted on one turn collide."** No test ever found two weapons of the *same type*
   before the clock moved, so `foundArtifactId`'s collision backstop was never exercised. Fixed with a
   test that searches until a type repeats and asserts every carried artifact still has its own instance.

## 6. Declared limits — do not re-claim these

- **The GDD names five weapon families; T81 ships four.** Explosives are still unshipped: `item.molotov`
  is craftable and carryable and has **no combat action at all** (PL-M4-30, open since M4 Part 7).
- **Weapon placement is per node KIND, not per node.** The firefighter's axe is found in *any* `police`
  node — city hall, the evac checkpoint, the police post — rather than at the fire station whose own
  description names the tool wall it comes off. Node-specific loot is T84's `NodeDef.richness` work
  (PL-M5-41).
- **T81 makes PL-M5-37 live rather than closing it.** With all three firearms now placed (PL-M5-36
  **closed**), a player can genuinely carry a pistol and a shotgun — and `firearmFor` brings up the
  **surer** gun, which is the **louder** one (85 against 75), with no way to ask for the quiet one. A
  gun-selection menu is its own design decision.
- **Essentially inert in the testlab soak**, exactly as T78 and T79 were: 1079 actions / 64 combats before,
  **1077 / 62** after, mean end day 4.3 either side. The Lab's policies do not prioritise searching, so
  its bots rarely find a weapon; the scavenging probe in `measure/t81.ts` is what answers this task's
  question, and it moves a great deal.
- **Nothing warns you a weapon is about to break before the swing that breaks it.** The label says "about
  to go" below 25 durability, which is a warning a player must read rather than a prompt (PL-M5-42).
- **The equip verb is free and out-of-combat only.** Carrying three weapons and switching between fights
  costs nothing but weight; there is no in-fight swap, no cost to indecision, and no unequip verb
  (dropping is how you empty a hand). Recorded, not defended as finished design (PL-M5-42).
- **Wounds still cannot kill you** (PL-M5-01), so a better weapon still buys hours and infection risk
  rather than survival. Every P(hurt) figure above is a burden figure, not a lethality one — as T80 said.
- **`weapon.bare` is untouched**, and so is every T80 dial: no existing profile's numbers moved, which is
  why the entire pre-T81 suite passes with **one** deliberate rebaseline (§2, the broken-weapon label).

## 7. Parking lot

| ID | Subject |
|---|---|
| **PL-M5-40** | Noise is deposited **per swing**, so a harder hitter is *quieter per kill* (axe 30.0 vs bare hands 33.9 on a walker; 49.7 vs 151.3 on a Riot). If noise is meant to price power, the deposit must scale with damage dealt, not with the swing. T59/T60. |
| **PL-M5-41** | Weapon placement is per node **kind**. The firefighter's axe should live at `node.the-terraces.fire-station`, whose description already names the tool wall; any `police` node yields it today. Belongs with T84's `NodeDef.richness`. |
| **PL-M5-42** | The equip verb is free, out-of-combat only, and has no unequip. No in-fight swap, no cost to carrying several weapons beyond weight, and no prompt before the swing that breaks one. |
| **PL-M5-43** | The GDD's fifth weapon family, **explosives**, is still unshipped — `item.molotov` has no combat action (PL-M4-30). T81 shipped improvised, bladed and blunt; firearms were T80's. |
| **PL-M5-36** | **CLOSED.** All three firearms are placed in the police table; every firearm figure is no longer a pistol figure. |
| **PL-M4-33** | **Rendering half CLOSED** — `artifactMarks` turns the repair ledger into words and no durability int can reach a label. The legendary-item *set* remains post-gate. |

## 8. One sentence

Before this task the shipped city could not put a weapon in the player's hand by any route but a
workbench, and the game's only sanctioned progression axis was therefore empty in 30 runs out of 30; it
now arms a majority of them by the end of day one, hands the firefighter's axe to about a third of the
runs that work the whole city for it, and does both without a single new piece of save state.
