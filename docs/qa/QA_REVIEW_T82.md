# QA Review — T82 · Combat stakes: grabbed, the party in the fight, and the Last Stand

**Date:** 2026-09-13 · **Milestone:** M5 (fifth task, seq 105) · **Task:** T82 (design review 2026-09-12, step 11)
**Requirements:** FR-CBT-02 (Must/VS) · FR-NPC-03 remainder (Must/VS) · GDD Part IX *"Canonical: the Last Stand"* · GDD Part XII
**Settles:** PL-M5-01 → **ADR-0007** · **Closes PL-M4-07** · **Status:** DONE
**Not byte-identical**, declared, like T71/T72/T74–T81. A fight can now take your escape away and end
your run; that is the task.

**CI (clean sandbox):** engine **911** (was 880 at T81, **+31**) / harness **270** / content-loader **23** /
testlab **22** / schema gate **173** / a11y gate OK / `tsc --noEmit` clean in all four packages.

**Save schema v10 holds.** The one new field, `CombatState.grabbed`, is **optional and
absent-reads-as-false** — the `CombatState.offBalance` shape from T80 and the `Horde.stepHours` shape
from T74. A pre-T82 save has nothing holding the player in it, so there is no migration rung. The Last
Stand itself stores nothing at all: `runEndReason` stays **derived**, from `combat.grabbed` and the wound
list, both of which were already in `GameState`.

**Measurement runner committed** at `prototype/harness/measure/t82.ts` (the T77 rule — scratch-script
numbers are unverifiable). Every figure in this document is re-derivable:

```
npx tsx measure/t82.ts              # structure: what combat could and could not reach
npx tsx measure/t82.ts --party      # duels, 0–3 companions × trust × standing order
npx tsx measure/t82.ts --cornered   # can the player ever be out of escape options?
npx tsx measure/t82.ts --burden     # woundBurden distribution — where a threshold belongs
npx tsx measure/t82.ts --play       # bot runs, three policies: what actually ends a run
```

---

## 1. What was wrong — measured before anything was built

`measure/t82.ts` on the **pre-T82 tree**:

| probe | pre-T82 |
|---|---|
| references to companions anywhere in `combat/combat.ts` | **0** |
| `killCompanion` call sites in the entire engine | **0** (exported since T36, called by nothing) |
| `RunEndReason` | `starved \| dehydrated \| infection` — **a fight could not end a run** |
| bare-handed player's win rate against a **Riot**, 400 duels | **100.0%**, at 99.5% wounded and 88.8% bitten |
| bare-handed player's win rate against a walker | **100.0%** |
| combat turns with **zero** escape targets, 40 bot runs / 380 combat turns | **0** — fewest ever offered: **2** |

Two holes, and the second one contained a third the brief had not seen.

**(1) The party was not in the fight.** `combat.ts` did not mention companions. A companion standing
beside you contributed no damage, soaked nothing, distracted nothing and could not be bitten — so
recruiting was unambiguously always correct and `PARTY_CAP` was a ceiling rather than a decision. This is
proven, not inferred: `--party` pairs every row of a block **on the same seed**, so the only thing that
differs between the "party 0" row and the "party 3" row is the party.

```
  enemy   party  trust  order     E[h]  P(hurt)  P(bite)  cWounds  cDeaths  P(win)
  walker      0      0  follow    2.29    59.8%    29.5%     0.00     0.00  100.0%
  walker      3     90  follow    2.29    59.8%    29.5%     0.00     0.00  100.0%
  riot        0      0  follow    9.74    99.5%    88.8%     0.00     0.00  100.0%
  riot        3     90  follow    9.74    99.5%    88.8%     0.00     0.00  100.0%
```

Byte-identical. Three companions changed **nothing**, to the digit.

**(2) A fight had no lose state.** The player has no health stat; the only `hp` in the codebase belongs to
the enemy. A fight was a wound-severity slot machine you always walked away from — including from a
Riot, at 99.5% wounded, which is as close to "this should have killed you" as the old model could get.

