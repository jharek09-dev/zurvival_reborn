# QA Review — T80 · Weapon profiles & the missing combat verbs

**Date:** 2026-09-13 · **Milestone:** M5 (third task, seq 103) · **Task:** T80 (design review 2026-09-12, step 5)
**Requirements:** FR-CBT-02 (Must/VS) · FR-CBT-04 (Must/VS) · FR-PLR-04 (Must/VS)
**Status:** DONE · **Not byte-identical** — declared, like T71/T72/T74–T79. A shot that could not miss now
misses; that is the deliverable, not a side effect.

**CI (clean sandbox):** engine **846** (was 815 at T79, **+31**) / harness **264** / content-loader **23** /
testlab **22** / schema gate **160** / a11y gate OK / `tsc --noEmit` clean in all four packages.
**Save schema v10 holds.** The one new piece of state, `CombatState.offBalance`, is **optional and
absent-reads-as-false** — the same shape `Horde.stepHours` took in T74 — so there is no migration rung: a
pre-T80 save simply contains no shoved enemy.

---

## 1. What was wrong

The design review's finding IV, quoted in the task note, is an arithmetic claim, and the first thing this
task did was re-derive it rather than trust it. `measure/t80.ts` on the **pre-T80 tree**, 3000 duels per
cell, one body, fought to the end:

| enemy | tactic | E[hours] | P(wounded) | E[wounds] | P(bitten) | rounds |
|---|---|---|---|---|---|---|
| walker | melee | 2.25 | **56.8%** | 0.63 | 29.1% | — |
| walker | **fire** | 1.00 | **0.0%** | 0.00 | **0.0%** | 1.00 |
| fresh | melee | 2.25 | 100.0% | 1.25 | 56.3% | — |
| fresh | **fire** | 1.00 | **0.0%** | 0.00 | **0.0%** | 1.00 |
| crawler | melee | 1.50 | 25.2% | 0.25 | 12.6% | — |
| crawler | **fire** | 1.00 | **0.0%** | 0.00 | **0.0%** | 1.00 |
| bloated | melee | 2.87 | 100.0% | 1.92 | 100.0% | — |
| bloated | fire | 2.00 | 100.0% | 1.00 | 100.0% | 2.00 |
| riot | melee | 9.93 | **99.0%** | **4.41** | 89.2% | — |
| riot | **fire** | 2.00 | **0.0%** | 0.00 | **0.0%** | 2.00 |

`resolveFire` never called `enemyRetaliate`. **Firing was mathematically incapable of hurting you** — the
zeroes above are not a small number, they are the number zero — except against the Bloated, which bursts
on whoever kills it however they do it. Two rounds and two hours answered the Riot that costs ten hours
and four and a half wounds to beat with your hands.

Underneath that, the second half of the same finding: **melee damage was `drawInt(1, 2)` regardless of
what the player held.** An equipped artifact's only effect in the whole combat module was two points of
durability off it per swing, and a weapon worn to 0 fought exactly as well as a fresh one. FR-PLR-04 —
*"equipment defines capability; growth comes from gear, not levels"* — was inverted into *equipment
defines a maintenance cost*, in a game that forbids XP twice over precisely so that gear can be the axis.

And FR-CBT-02 names six verbs (attack / heavy / aim / push / retreat / hide). Four existed.

## 2. What shipped

### `src/combat/weapons.ts` (new, ~170 lines with its docs) — the peer of `EnemyDef`

`WeaponDef { id, name, kind, dmgMin, dmgMax, noise, armorPierce, durabilityCost, retaliateModifier,
accuracy }` and the `WEAPONS` table, keyed by **item type**. Five rows: `weapon.bare`,
`item.tool-reinforced`, and the three firearms. Plus four pure functions the fight is built out of —
`weaponFor(state)`, `weaponProfile(type)`, `effectiveDamage(dmg, armor, pierce)`,
`retaliateChance(base, weapon, { initiative, heavy })` — and `surestOf`, extracted so its tie-break can be
tested (see §5).

Two properties are load-bearing and are pinned by name in the suite:

