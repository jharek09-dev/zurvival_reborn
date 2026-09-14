# QA Review — M5 T87: the terminal project (a win condition, and a run that escalates toward it)

**Date:** 2026-09-14 · **Task:** T87 (M5, seq 110) · **Design review step 10**
**Status:** DONE. Full CI green — engine **1151** / harness **310** / content-loader 23 / testlab 22 /
schema gate **182 entries across 15 types** / a11y OK. `tsc --noEmit` clean in all four packages.
All **1105** pre-existing engine tests and all **287** pre-existing harness tests passed **unedited**.
Save schema stays **v10** — no migration rung.

Re-derive every number below with `prototype/harness/measure/t87.ts`.

---

## 1. What the brief got right, and it is the reason this task exists

> `runEndReason` returns exactly `'starved' | 'dehydrated' | 'infection'` — three ways to lose and ZERO
> ways to win; `story.endingFlags` is an empty stub.

Half stale, wholly true in substance. T82 added a fourth losing reason (`lastStand`), so it was **four
ways to lose and zero to win**. And `endingFlags` was worse than a stub: `measure/t87.ts --dead` finds
exactly **two non-comment mentions of it in the entire engine, both of them declarations** —
`createInitialState.ts:101` and `types.ts:634`. No writer, no reader, set in **0 of 40** measured runs.
A field named for the endings it would assemble, holding nothing, for ten milestones. There is no
`win` / `victory` / `escape` / `evacuation` identifier anywhere in `engine/src`.

The brief's second exact claim, which it stated almost in passing and which turned out to be the most
consequential fact in the task:

> the contest drains regions on a wall clock whether you visit or not — Rivermouth empties itself by
> about day 8 even if you never enter it

Measured (`--drain`, a bot that never moves and never searches):

```
  day  the-terraces  hillcrest  ironworks  rivermouth  mercy-hosp  downtown
    0       55          50         60          70          75         85
    4        0           0         34          37          56         72
    8        0           0          0           0          27         53
   20        0           0          0           0           0          0
```

Exact for Rivermouth, and **the whole city is at loot 0 by day 20**. Nothing tells the player this.

---

## 2. What the brief got wrong — and it is the whole premise of its prescribed fix

> a 3–4 stage departure-or-holdout project … **whose inputs are deliberately the resources the economy
> over-produces and never spends**. `item.batteries`, `item.lighter`, `item.blanket` and
> `item.charcoal` currently have ZERO consumers anywhere in the codebase and `item.tools` has exactly
> one, once, ever; this is their sink, with no new items invented.

**There is no surplus.** `--surplus`, the goal-directed settler T85 built, 40 runs × 600 actions:

```
  end day 3.0   (lastStand 33 · dehydrated 5 · infection 2)
  HELD at the end:  scrap 0.93 · canned-food 1.70 · water 0.68 · charcoal 0.38 · cloth 0.38
                    batteries 0.20 · lighter 0.15 · fuel 0.05 · tools 0.00 · blanket 0.00
```

`--ceiling` and `--ledger-immortal` remove mortality from the question — an IMMORTAL settler, mean end
day **36.6**, every item type it ever gained:

```
  item.scrap      6.28   in 100% of runs     <- THE ONLY ABUNDANT THING IN THE GAME
  water 1.10 · bandage 1.03 · cloth 1.00 · food-fresh .97 · canned .93 · charcoal .68 ·
  lighter .67 · chair-leg .63 · batteries .56 · water-dirty .55 · … · fuel 0.03
  item.tools and item.blanket DO NOT APPEAR AT ALL, in 40 immortal runs of 36 days each.
  companions 0.00 · stash 0.00 units   <- the base produces nothing; there are no residents.
  node kinds searched: generic 41.8% · store 31.1% · medical 9.9% · police 9.0% ·
                       industrial 7.2% · **residential 0.9%**
```

So `item.blanket`, `item.fuel` and `item.tools` are **not unspent surpluses — they are not obtainable**.
Their problem is SUPPLY, not sink: their tables (`residential`, `industrial`) are very nearly never
rolled. Pricing a stage in one of them would have been the **T85 cistern defect exactly** — a fix
priced out of the reach of the thing it fixes — one task later.

The item claims are also stale in the other direction (`--items`): `item.batteries` is consumed by
`recipe.shelter.radio-room`, `item.charcoal` by `recipe.medical.antibiotics` **and T85's
`recipe.purify.filter`**, and `item.tools` by three recipes, not one. **Only `item.lighter` and
`item.blanket` were genuinely consumer-free.**

And the brief's framing claim:

> the direct fix for 'hour 20 has a NARROWER decision space than hour 2'

is **false as a count** (`--arc`, immortal settler, 40 runs): day 1 offers **5.05** actions, day 20
offers **6.21**. Flat, very slightly widening. What is true is that the *kinds* never change: it is the
same six verbs forever, and no new class of decision ever arrives. That is the defect, and it is what a
terminal project fixes — but it had to be restated before it could be built against.