**(3) — the one the brief had wrong.** The brief specifies the trigger as *"woundBurden ≥ threshold AND
`combat !== null` AND **no discovered escape target**"*. That third clause **is not reachable**.
`escapeTargets` falls back to every *discovered* neighbour when none is passable (the FR-CBT-05 fallback
T77 installed on purpose), and `relocatePlayer` discovers a node's neighbours on arrival — so a player
standing anywhere on the shipped city has at least two. Measured: **0 of 380 combat turns**, across 2716
turns, ever had fewer than **2**. Built as briefed, the Last Stand would have been code that could never
execute — the T81 defect (*"a weapon in a loot table with no path to a hand"*) in a new place. **This is
why GRABBED and the Last Stand belong in the same task**: the grab is what makes "out of options"
reachable, by withholding the retreats rather than waiting for the map to.

---

## 2. ADR-0007 — settling PL-M5-01 first

The review flagged PL-M5-01 as the one open design question and said to settle it before building. The
owner's decision, logged as **ADR-0007** (`design/decisions/0007-player-health.md`):

> **The player has no health stat and will not get one. `woundBurden` is the health model, and it is
> never shown as a number. Death in combat is a *situation*, not a threshold.**

The GDD says both things — Principle 2 and Part VI forbid "−10 HP"; Part V's Core stats list says
*"Health — 0 = death"*. The ADR records that the Core stats line is **superseded**, and why: the wound
table *is* Principle 2 made mechanical, and a parallel damage bar would make the named wound decorative.

The consequence for this task is the whole shape of it. `runEndReason` gains `lastStand`, true when **all
three** of: a live fight, the dead have **hold of you**, and `woundBurden >= LAST_STAND_AT`. All three
already live in `GameState`, so the reason is derived and the save is untouched.

---

## 3. What shipped

### GRABBED — `CombatState.grabbed?: boolean`

A third outcome on a retaliation that was **already landing**. While it is true:

- **every `retreat` is withheld**, and so is `push` (you cannot shove away what is holding you);
- **your melee is bare hands**, whatever you are carrying;
- a new verb, **`break` ("Tear yourself loose")**, is offered — and is the only way out.

It costs **no new `combat` draw**. `enemyRetaliate` already drew one float and compared it to the
retaliation chance; a grab is the bottom `GRAB_CHANCE` of that same interval:

```
 0                    chance × GRAB_CHANCE            chance                        1
 |------- lands, AND GETS HOLD -------|------ lands ------|-------- misses --------|
```

The same trick as T81's `drawWeighted`. The observable consequence — **a grab can only ever happen on a
blow that also wounds you** — is pinned by a test, because that is what breaks the day someone
re-implements it as its own roll.

### BREAK FREE

`BREAK_BASE` 0.55, `+0.15` per companion fighting beside you, capped at `BREAK_MAX` 0.95 (nothing is ever
certain — the T77 clamp rule). **A failed attempt is answered; a successful one is not.**

### The party in the fight

`fightingCompanions(state, node)` — alive, here, standing order **`follow`**, trust ≥ `ORDER_TRUST_MIN`
(80). Each swings for 1–2 at a 40% hit chance off a **new `party` RNG stream**, and each adds
`COMPANION_SOAK` 0.2 to the chance a blow aimed at you lands on them instead, **capped at
`COMPANION_SOAK_MAX` 0.5**. A companion past `COMPANION_FATAL_BURDEN` 60 dies — through **`killCompanion`,
which now has its first caller in the project's history**.

The trust gate is the point. Before T82 the ladder unlocked a menu entry; now it buys someone who will
stand in front of a walker for you, and a companion recruited at 70 and never fed will follow you, watch,
and do nothing.

### The Last Stand

`LAST_STAND_AT` **80** in `sim/survival.ts`; `inLastStand(state)`; `runEndReason` returns `lastStand`
**first**, ahead of infection and thirst, because a player who is held, badly hurt *and* out of water died
in the grapple.

### `RUN_END_REASONS` — a drift guard the task was forced to build

`prototype/testlab/src/checks.ts` held a hand-written `new Set(["starved","dehydrated","infection"])`, and
the moment a fourth reason existed the Lab **failed 11 of 24 soak runs on correct behaviour**. The engine
now exports `RUN_END_REASONS`, built from a `Record<RunEndReason, true>` that will not compile if a future
reason is forgotten, and **three** hand-written copies now derive from it (`checks.ts`, `runner.ts`'s
`EndKind`, and `test/core.test.ts`). The `runner.ts` one was the dangerous one: it laundered the engine's
value past the compiler with `as EndKind`, so it failed *silently* where `checks.ts` failed loudly.

---

## 4. Measured after

### The duel (400 per cell, strike only, fought to the end)