- **`weapon.bare` is the pre-T80 melee profile exactly** — `1–2`, `MELEE_NOISE` 15, no pierce, no wear, no
  modifier, `accuracy: 1` (which means *no draw is taken*). So an empty-handed fight is arithmetically
  untouched by this task, which is why 814 of the 815 pre-existing tests passed without an edit.
- **A broken weapon *is* bare hands.** `durability === 0` drops to the bare profile rather than applying a
  penalty term: a snapped haft is not a worse axe, it is no axe. `durability === null` (no durability
  track at all) keeps its profile.

### `src/combat/combat.ts` — the fight now reads the table

- **`resolveStrike(state, heavy)`** resolves the weapon's own damage band, `effectiveDamage` against the
  enemy's armor less the weapon's pierce, the weapon's own `durabilityCost`, and the enemy's answer at the
  weapon's own rate.
- **`resolveFire`** takes an **accuracy roll** off the firearm's profile, spends the round, the hour and
  the bang **whether or not it lands**, and calls `enemyRetaliate` on any shot that leaves the body
  standing (`FIRE_RETALIATE_CHANCE` 0.25, against melee's 0.5).
- **HEAVY** — `HEAVY_DMG_MULT` 2 on the damage, `HEAVY_NOISE_MULT` 2 on the deposit, `HEAVY_WEAR_MULT` 2 on
  the durability, and an answer from the enemy **whatever happens, including the swing that kills it**
  (§3.1). Offered both as an opener at a contested node and inside a live fight.
- **PUSH** — no damage, no answer, no draw. Clears `alerted` and sets `offBalance`, which together take
  **45 points off the next escape roll** (`ALERTED_DETECT` 15 + `PUSH_ESCAPE_BONUS` 30). Both halves are
  spent by the next combat action of any kind, so it cannot be banked, and it is not offered to a body
  already shoved.
- **`firearmFor(player)`** — the surest gun in the pack comes up, ties broken by id.
- Choice **labels name the weapon** (`Strike with the reinforced tool`) and stop naming it when it breaks;
  the narration says what a shove bought (*"You have it back on its heels — this is the moment to go"*).
  Both are the T77 "signpost, don't retune" discipline: a capability the player cannot see is a stat block.

### Elsewhere

`sim/economy.ts#wearWeaponOnStrike(state, points = WEAPON_WEAR)` takes the weapon's own cost (and refuses a
zero or negative one, which would *repair* on a swing). `state/types.ts` gains the optional
`CombatState.offBalance`. `testlab/src/policies.ts` adds `heavy` to `FIGHT_KINDS` so the `fighter` bot
exercises the new verb; `push` deliberately stays out (it belongs to whoever is leaving), and the `random`
policy covers it by picking off the offered list.

### `prototype/harness/measure/t80.ts` (new) — the committed runner

`--duel` (default), `--weapon`, `--verbs`. **It runs against the pre-T80 tree unchanged** — everything new
is read off the engine namespace with a fallback and the tactics that do not exist there are skipped with a
printed reason — which is what makes every before/after pair below a measurement rather than a memory. The
accuracy sweep in §3.2 is taken by rebuilding the engine with the variant constant and re-running, and the
runner prints the constants the tree it is running on compiled in.

## 3. Two corrections the measurement forced

### 3.1 "Guaranteed retaliation", read the obvious way, made HEAVY strictly dominant

The brief asked for HEAVY as *"double damage, double noise, guaranteed retaliation roll"*. Built the
obvious way — the enemy always answers **if it is still standing** — HEAVY came out **better on every axis
than an ordinary strike, against every enemy in the game**. Measured, bare hands, 3000 duels a side:

| enemy | strike E[h] / P(hurt) | heavy E[h] / P(hurt), *as first built* |
|---|---|---|
| walker | 2.25 / 56.8% | **1.49 / 49.4%** |
| fresh | 2.25 / 100.0% | **1.50 / 50.5%** |
| crawler | 1.50 / 25.2% | **1.00 / 0.0%** |
| riot | 9.93 / 99.0% | **2.93 / 100.0%** |

