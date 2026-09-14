# QA Review — T83 · Night attacks, siege resolution and shelter loss

**Date:** 2026-09-14 · **Milestone:** M5 (sixth task, seq 106) · **Task:** T83 (design review 2026-09-12, step 9)
**Requirements:** FR-SHL-06 (Must/MVP) · FR-SHL-10 (Must/MVP) · GDD Part XI *"it can be lost — overrun, burned, or abandoned"*
**Closes:** PL-M3-06, PL-M3-08, PL-M4-39 (three parking-lot entries about the same missing system)
**Half-closes:** **PL-M3-07** (the relocate/abandon clause only — the generic-`barricades` reuse, the silent `fortify` and the first-pass dials all stand) · **PL-M5-18** (the `overrunsPlayer` clause only — `repopulate.ts` and `hordes.ts#massAction` still exclude the base unconditionally, recorded as PL-M5-51)
**Status:** DONE
**Not byte-identical**, declared, like T71/T72/T74–T82. A base can now be lost; that is the task.

**CI (clean sandbox):** engine **955** (was 911 at T82, **+44**) / harness **273** (was 270) /
content-loader **23** / testlab **22** / schema gate **173** / a11y gate OK / `tsc --noEmit` clean in
all four packages.

**Save schema v10 holds.** The one new field, `World.siegeHours`, is **optional and absent-reads-as-0** —
the T74 accumulator precedent already listed in `World` itself. Everything else this task writes
(`shelterId`, `barricades`, `walkers`, `player.stash`, `actors`) already existed. No migration rung.

**Measurement runner committed** at `prototype/harness/measure/t83.ts` (the T77 rule — scratch-script
numbers are unverifiable). Every figure below is re-derivable:

```
npx tsx measure/t83.ts              # structure: what the shelter layer could and could not reach
npx tsx measure/t83.ts --noise      # the brief's trigger, measured   (default style `normal`)
npx tsx measure/t83.ts --near       # how close a mass ever comes to a claimed base
npx tsx measure/t83.ts --bill       # does LOUD play pull a mass toward home?
npx tsx measure/t83.ts --home       # bot play: claiming, fortifying, losing the base
npx tsx measure/t83.ts --siege      # the pressure/defence/overflow distribution the dials came from
npx tsx measure/t83.ts --wall       # a pinned wall against a pinned mass, on a fixture
npx tsx measure/t83.ts --party      # does a bigger party make the base safe, or the party safe?
```

**Every bot-play mode prints the policy style it ran and honours `T83_STYLE`.** That is load-bearing,
not decoration: `normal` settles whatever node it stands on, `seeker` walks to an authored safehouse
first, and the `claimable` gate *is* the difference between them — a figure quoted without its style is
not reproducible. An earlier cut of this document quoted `normal` numbers against a command that had
been changed to run `seeker`; the adversarial audit caught it, and fixing the runner rather than the
prose is what "re-derivable on demand" has to mean.

---

## 1. What was wrong — measured before anything was built

`measure/t83.ts` on the **pre-T83 tree**:

| probe | pre-T83 |
|---|---|
| hits for `raid` / `attack` / `breach` / `siege` / `assault` in `sim/shelter.ts` | **0** (the only `horde` hits are two words in a comment) |
| writers of `Player.shelterId` in the whole engine | **1** (`claimShelter`) — and **0** that clear it |
| engine sites reading `NodeDef.claimable` | **0**, against **14 of 60** nodes that author it |
| bot runs that claimed the **start node** (`node.rivermouth.transit-plaza`, which is *not* claimable), style `normal` | **60 / 60, on day 1** — 1 distinct node across 60 runs |
| `overrunsPlayer` at your own base | exempt **unconditionally** (PL-M5-18) |
| runs that ever lost a base | **0**, by construction |

So the base was the one place in the city immune to everything M5 spent five tasks building, and
`shelterId` was a one-way door.

### 1.1 The brief's trigger was a coin with one side

The brief specified: *"accumulated `NodeState.noise` at the shelter draws a horde during the sleep
window."* Measured over **46 bedtimes in 60 runs** (`--noise`, pre-T83 tree, style `normal`):

```
base noise at bedtime  min       0
                       median    10
                       max       10
  bedtimes with noise >= 20          0     0.0%
```