```
  enemy   party  trust  order     E[h]  P(hurt)  P(bite)  cWounds  cDeaths  P(win)  grabbed
  walker      0      0  follow    2.28    59.8%    29.5%     0.00     0.00   98.8%     0.27
  walker      1     70  follow    2.28    59.8%    29.5%     0.00     0.00   98.8%     0.27   <- untrusted: identical
  walker      1     90  follow    1.79    30.3%    14.8%     0.09     0.00   99.5%     0.12
  walker      1     90  hold      2.28    59.8%    29.5%     0.00     0.00   98.8%     0.27   <- held: identical
  walker      3     90  follow    1.34     8.8%     4.5%     0.09     0.00  100.0%     0.03

  riot        0      0  follow    6.12    99.5%    84.8%     0.00     0.00   26.0%     2.19
  riot        1     90  follow    5.95    95.5%    72.3%     0.53     0.02   59.0%     1.70
  riot        3     90  follow    4.72    66.3%    37.8%     0.94     0.01   92.3%     0.83
```

The two identical rows are the trust gate and the standing order doing their jobs, proven by pairing on
seed rather than by a rate. **A bare-handed Riot fight went from a 100% win to a 26% one.**

### What ends a run now (120 bot runs per policy, shipped city)

| policy | mean end day | combat turns | grabbed | run ends | **ended by a fight** |
|---|---|---|---|---|---|
| fights everything, never retreats | 3.67 | 810 | 12.8% | lastStand 77 · dehydrated 37 · infection 5 · starved 1 | **64%** |
| disengages once hurt | 4.38 | 422 | 19.9% | dehydrated 77 · infection 32 · lastStand 10 · starved 1 | **8%** |
| three trusted companions | 4.86 | 319 | 5.6% | dehydrated 103 · lastStand 8 · infection 8 · starved 1 | **7%** |

Before T82 all three numbers were **0%**. The eightfold gap between the first two rows is the skill
gradient the task exists to create: *the best fight is the one avoided* is now a claim with a number
behind it.

The probe carries its own correctness check: a counter records, **after each action**, how often the run
reached "grabbed AND burden ≥ 80", and that count must equal the Last Stand count exactly. It does
(77 = 77, 10 = 10, 8 = 8). A first cut sampled **before** the action and reported `0` for a policy that
was ending 69 runs in a Last Stand — the turn that reaches the condition ends the run, so the loop broke
before recording it. **A before-the-action probe cannot see the state it is looking for.**

---

## 5. The dials, and the sweeps that set them

Every one was swept by rebuild. None was chosen and then justified.

**`LAST_STAND_AT` = 80** — share of runs ending in a Last Stand (fights-everything · disengages-when-hurt):

| 60 | **80** | 120 | 160 |
|---|---|---|---|
| 68% · 20% | **64% · 8%** | 55% · 3% | 48% · **0%** |

The right-hand column chose it. At 160 a careful player is **absolutely immune** (0 of 120 runs, across
475 combat turns and 111 grabs) and a canonical death scene nobody can reach is worse than not having one.
At 60 the careful player dies one run in five, which stops punishing carelessness and starts punishing
play.

**`COMPANION_FATAL_BURDEN` = 60** — the first cut was 100 and it was wrong:

| fatal | companions lost / 360 | deaths per Riot duel | in the fiction |
|---|---|---|---|
| 40 | 40 (11%) | 0.55 | one bite kills — no warning |
| **60** | **5 (1.4%)** | **0.13** | **survive one wound, die on the second** |
| 70 | 2 (0.6%) | 0.09 | usually survive two |
| 100 | **0 (0%)** | 0.01 | **no risk term at all** |

100 lost **zero of 360 companions across 120 runs** — a party you cannot lose makes recruiting free again,
which is the defect this task exists to remove wearing a different hat.

**`COMPANION_SOAK` = 0.2, capped at 0.5** — the obvious version (0.3 each, summed, uncapped) made a party
of three a power tier:

| | solo | 0.3 uncapped | **0.2 capped at 0.5** |
|---|---|---|---|
| walker, P(hurt) | 59.8% | 1.5% | **8.8%** |
| Riot, P(hurt) | 99.5% | 19.5% | **66.3%** |
| Riot, P(win) | 26.0% | **100.0%** | **92.3%** |