Double damage kills so often that the guarantee almost never got to fire — against a Crawler it never fired
at all. **A guarantee you escape by winning is not a cost**, and the task would have removed one dominant
strategy by adding another. So the answer is unconditional: the committed swing is answered even by the
body it puts down. Post-correction, HEAVY is a clean trade — *fewer beats, a certain wound* — and never
free:

| enemy | strike | heavy (shipped) |
|---|---|---|
| walker | 2.25h / 56.8% hurt / 0.63 wounds | **1.49h / 100% / 1.49** |
| riot | 9.93h / 99.0% / 4.41 | **2.93h / 100% / 2.93** |
| riot, *with the reinforced tool* | 2.25h / 46.2% / 0.50 | 1.51h / 100% / 1.51 |

### 3.2 A miss chance and a retaliation term are each inert on their own

The firearm fix has two halves and the sweep shows why it needs both. Each row is a rebuild of the engine
with a different `item.pistol` accuracy; `FIRE_RETALIATE_CHANCE` is 0.25 throughout.

| pistol accuracy | walker: E[h] / P(hurt) / rounds | riot: E[h] / P(hurt) / rounds |
|---|---|---|
| 0.55 | 1.84 / 16.8% / 1.82 | 3.87 / 52.5% / 3.54 |
| 0.65 | 1.54 / 12.3% / 1.54 | 3.19 / 44.3% / 3.08 |
| **0.75 (shipped)** | **1.33 / 7.8% / 1.33** | **2.69 / 38.5% / 2.67** |
| 0.85 | 1.18 / 4.6% / 1.18 | 2.35 / 33.3% / 2.35 |
| 1.00 (retaliation only) | 1.00 / **0.0%** / 1.00 | 2.00 / 24.4% / 2.00 |