Against a **0–100** field. Four independent reasons, each sufficient alone:

1. the base is **the one node a settled player never searches** — claiming it *requires* `searchPct >= 100`, and `search` (25) is the only loud verb in the core loop;
2. every verb performed at home — claim, fortify, deposit, withdraw, rest, sleep — is **silent** (`noiseOf` returns `NOISE_REST` 0 for all of them);
3. arrival deposits `NOISE_MOVE` **8** and decay is **5/hour**, so it is gone in two hours;
4. a fortified base **muffles up to 20 per tick** — twice the entire observed range of the thing the brief wanted to read.

And the causal chain the brief assumes is already broken one layer down: **`REPATH_NOISE` is 30**, so a
claimed base can never redirect a horde toward itself, whatever it does.

This is the third task running where measuring first found the brief describing a chain the engine does
not contain — T81's "content with no path to the player", T82's unreachable *"no discovered escape
target"* conjunct, and now this.

### 1.2 What IS reachable at the same instant

Same runs, same command:

```
carried horde mass within 2 hops of home   0 · 0 · 53   (mean 3.2)   <- real range, mostly zero
home region zombieDensity                 40 · 47 · 49  (mean 46.4)  <- the standing dead
loudest node within ONE hop of home        0 · 10 · 95  (mean 12.5)  <- where a run's sound lives
walkers on home + its neighbours            0 ·  0 ·  2  (mean 0.2)
```

`siegePressure` reads the first three, at the scale each actually has. The noise term is **the
neighbourhood, not the doorstep**: a settled player's sound lives on the blocks they work.

### 1.3 The bill is real, and it is thin — measured, not asserted

The task note's thesis sentence is *"this is the task that makes noise the Survival Triangle's bill for
a run of loud, fast play."* Stated as a claim and then tested (`--bill`, 60 runs a style):

| style | mean hops to nearest mass | mass within 1 hop | mean neighbourhood noise |
|---|---|---|---|
| loud | 3.8 | **16.0%** | 9.5 |
| quiet | 4.5 | **6.7%** | 2.2 |

The pull exists, because a **night** search deposits 25 + 12 = 37, which clears `REPATH_NOISE` where
nothing at the base ever can. **2.4×** is the honest size of the claim: a real gradient, not a dominant
one.

> The first cut of `quiet` simply never searched — so it never claimed, contributed **zero samples**, and
> the A/B printed a clean `0.0%` that was entirely the instrument. That is the T81 probe-defect lesson,
> hit a third time. `quiet` now searches only until it has a base.

---

## 2. What shipped

### 2.1 `sim/siege.ts` — the night attack

- **One roll per night, banked in hours.** Night is the six phase-hours 21–02. A turn contributes the
  night hours its **span** covered, **not the phase it resolved in** — a 9-hour `sleep` from 21:00 lands
  at 06:00 in phase `dawn`, so a resolved-phase gate would have made the one turn this system exists for
  the one turn that could never fire. A T74-class truncation trap, avoided because it was looked for.
- **`siegePressure`** = mass in earshot / 2 + density / 6 + neighbourhood noise / 5, clamped 0–100.
- **`siegeDefence`** = the building (12) + each lookout (20) + each other body at the base (8) + the
  player if they are home (15). **The wall is deliberately not in it** — see §3.1.
- **Losses in the order a base falls**: the wall absorbs point for point; what gets past comes out of the
  cache via `depleteStash` (FR-SHL-03's own hook, and T40's cold-raid prose template); then the people.
- **The breach.** Wall already at 0 *and* more than `SIEGE_BREACH_AT` got past ⇒ `shelterId` is cleared,
  the cache scatters, and two walkers are left standing in the rooms.
- **New named `siege` RNG stream**, so a run that never claims is byte-identical — which is most of the
  existing suite.

### 2.2 `overrunsPlayer` — PL-M5-18 half-closed

The exemption narrows from *your own shelter* to *your own shelter whose wall is still standing*
(`SHELTER_SANCTUARY_AT`). The wall is literally what keeps a mass out; a breached base is the open
street. **Only that clause**: `repopulate.ts` still refuses to spawn a body at the base and
`hordes.ts#massAction` still refuses to shed one there, neither reading `barricades` (§5, PL-M5-51).