**`BREAK_BASE` = 0.55** — swept 0.35/0.45/0.55/0.70 → 68%/16% · 66%/14% · **64%/8%** · 62%/6%. Note which
column it moves: it barely touches the brawler, who is dying to a grab he never tried to escape, and
halves the careful player's risk. It is the dial for *how much a good decision is worth*.

**`GRAB_CHANCE` = 1/3** — swept against `LAST_STAND_AT`, and the finding is that **it is not a lethality
dial**: halving it moved the Last Stand share by 1–2 points at every threshold where the threshold moved
it by 20. It sets how often you lose your way out, not how often that kills you.

---

## 6. The three defects the build introduced and the audit caught

An adversarial audit of my own tree found twelve confirmed issues. The three that were real defects
rather than prose:

1. **BREAK FREE was a free action.** The first `resolveBreak` took its roll and returned — it never called
   `enemyRetaliate`. Measured over 400 seeded Riot fights: a break turn wounded the player **0 times**
   where a strike in the same position wounded them **212**. A verb that costs an hour and carries no risk
   is strictly better than everything else on the menu, so the mechanic designed to corner you shipped
   with a free exit — **T80's dominant-HEAVY defect, from the other direction**. A failed attempt is now
   answered; a successful one is not. The comment defending the old behaviour asserted that being grabbed
   "halves your damage" and that "every turn you spend in it is a turn the enemy is answering": the first
   described an implementation this task had already replaced, and the second was false for the only turn
   the paragraph was about.
2. **A dead enemy kept swinging.** `resolveStrike` called `enemyRetaliate` unconditionally after the
   party's swings, so when a *companion* landed the killing blow the corpse — already cleared from
   `combat` and removed from the roster — still took a draw and landed a wound, on **15% of party kill
   turns**. It was the only path by which a `wound.bite` and its infection clock could come from something
   already dead, and the only way a companion could be killed by an enemy that no longer existed. (The
   heavy path's deliberate "answered even when it dies" rule is untouched: that one is about *your*
   committed swing putting you inside its reach.)
3. **A dead affordance, found by the test suite before the audit.** The brief says "strikes deal less", so
   the first cut halved the rolled damage, floored at 1. Bare hands roll 1–2, so halving lands on 1 every
   time — and 1 is exactly the Riot's `armor`. A grabbed, bare-handed player therefore dealt **literally
   zero damage to a Riot, on every swing, forever**, while `strike` sat on the menu costing an hour and
   drawing a retaliation. Replaced by dropping to the bare-hands *profile*, which reuses the fallback a
   broken weapon already takes, adds no new arithmetic, and puts the sharpest price of the grab on the
   player best equipped to pay it.

The audit also found that **three "swept in `measure/t82.ts`" comments described sweeps the committed
runner could not perform**, and that a `COMPANION_SOAK` comparison quoted numbers from a build three
changes stale. Both are fixed by having actually run the sweeps (§5) and by naming the rebuild that
reproduces the rejected row. And **one test was vacuous**: "a FAILED attempt costs the turn and nothing
else" re-ran a single pure call 60 times behind
`expect(failures).toBeGreaterThanOrEqual(0)` — an assertion true of every possible value. It is now two
paired rates over 300 different seeds, and it asserts that both branches occur.

---

## 7. Mutation testing

**39 mutants · round 1 31/39 · round 2 (survivors + one fixed anchor) 5/5 real ones killed · round 3, the
full set against the finished tree, 37/39** — the two survivors being an intentional no-op control and
one proven-equivalent mutant. The tree was verified pristine by `diff -r` **before and after every
mutant**, and the runner **refuses to start** unless it matches a pre-audit snapshot. That guard earned
its keep immediately: it aborted a run the moment I added this file to `docs/qa/` while it was going,
which is precisely the T80 failure it was written to prevent (a killed run that left a mutant applied,
and a meaningless 35/35 on the next).

**Six real survivors in round 1, and they cluster.** Five of the six were in the *party* code, which is
the half of this task with the least prior art:

- **`BREAK_PER_COMPANION → 0` survived**, because the test asserted
  `breakFreeChance(one) === BREAK_BASE + BREAK_PER_COMPANION` — an equation that stays true when the
  constant is zero. **The T77 rule again: assert a ceiling against a literal, or the assertion is just
  the code restated.** Now pinned at 0.55 / 0.70 / 0.95.