**The last row is the finding.** With a certain shot, the retaliation term changes *nothing at all* against
every enemy a single round kills — which is the common case, and exactly the case the design review
measured. A retaliation-only fix would have read as "we fixed firing" while the walker column stayed at
zero. (The same shape as T79's threat-only lift: a correction that terminates in a number nobody meets.)

**0.75 is the choice.** It is where a body costs a third more ammo than it used to (1.33 rounds against
1.00) while the wound rate on the commonest enemy stays under 10% — a firearm that is still clearly the
right answer, priced in the scarcest resource in the game rather than in nothing. At 0.65 a walker costs
half again as much ammo and the gun starts to feel broken rather than expensive; at 0.85 the walker column
is 4.6%, close enough to the zero it is replacing to be a rounding error in play.

## 4. Measured, before → after

All from `measure/t80.ts`, 3000 duels per cell; "before" is the T79 tree, "after" is this one.

**Firing** (the melee columns are **identical** on both trees, which is the bare-hands claim proved rather
than asserted):

| enemy | P(wounded) before → after | P(bitten) before → after | rounds before → after |
|---|---|---|---|
| walker | 0.0% → **7.8%** | 0.0% → **3.8%** | 1.00 → **1.33** |
| fresh | 0.0% → **23.9%** | 0.0% → **13.8%** | 1.00 → **1.31** |
| crawler | 0.0% → **8.2%** | 0.0% → **4.5%** | 1.00 → **1.35** |
| bloated | 100% → 100% | 100% → 100% | 2.00 → **2.67** |
| riot | 0.0% → **38.5%** | 0.0% → **20.7%** | 2.00 → **2.67** |

**What you hold** (bare hands → the one artifact the economy can mint, `item.tool-reinforced`, dmg 2–3,
pierce 1, noise 20, wear 2, reach −10):

| enemy | bare hands | reinforced tool |
|---|---|---|
| walker | 2.25h / 56.8% hurt / 29.1% bitten | **1.49h / 19.3% / 9.9%** |
| fresh | 2.25h / 100% / 56.3% | **1.50h / 49.8% / 24.7%** |
| crawler | 1.50h / 25.2% / 12.6% | **1.00h / 0.0% / 0.0%** |
| riot | 9.93h / 99.0% / 89.2% (4.41 wounds) | **2.25h / 46.2% / 24.3% (0.50 wounds)** |

The Riot line is the design review's sentence made mechanical: armor stops being a firearm gate and becomes
a weapon-selection problem. The tool costs 3 durability per fight against a walker and 4.5 against a Riot,
so ~22 walkers or ~14 Riots on a full bar before the repair ledger has to pay — which is what makes
`recipe.repair.tool` a loop rather than a curiosity.

**The shove.** The escape line *strike → run* against *strike → shove → run*, 4000 trials a cell. The
second column is the shape T77 measured as the one **85% of real escapes actually have** (a loud node at
`chasing`), and it is the honest one — the quiet fixture's escape roll is already near its floor, so a
45-point discount there reads as a clean getaway it would not buy in play:

| | quiet node: P(hurt on the way out) | loud, chasing node |
|---|---|---|
| strike → retreat | 67.1% (0.86 wounds) | **94.7%** (1.38 wounds) |
| strike → **shove** → retreat | **50.1%** (0.50) | **75.0%** (1.02) |
| cost | +1 hour, no damage dealt | +1 hour, no damage dealt |

**Bot play — and this one is NOT inert, unlike T78 and T79.** The testlab soak (3 seeds × 4 policies ×
stocked/unstocked × 200 actions = 24 runs), all 24 passing every invariant on both trees:

| | actions | combats | encounters | mean end day |
|---|---|---|---|---|
| T79 tree | 1104 | 70 | 247 | 4.4 |
| T80, testlab policies unchanged | 1144 | **81** | 255 | 4.4 |
| T80 shipped (`heavy` in `FIGHT_KINDS`) | 1079 | 64 | 247 | **4.3** |

Fights take longer when shots miss (+11 combat turns with the bots' old tactics) and end faster when the
fighter swings hard, at the price of a wound each time — which is why the shipped row's runs end a tenth
of a day sooner. Combat is the one system in M5 so far whose change a bot can feel.

## 5. Audit — three passes

**Engineering (mutation).** **35 mutants** across every new site: each `WeaponDef` rule, both branches of
`effectiveDamage`, all three rules of `retaliateChance`, the `clamp01` NaN guard, the firearm selection and
its fallback, the flat-damage draw skip, every heavy multiplier, both halves of the shove and both places
that spend it, the accuracy roll and its inversion, the escape's `clearCombat` guard, the choice menus,
both action-dispatch entries, the label and the narration signpost, and the economy's wear guard.

**Round 1: 26 killed, 9 survived.** Every survivor was fixed with a test, and this is the part worth
recording, because eight of the nine were a *test* defect rather than a code defect — the claim was true
and nothing was checking it:

1. **`surestOf`'s tie-break was untestable** (no two shipped rows share an accuracy). Extracted from
   `firearmFor` into its own exported function and pinned on a constructed tie, rather than left as a rule
   that cannot rot visibly.
2. **The flat-damage draw skip was unobservable through the pipeline.** Now pinned directly on the RNG
   stream: a killing shot from a flat weapon must advance `combat` by **exactly one draw** (the accuracy
   roll) — `resolveCombatAction` called directly, since nothing else in the engine draws on that stream.
3 & 4. **"A blow spends the shove" was being skipped by a lucky kill** — the assertion sat behind
   `if (combat !== null)` and the walker fixture died first. Re-pointed at the Riot (5hp), which neither a
   bare-handed strike nor one pistol round can finish, so both branches always run.
5. **The `clearCombat` guard on the shove had no test**, because the menu never offers a mid-fight `slip`.
   Now tested at the layer that enforces it, through `resolveCombatAction`, over 120 seeds.
6 & 7. **Both in-fight choice noises were untested** — the existing test read the *contested node's* menu,
   and `combatChoices` builds its own. A weapon-equipped in-fight menu is now asserted for `strike` and
   `heavy` (and for the label).
8. **The economy's `points > 0` guard.** Redundant for 0 (the clamp already no-ops) but real for a negative
   or `NaN` cost, which would otherwise *repair* the weapon on a swing. Tested on `wearWeaponOnStrike`
   directly.
9. **The shove's narration** had no assertion at all.

**Round 2: 35 of 35 killed, no survivors** — the whole set re-run against the final tree, after a
`diff -r` proved the tree pristine.

**A process failure worth writing down.** The first mutation run was killed by a tool timeout *mid-mutant*,
leaving one mutation applied to the working tree. The next run therefore executed against a source where
`push` was always offered — which made one assertion fail unconditionally and reported **35 of 35 killed**,
a completely meaningless green. It was caught by diffing the tree against a pre-audit snapshot. The runner
now refuses to start unless `diff -r` against that snapshot is empty. *A mutation score is only worth what
the pristine-tree check behind it is worth.*

**Honesty — claims cut or corrected before this document was finished.**

- The design review says *"no recipe installs `room.workshop`"*, which would have made the weapon axis
  unreachable and was quoted here in an early draft. It is **out of date**: `recipe.shelter.workshop`
  installs it (3 scrap + 1 tools, 6h), and the reinforced tool is 2 scrap + 1 tools behind it. The real
  limit is milder and is §6.2.
- "Six verbs" is a *mapping*, not a match: FR-CBT-02 names attack/heavy/aim/**push**/retreat/**hide**, and
  two of the six are this module's existing `fire` and `slip` under other names. The honest count of what
  T80 adds is **two**, and the mapping is written into `combatChoices`' own doc comment rather than left
  for a later reader to discover.
- The firearm trade-off table is a **three-row table with one reachable row** (§6.1).
- No claim is made that firing has stopped being the best answer — only that it has stopped being a free
  one (§6.3).

**Verification.** Every figure here was re-derived on both trees in this session with the committed runner;
the mutation set was re-run against the final tree; full CI was run clean after the last edit.

## 6. Declared limits — what this does not do

1. **Two of the three firearm rows are unreachable content.** `item.pistol` is the only firearm in any loot
   table, encounter or start kit, so the shotgun's and rifle's accuracy/noise/handling trade is authored and
   untouchable on the shipped city. Every measured firearm figure above is a **pistol** figure. → **PL-M5-36**.
2. **There is still exactly one melee weapon, and it is at the end of a chain.** The reinforced tool needs
   a claimed shelter, a built workshop (3 scrap + 1 `item.tools`) and then 2 scrap + 1 more `item.tools`,
   with `item.tools` dropping only from the industrial table. Most runs will never hold it — which is
   precisely the hole **T81** exists to fill. This task built the socket; the roster is the next task.
3. **Firing is still the safest verb against every enemy in the game.** 7.8% against a walker is a real
   number where 0.0% was not, and a body now costs a third more ammo — but the dominance the review named
   is *reduced*, not *removed*, and whether the remaining gap is correct is a question about ammo scarcity,
   which belongs to the balance pass (**T59**). → **PL-M5-38**.
4. **HEAVY's price is paid entirely in wounds, and wounds cannot kill you** (PL-M5-01, the open
   player-health question T82 must settle). Until that is settled, "a certain wound" means a certain
   infection risk and a certain burden, not a step toward dying — so the verb's cost is carried by systems
   that may change shape under T82. → **PL-M5-39**.
5. **`item.molotov` still has no combat action** and the explosives category is still unbuilt: FR-CBT-03's
   improvised and environmental verbs (lure, trap, chokepoint, the gas leak) stay deferred as the task note
   scoped them. **PL-M4-30 remains open.**
6. **The player cannot choose which gun fires, and cannot pistol-whip.** The surest firearm comes up
   automatically; an equipped firearm reads as bare hands for the melee question. Both are deliberate (a
   three-gun menu for a one-gun game), and both are recorded rather than hidden. → **PL-M5-37**.
7. **Enemy dials are untouched.** No `EnemyDef` value moved, so `content/enemies/*.json` and its harness
   drift-guard are unchanged. The Riot's armor is still 1; what changed is that a melee weapon can now
   answer it.