---

## 3. The shape that shipped, and why each part of it is different from the brief's

### 3.1 Not a sink for a surplus — the first DEMAND the economy has ever had
The dead items are dead because **nothing ever wanted them**. A stage that wants one is the fix, and it
is simultaneously the game's first goal-directed reason to search the districts nobody searches.

### 3.2 A stage is paid with ANY ONE of a MENU (`accepts`), not a bill of materials
The ledger is thin and wide — nine things at about one unit a run — so a *conjunctive* cost is
unpayable and a *disjunctive* one is payable many ways. This is the load-bearing design decision of the
task. It turns every named dead item into an **alternate payment** rather than a hard gate: reachable,
and a real choice ("spend the scrap you were saving for the cistern, or the lighter you will never
otherwise use").

### 3.3 The two projects are EXCLUSIVE
`project.departure.the-long-road` (a truck: `escape` → `ending.escaped`) and
`project.holdout.the-last-block` (the walls: `holdout` → `ending.held`). Committing to one forecloses
the other. That is the decision the late game never had.

### 3.4 State lives nowhere new
Stage completion is a boolean set and `story.endingFlags` is a `Flags` that has been in the save since
v1 holding nothing. So the project writes there — `project.commit.<id>`,
`project.stage.<id>.<stageId>`, and on the last stage `ending.escaped` / `ending.held`, which is the
only thing `runEndReason` reads. **Save stays v10**, and the field finally means its name.

This is the one place the T79/T84/T85/T86 *derive-don't-store* rule was deliberately bent, for one
reason: `runEndReason(state)` takes no graph and is called from four packages, so the terminal condition
has to be answerable from state alone.

### 3.5 Every stage RAISES something — and the brief's version of that was measured INERT
Each stage carries a one-shot `escalation` (region or city threat / density / survivorActivity), plus a
**standing** lift: `projectAlarm(state)` = stages × `PROJECT_ALARM_PER_STAGE`, capped, riding
`driftAnchor`'s new `alarm` term exactly as T79's neglect rides its `neglect` term. Derived every tick,
never stored.

`--escal` sweeps the standing dial at 0 / 3 / 6 / 10, paired on seed, sampled at FIXED days:

```
  PER_STAGE = 0 (the one-shots ALONE):
    day  3   threat +0.2   density -0.3
    day  8   threat +0.3   density -0.8
    day 16   threat -1.9   density -3.1
```

**An authored one-shot on a relaxing system is erased by the next few turns** — the drift pulls the
region straight back to its anchor, and by day 16 the project arm is *quieter* than the control. This is
T78's finding ("the first cut was consistent, tested and INERT") and T79's ("a threat-only lift is
INERT") arriving a third time. **An escalation that is not on the ANCHOR is not an escalation.** The
shipped dial is **8 / cap 20**:

```
  day  stages  alarm |  threat ON / OFF  delta |  density ON / OFF  delta
    3    1.25    9.8 |    58.5 /  53.0    +5.6 |    63.5 /  58.6    +4.9
    5    1.35   10.4 |    63.9 /  54.6    +9.3 |    68.4 /  60.3    +8.1
    8    1.55   11.6 |    68.7 /  58.8    +9.9 |    71.8 /  64.3    +7.4
   16    1.60   12.0 |    77.1 /  70.7    +6.4 |    79.5 /  75.1    +4.4
```

**The first cut of this probe produced a clean FALSE trend** (+1.7 threat, −0.8 density, "inert") by
reading the world at RUN END — and the project arm *wins*, so it ends on a different, earlier day than
the arm that cannot. The T81 probe lesson, re-earned. The honest comparison is at the same clock.

### 3.6 The gate
Everything is dark unless the content set authors projects (`projectsActive`) — the T83 `claimable` /
T84 `richness` / T85 `roomSlots` / T86 optional-`graph?` discipline. No pool ⇒ no verbs, no flags, no
escalation, the same four losing reasons, and a `driftAnchor` that is arithmetically T79's. The
integration audit **verified this empirically**: two bots driven through the new tree and the pristine
baseline with no pool registered produced **byte-identical** narration, choice-id lists and save blobs
across four seeds. No RNG is drawn anywhere in `sim/project.ts`.

---

## 4. Does it work? Reach, measured

`--project` (the undirected T85 settler, which simply takes a project verb when it sees one),
`--zealot-mortal` (a bot that drives at the project and shops for it), `--zealot` (the same, immortal):

| | commits | stage 1 | stage 2 | stage 3 | **WON** | end day |
|---|---|---|---|---|---|---|
| undirected settler, mortal | 97.5% (day 2.0) | 95.0% | 15.0% | 5.0% | **5.0%** | 3.3 |
| directed bot, mortal | 97.5% (day 2.0) | 95.0% | 45.0% | 20.0% | **20.0%** | 3.3 |
| directed bot, IMMORTAL (the ceiling) | 100% (day 2.0) | 100% | 95.0% (day 8.1) | 82.5% (day 15.3) | **82.5%** | 19.3 |

**A run can now be won in ordinary play**, and playing for it roughly quadruples the odds. The
gradient is the intended one: the first stage lands in 95% of runs on day two (payable out of T85's
claim salvage alone), the second is a real supply trip, the third is the night you invite.

### The two dials that measurement moved, and both were nearly shipped wrong
1. **A first cut let the holdout accept food, water or a bandage.** A mortal bot then won **45% of runs
   by day 2.3** — because the starting kit *is* food and water. **A survival consumable is free
   currency**: the player is required to carry it, so a stage priced in it costs nothing. Now pinned by
   a test that refuses any consumable on any menu.
2. **The correction overshot: 0 of 80 mortal runs won.** The wall was the final stage, priced as a
   third shopping trip. The fix is a design correction, not a number: **the last stage's price is the
   night it invites, not another haul** — six alternates of one unit each, a long time cost, and the
   largest escalation in the project. 20% / 82.5% is the result.

---

## 5. Adversarial audit — 9 claims, 7 real

Two audit subagents, one on the module's logic and one on the wiring.

1. **The siting rule was enforced only in the CHOICE list.** `projectChoices` required standing in your
   own base; the resolver did not. Pipeline stage 1 runs `assertLegal` only for an action carrying a
   `choiceId`, so a forged action reached the resolver untouched — the auditor **finished the entire
   project from another district, at `timeCost` 0**, escalating a region that was not the base's. The
   module's own comment claimed the rule was "checked here as well". Now it is.
2. **A stage id of `committed` produced the commit flag itself.** `project.<id>.committed` (commit) vs
   `project.<id>.<stageId>` (stage) collide when the stage is called `committed`, which the schema's
   slug pattern permits: committing silently completed that stage, and on a one-stage project left a run
   **permanently committed to something it could never finish and was never told about**. Fixed by
   disjoint PREFIXES — `project.commit.` and `project.stage.` — which no author-supplied id can cross.
   Any *suffix* rule has this failure somewhere.
3. **A base can be LOST after you commit** (a siege breach or the abandon verb clear `shelterId`), and
   the line then said *"the work is at your base"* — pointing at a building that was not yours. The T86
   finding-4 failure in its worst form: not silent, **wrong**.
4. **Exclusivity was pool-relative, not save-relative.** Retire a project between builds and a save
   holding its commit flag was offered the whole fork again — one run, two projects. The flags are save
   data, so the rule that rests on them is now answered from the flags (`hasCommitted`).
5. **Duplicate stage ids let one payment settle two stages.** The schema cannot express uniqueness
   across an array of objects, so `buildRegionGraph` now refuses it, where `indexById` already refuses
   duplicate node ids.
6. **`PROJECT_ALARM_CAP` cannot bind in live play** — 3 stages × 8 = 24 → 20, but the third stage ends
   the run on the frame it lands, so the most a live state shows is 16. **Not fixed: declared.** It
   bounds CONTENT (the schema permits six stages, worth 48 — half the scale), exactly as `driftAnchor`'s
   own `neglect` and `bias` clamps never bind on their own callers. Written into the constant's doc
   rather than left implied.
7. **`consume` would have stripped a tracked artifact's stack** without cleaning `state.items` or
   `player.equipment` — a weapon held in a hand that no longer carries it. Latent (no shipped menu names
   a weapon), fixed at the root: a project is paid in STACKS, and an `itemId` entry is never counted or
   spent.
8. **A won run played the LOSS tone.** `soundscape.ts` branched on `isRunOver`, which stopped being a
   synonym for "died": the holdout ending rendered under *"Everything falls away to a single held
   note"*, the loss one-shot, on every surface at once. `hopeTheme` has been authored in the tone table
   since T56 and unreachable ever since **for want of exactly this event**. It is reachable now.
9. **The three new Living-History beats fell through to the raw-key default** — `project.complete`, the
   single most important line a won run writes and the beat T61 assembles an ending FROM, rendered as
   *"Day 5, 10:00 — project complete."* Now sentences, and on the base screen's news feed where base
   news belongs.

Two claims did not survive scrutiny and were not changed: the argument-order and byte-identity worries
(both verified clean by the auditor's own script-parsed sweep of every call site).

**One more, found by the integration audit and fixed here even though it is T81's:** the browser-playable
beta at `prototype/harness/web/ui.js` passed only ten arguments to `startRun`, so it had **never
registered the weapon pool either** — the page's README claimed a boot that mirrors `playCli.ts` and had
been wrong since T81. Both pools are wired now, and the README says what is true.

---

## 6. Mutation testing — 67 mutants

Method per the T85/T86 note and it held: a scoped suite (8 files / 181 tests / **4.5 s**, against the
full 1151 / ~30 s), chunks of ten, and a runner whose **pre-flight residue check aborts unless every
mutant's original text is present exactly once**. No sweep timed out, no mutant was left applied.

**65 killed, 2 proven equivalent** (the proofs are in the code, not here):
- the all-zero-escalation fast path — deleting it is behaviour-identical, because `changed` stays false
  and the function returns `state` anyway;
- `escalate` reading the shelter's region rather than the player's — identical **given** the resolver's
  siting guard, and written the way the schema PROMISES rather than the way the caller happens to make
  true.

**FOUR of the round-one survivors were test gaps, and all four were in the WIRING, not in the module.**
The module's own logic killed everything thrown at it; what nothing pinned was that `driftRegions`
actually *reads* `projectAlarm` (replacing it with a literal `0` survived), that the `neglect` and
`alarm` arguments are not **swapped** at that call site (invisible to any "is it bigger" assertion —
the clamps differ, 10 vs 20, so the assertion is now exact), that a pool-less graph carries **no**
`projects` key, and that `projectLine` actually reaches `sceneOf` (a `toContain("scrap")` check passed
without it, because other segments mention scrap). Seventh consecutive task for the T75/T77 family
lesson, in a new shape: **the fixes were tested; the seams were not.**

**Every audit-fix test was run against a copy of the UNFIXED tree before it was believed** — 12 of 15
engine cases and 4 of 7 harness cases failed there, as they must. **One passed, and was rewritten**: the
`escalate` shelter-region test was vacuous because the player is standing at the base in it. That is
T86's lesson landing on this task's own work, and it is the reason the equivalence is now declared in
prose instead of fake-covered by a test.

**The pre-flight residue check also caught a defect nothing else did:** my own comment-rot edit had left
**duplicate `case "escaped"` / `case "held"` labels** in `endingNarration`. TypeScript accepts them and
all 1151 tests passed over the unreachable copy; only "the original appears 2× in this file" found it.

---

## 7. Honest limits — do NOT re-claim these

- **PL-M5-65 — the win is reachable but the RUN is still short.** A directed mortal bot wins 20% of
  runs, on day 2.4; `lastStand` still ends 15–27 of 40. The ending is reachable; the *long* run it was
  meant to resolve is not, and that is T82's mortality curve and T59/T60's to settle — the same ceiling
  T86 declared, unchanged by this task.
- **PL-M5-66 — the city empties itself by day 20 and nothing says so.** The project has a hard,
  unsignposted deadline imposed by the loot contest. This task measured it; it did not fix it.
- **PL-M5-67 — a run that wins while dying reports the WIN.** `runEndReason` checks `lastStand`, then
  the win, then infection/thirst/hunger. The shade of a pyrrhic escape is in the Living History, which
  is what T61 assembles an ending FROM; it is not in the run-end reason.
- **PL-M5-68 — the per-stage one-shot `escalation` is very nearly inert on its own.** The standing
  anchor lift is doing essentially all of the work (§3.5). The one-shot is kept because it spikes the
  region for the few turns that detection, encounters and spawns roll against, but no measurement here
  separates that from noise.
- **`PROJECT_ALARM_CAP` never binds on the shipped content** — a content bound, declared (§5.6).
- **INERT in the testlab soak**, byte-identical to T84's, T85's and T86's
  (`{lastStand 10, infection 6, dehydrated 8}` / 985 actions / day 3.8): none of the Lab's four policies
  claims a base, so none of them can commit. **PL-M5-50, fourth consecutive task.**
- `item.blanket`, `item.fuel` and `item.tools` now have somewhere to go, but are still **very nearly
  undroppable** — that is a loot-table question (T84's territory), not this one's.

## 8. Files

New: `prototype/engine/src/sim/project.ts`, `content/schemas/project.schema.json`,
`content/projects/project.departure.the-long-road.json`,
`content/projects/project.holdout.the-last-block.json`,
`prototype/engine/test/project.test.ts`, `prototype/engine/test/projectAudit.test.ts`,
`prototype/harness/test/project.test.ts`, `prototype/harness/test/projectContent.test.ts`,
`prototype/harness/measure/t87.ts`.

Changed: `engine/src/{sim/survival.ts, sim/regionDrift.ts, actions/coreActions.ts, map/types.ts,
map/regionGraph.ts, map/seedWorld.ts, index.ts}`, `harness/src/{playCli.ts, screens.ts, soundscape.ts,
play.ts}`, `harness/web/{ui.js, build-html.mjs, README.md}`,
`testlab/src/{boot.ts, loadContent.ts}`, `testlab/web/build.mjs`.