- **`COMPANION_HIT_CHANCE → 1` and companions piercing armor both survived** — nothing in the suite ever
  looked at what a companion's swing *did*, only at its downstream effects. A party that always connects
  and punches through a Riot's plate would have made armor a headcount problem rather than the weapon
  problem T80 deliberately made it.
- **`idx = 0` survived** — three companions could have been one companion and two bystanders, and no test
  asked which of them stepped in.
- **And the worst one: the audit fix from §6.2 — "a dead enemy answers a companion's kill" — survived,
  because I shipped the fix without a test.** That is the T77 lesson verbatim (*"a fix made in response
  to an audit is still a fix, and needs its own test in the same breath"*), and I hit it again in the
  same project four tasks later. It now has a regression test that uses a **walker** specifically:
  a walker has no `burstInfection`, so on a kill turn there is no legitimate source of a wound at all
  and any wound is the corpse's.
- The sixth, `grabbed: false` slipped into `resolveStrike`'s rebuilt `combat` object, would have handed
  the player their retreats back for free after one swing. Swinging is not escaping, and now a test says so.

**The two survivors are declared, not counted as kills.**

- The **no-op control** must survive; a mutation runner that kills a `void 0;` is measuring something
  other than the code.
- **"party stream touched even with no party"** — removing the `helpers.length === 0` early return from
  `companionsStrike` is **genuinely equivalent**: the `for` loop over an empty array takes no draws, so
  the `party` stream is still never created and the function still returns the identical state. Verified
  by probe rather than asserted (a solo six-exchange Riot fight leaves `rng.streams["party"]`
  `undefined` either way). The early return is a readability guard, not a behavioural one.

---

## 8. Declared limits — do not re-claim these as closed

- **PL-M5-44 — it is an ENDING, not yet a STAND.** `runEndReason` is read before any choice is offered, so
  the blow that completes the condition ends the run on the same frame. The player gets no final turn and
  nothing to spend, which is precisely what GDD IX asks a Last Stand to be. T82 delivers the **trigger**
  plus one line of placeholder prose; **T62** authors the scene. `endingNarration("lastStand")` is the only
  branch in that function expected to be replaced rather than kept.
- **PL-M5-45 — not balanced against difficulty modes.** `LAST_STAND_AT` is a flat 80 on Story and Ironman
  alike, which is almost certainly wrong. T59/T60's, with the rest of the balance pass.
- **PL-M5-46 — the grab prices melee and leaves firearms untouched.** A shot fired point-blank at
  something holding you is exactly as accurate and as damaging as any other shot, so an armed player's
  only cost for the grab is the lost retreat. This **widens PL-M5-38** (firing is already the safest verb)
  rather than narrowing it.
- **PL-M5-47 — a wounded companion can never be treated.** `tickCompanions` drifts their needs and nothing
  heals their wounds; the share verbs pass food and water, not bandages, and `advanceInfection` is called
  only for the player, so a companion's bite is inert over time. A fighting companion's wounds therefore
  accumulate monotonically all run, and the player's only lever is the `order:hold` that keeps them out of
  the next fight. Measured: 76 open wounds across 345 surviving companions in 120 runs.
- **FR-CBT-05 is narrowed, deliberately and visibly.** The guarantee now reads: a player who has not
  entered a fight can always slip past — `slip` is offered at every contested node and is untouched. A
  player who *is* in a fight and has been grabbed cannot walk away until they are loose. A stealth-only
  survivor can still cross the whole city without one option ever being withheld, which is the
  requirement's actual text.
- **Companion combat is participation, not autonomy.** No fear/panic model (FR-CBT-09), no per-companion
  competence or morale, no orders inside a fight. PL-M4-07's autonomy half stays open.
- **`PARTY_CAP` is now a decision but a shallow one.** Bringing three is better than bringing one on every
  measured axis except the risk of losing them; there is no upkeep cost inside a fight.
- **NOT inert in bot play** — unlike T78, T79 and T81. The testlab soak moves from
  `{infection 6, dehydrated 18}` / 1077 actions / 62 combats to **`{lastStand 11, infection 5,
  dehydrated 8}` / 955 actions / 44 combats**, mean end day 4.3 → 3.8. Eleven of 24 Lab runs now end in a
  fight. Stated plainly because it re-baselines every soak figure recorded before this task.
- **`inLastStand` has no caller outside the engine and its tests.** Exported for T62. Named here because
  this task's own headline finding is that `killCompanion` sat exported and uncalled for two milestones.