### 2.3 `NodeDef.claimable` — the fourteen safehouses stop being decorative

Behind an **active-system gate** of exactly the `jobsActive` / T81-weapon-pool shape: if no node in the
graph declares `claimable`, the rule is dark and every node is claimable (the pre-T83 behaviour, so every
fixture graph and golden run is untouched); if any node declares it, only declared nodes qualify.

The shipped city declares 14. The start node is **not** one of them; the nearest is
`node.rivermouth.marina`, **2 hops away** — four hours of walking and six of searching.

And a **legibility line**, without which the rule is invisible: standing on an unstripped safehouse with
nowhere to live now reads *"This place could be made to hold — if you stripped it out first."*

### 2.4 `abandon-shelter` — PL-M3-07 half-closed

One hour, offered only at the door. Leaves the cache, the wall and the dead exactly where they stand —
the opposite of a breach. Both ways of ending a tenancy route through one `releaseShelter`.

This is the **relocate/abandon clause of PL-M3-07 and nothing else**. Three of that entry's four parts
stand: fortification still reuses the generic `NodeState.barricades`, `fortify` is still **silent**
(which T83's own measurement leaned on — it is part of why a base can carry no noise), and the costs and
rates are still first-pass, with the fortify *economy* parked as PL-M5-48 for T85.

---

## 3. Dials — every one swept by rebuild, every one forced by measurement

### 3.1 The wall was counted twice (a defect the fixture table found)

The first build had `barricades` in `siegeDefence` **and** as the damage sink, so the same points were
subtracted twice. At 25 barricades the base lost **0.0 cache units against a mass of 120** — total
immunity bought with one scrap. After the split, that cell reads **1.9 units**.

Be precise about what the split did *not* change: the **breach** share at 25 barricades was 0.0% before
and is 0.0% after. That is `wallBefore === 0` at work — any standing wall is absolutely breach-proof, by
design — and it would read the same with the wall counted three times.

### 3.2 `SIEGE_MASS_DIVISOR` = 2 — bodies per point of pressure

| divisor | landed nights that breached | breached, all nights | held |
|---|---|---|---|
| 1 | **15 / 18** | 28.8% | 3 |
| **2** | **5 / 14** | **9.1%** | **8** |
| 3 | 2 / 12 | 3.6% | 9 |
| 4 | **0 / 11** | 0.0% | 10 |

At 1 the system is a guillotine; at 4 the loss is **unreachable**, and a canonical loss nobody can reach
is worse than none (T82's `LAST_STAND_AT` argument).

### 3.3 `SIEGE_BASE_DEFENCE` = 12 — what the building is worth

| value | landed nights that breached | repelled |
|---|---|---|
| 0 | 10 / 13 | 0 |
| **12** | **5 / 14** | **1** |
| 25 | 2 / 14 | 1 |
| 40 | **0 / 14** | 8 |

This term exists because the first build did not have it and produced **34 passed / 18 breached / 0 held
/ 0 repelled** — every siege that came took the base. A base you are not standing in had a defence of
literally zero.

### 3.4 `SIEGE_BREACH_AT` = 30 — the night that takes the house

| value | landed nights that breached | held |
|---|---|---|
| 10 | **12 / 13** | 0 |
| 20 | 10 / 13 | 2 |
| **30** | **5 / 14** | **8** |
| 45 | 1 / 14 | 12 |

The first build breached on *any* overflow against a bare wall, which is why 18 of 18 landed sieges were
total losses with no gradient. A night has to be able to cost you the cache and a companion and still
leave you the roof.

### 3.5 `SIEGE_HEARING` = 2 — and 3 is a dead knob

| hops | median pressure | landed nights that breached |
|---|---|---|
| 1 | 24 | 1 / 11 |
| **2** | **30** | **5 / 14** |
| 3 | 32 | 5 / 15 |

The third ring almost never holds a mass the second does not. It is **not** a reach radius — a mass two
hops out cannot arrive tonight (`HORDE_HOURS_PER_STEP` 4 against a six-hour night is exactly one hop);
what the second ring buys is anticipation.

### 3.6 `SIEGE_MIN_PRESSURE` = 12 is a FLOOR, not a dial — declared

| value | passed | breached | landed that breached |
|---|---|---|---|
| 0 | 42 | 5 | 5 / 14 |
| **12** | **41** | **5** | **5 / 14** |
| 25 | 29 | 5 | 5 / 14 |
| 40 | 5 | 6 | 6 / 7 |

0 and 12 are indistinguishable on shipped content — the home district's own density already contributes
7 and a night's residual noise usually covers the rest, so the threshold suppresses **one night in 56**.
It earns its place only on a genuinely dead district (the `--wall` table's `mass 0` column, where
pressure is 7 and nothing ever rolls). Recorded as a guard, not claimed as tuned.

### 3.7 The wall table (`--wall`, 200 seeds a cell, player AWAY)

```
  wall            mass   0          mass  20          mass  40          mass  80          mass 120
     0      0/200 0.0% 0.0   32/200 0.0% 0.0   59/200 0.0% 0.3  98/200 49.0% 4.9 137/200 68.5% 6.8
    25      0/200 0.0% 0.0   36/200 0.0% 0.0   52/200 0.0% 0.0   88/200 0.0% 0.4  129/200 0.0% 1.9
    50      0/200 0.0% 0.0   30/200 0.0% 0.0   57/200 0.0% 0.0   98/200 0.0% 0.0  131/200 0.0% 0.0
    75      0/200 0.0% 0.0   40/200 0.0% 0.0   57/200 0.0% 0.0   97/200 0.0% 0.0  126/200 0.0% 0.0
   100      0/200 0.0% 0.0   34/200 0.0% 0.0   51/200 0.0% 0.0   88/200 0.0% 0.0  132/200 0.0% 0.0
```

*(cell: nights that landed / nights rolled · share that breached · mean cache units lost)*

**25 points of wall — one scrap — removes the breach entirely.** The system is answerable. Whether the
player can *afford* the answer is §5.1.

---

## 4. Three defects the build introduced (all caught pre-ship)

1. **The wall was counted twice** (§3.1) — found by the fixture table, not by reading.
2. **The fatal threshold made a party arithmetically immune.** Every body at the base adds 8 to the
   defence, which *subtracts* from the overflow the fatal check read — so measured on the fixture, a
   defender died on **69% of the heaviest nights at a party of one and on 0.0% at a party of two or
   three, at every mass.** That is T82's `COMPANION_FATAL_BURDEN` finding — *"a party you cannot lose is
   recruiting-is-free again"* — recurring in a second system one task later. Fixed by splitting the
   quantities: the party still protects the **stores** (`past`), but the **toll** the people take is the
   night less the building less the wall, independent of how many of them there were. After: 69 / 66 /
   66% at parties of 1 / 2 / 3.
3. **The siege narration did not read the walls.** `siegeLine` compared pressure against `siegeDefence`
   alone, which deliberately excludes `barricades` — so at a **hundred** barricades it said *"the walls
   will not hold all of it"*: wrong in exactly the case fortifying exists to fix, in the only sentence
   the player ever gets about the night.

## 4b. What the adversarial audit found in my own tree

A subagent audit of the finished tree returned **27 findings**: 9 real defects, 16 false or overstated
claims in comments, and the test weaknesses below. The worst three, beyond §4:

- **The change did not typecheck.** `npx tsc --noEmit` was red in `prototype/engine` while `vitest` was
  green, because vitest does not typecheck. CI runs both; a suite passing is not a build passing.
- **A `NaN` horde size reached `state.history` and the save as `null`.** `Math.max(0, Math.min(100, NaN))`
  does **not** scrub — it returns `NaN`, which then fails `< SIEGE_MIN_PRESSURE` and lands in a beat.
  `test/overrun.test.ts` has a test named for exactly this lossy-save bug; T83 reintroduced it one layer
  up. Now scrubbed through `wholeHours`, as every other accumulator site is.
- **A tenancy left three things behind.** The banked `world.siegeHours` survived the loss of a base, so
  five hours banked at a base you no longer hold bought a siege check on the first hour of the next one;
  and a resident's `job:` flag survived, which (because `withJob` forces `order: hold`) stranded them
  permanently at a node that was no longer a base, with no job pool able to reach them. Both now go
  through one `releaseShelter`, shared by the breach and the abandon verb.

Also fixed: a graph-less `advanceWorld` banked and then **spent** nights that could not resolve;
`SIEGE_WALL_LOSS_PER_POINT` mixed barricade points with pressure points and drove `past` negative at any
value but 1 (deleted — a knob correct at one value is not a knob); `nightHoursIn` looped over an
unvalidated `timeCost` and is now closed-form; and `shelterLine(state)` in `harness/src/screens.ts` was
never given the graph, so **the siege line never reached the base screen at all** — the exact hole an
optional `graph` parameter creates.

**Test weaknesses the audit named, and fixed:** six assertions that restated the implementation
(`toBe(Math.trunc(46 / SIEGE_DENSITY_DIVISOR))` passes at a divisor of 900) now assert **literals**; a
self-cancelling ternary; a "hears exactly 2 hops" test on a map with no node 3 hops away, so the
exclusion it was named for was unreachable; two `if (…) return` guards that would silently delete whole
assertion blocks on the next retune; and — the one that mattered most — **every search loop varied
`meta.turn` rather than the seed**, so it drew the identical float every iteration and sampled a
distribution of size one.

Sixteen false claims were corrected rather than defended, including two measurement tables quoted
against a command that had since been changed to run a different policy style, a *"played and
fast-forwarded nights cost the same"* parity claim that a probe disproved on 2 of 5 seeds, and *"this
module removes the immunity"* where it removes one of three.

---

## 4c. Mutation — 57 mutants, three rounds

| round | result |
|---|---|
| 1 (first build of the tests) | **49 / 57** killed |
| 2 (the five real gaps, re-run) | **5 / 5** killed |
| 3 (full set, finished tree) | **54 / 57** killed |

The three round-3 survivors are all accounted for and none is a missing test:

- **the intentional no-op control** (a one-character comment edit). It *must* survive, or the harness is
  lying about everything else it reports.
- **`if (nightHours === 0 && carried === 0)` → `if (nightHours === 0)`** — a redundant fast path, proved
  rather than assumed: `bankHours` keeps `rest < per`, so a carry is always 0–5 and `bankHours(carry, 0,
  6)` yields `steps 0` and `rest === carry`, returning the same object by the other path. Verified
  exhaustively over **all 1026 (carry, startHour, hours) triples with `nightHoursIn === 0`** — the same
  object, 1026 of 1026.
- **the post-breach `break`** — likewise redundant: `resolveOneNight` returns on a null `shelterId` in
  its own first two lines. Verified over **400 ten-night spans**: no beat ever follows a `siege.breached`.

**What the five round-1 gaps were, because the pattern is the point.** Two were **audit fixes shipped
without a test** — the graph-less-advance guard and the `siegeLine` wall read — which is the T77 lesson
landing for the third task running and, this time, *inside the same task that had just recorded it*. One
was an assertion that restated the implementation (`toBe(b < SHELTER_SANCTUARY_AT)` passes at a threshold
of 50). One was a genuinely untested branch (the night's own coin — nothing asserted that a night which
*can* come sometimes does not). And one was a hole created by a neighbouring mechanic: every cache
assertion used a mass big enough to **breach**, and `breachShelter` scatters the whole cache on its own,
so the ordinary `depleteStash` step could be made a no-op and nothing noticed.

Round 3 also caught **two mutants that round 1 had killed and my own later edits let through** — a
`SIEGE_BREACH_WALKERS` assertion that had become `>= SIEGE_BREACH_WALKERS` (trivially true at 0) and the
stream name, which every determinism test in the file moved together with whichever stream it was drawn
from. Both now assert literals and behaviour. A mutation score is a measurement of the tests at one
instant, not a certificate.

### The tooling failure worth recording

The first mutation run was **killed by a 10-minute command timeout, so its `finally` never ran, and it
left a mutant applied** — `SHELTER_SANCTUARY_AT` at 0. The next chunk then scored 9 of 9 against a
corrupted tree and reported the two mutants for that constant as "pattern not found" rather than as an
alarm. This is T80's lesson exactly — *"a mutation score is worth only what the pristine-tree check
behind it is worth"* — and the per-chunk hash guard did not catch it because it snapshots at the start of
its own chunk. The runner now does a **pre-flight residue check**: every mutant's ORIGINAL text must be
present in the tree before a single one is applied, or it aborts. The tree was restored, CI re-proved
green, and rounds 2 and 3 ran clean.

---

## 5. Declared limits — do NOT re-claim

- **PL-M5-48 — fortification is economically out of reach, so the bare-wall row is the row the player
  lives in.** Peak scrap carried averages **0.3–0.4 units a whole run**, `fortify` is chosen **0.1 times
  per claimed run**, and a claimed base carries any wall at all on **4.2% of based turns** (109 of 2579).
  One scrap buys 25 points, which decay erases in a day. That is T85's economy brief, measured here and
  *not* patched here.
- **PL-M5-49 — the narrowed sanctuary locks the player out of the remedy at the moment of collision.**
  `availableActions` returns `overrunChoices` before `shelterChoices`, so at a 0-wall base with a mass on
  it the player gets flight and the hold, and cannot `fortify` or `abandon`. Fortifying answers the
  siege *before* the night, never during it.
- **A played night and a fast-forwarded one are NOT identical** — only the COUNT is. `tickSiege` resolves
  all banked nights against one frozen snapshot of `hordes`/`noise`/`density`, because the world layers
  run before it. Same declared class as `sim/clocks.ts`'s RNG-per-tick exception and T76's horde body
  trade. Disproved the first draft's parity claim on 2 of 5 seeds.
- **Two of the base's three immunities remain.** `repopulate.ts` still refuses to spawn a body at the
  base and `hordes.ts#massAction` still refuses to shed one there, neither reading `barricades`. So a
  mass standing **on** the base is counted at hop 0 while leaving nothing behind it.
- **`siege.passed` is deliberately absent from the base screen's report set** (74.5% of resolved nights);
  it still renders in the Map & Journal log.
- **50 barricades is total cache immunity** at every mass the shipped city can produce. Defensible at two
  scrap and a 50-hour decay, but it is a ceiling, not a curve.
- **INERT IN THE TESTLAB SOAK, for a measured reason.** 64 runs: 2519 → **2517** actions, identical end
  mix, identical mean end day 3.8. The reason is not that the system is weak: **the testlab's four
  policies claim a base in 0 of 32 runs, on both trees.** Five tasks of shelter work (T37/T38/T39/T52/T83)
  are never exercised by the project's own soak — parked as **PL-M5-50**.

---

## 6. Before → after, the same instrument on both trees

`--home`, 60 runs, style `seeker` (a bot that walks to an authored safehouse — the honest instrument once
the `claimable` gate is live):

| | pre-T83 | post-T83 |
|---|---|---|
| runs that claimed a shelter | 44/60 (73.3%) | 44/60 (73.3%) |
| mean claim day | 2.0 | 2.0 |
| **runs that LOST the base** | **0** | **4** |
| siege beats | `{}` | `{passed 41, held 8, repelled 1, breached 5}` |
| mean end day | 2.8 | 2.9 |
| run ends | `lastStand 42, dehydrated 11, infection 7` | `lastStand 42, dehydrated 8, infection 10` |

**T83 does not make the game more lethal — it adds a loss that is not a death.** `lastStand` is 42 on
both trees.

And the `claimable` gate, style `normal` (a bot that settles where it stands):

| | pre-T83 | post-T83 |
|---|---|---|
| runs that claimed | **60/60 (100%)** | **2/60 (3.3%)** |
| mean claim day | 1.0 | 4.0 |

**The gate costs nothing to a player who knows where the safehouses are, and everything to one who
settles where they stand.** WHERE you claim is now a decision, which is what fourteen hand-authored
safehouses were for.

---

## 7. Verdict

**PASS.** The system is reachable, answerable, and not a guillotine: 9.1% of resolved nights breach at a
bare base, 0.0% at any standing wall, and 4 of 60 seeker runs lose their home. Three of the four dials
were moved by measurement after their first value proved wrong, and the two most important defects (the
double-counted wall and the immune party) were found by fixture tables rather than by reading. The
honest caveat is §5.1: on the shipped economy the player cannot usually afford the wall, so T83 ships a
system whose answer is written and whose price is T85's to make payable.
