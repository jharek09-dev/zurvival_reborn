# QA Review — T62 · Failure endings with closure: the Last Stand is a *stand*

**Task** T62 (M5, `seq` 112) · **FR-CBT-10** (Should, MVP) + **FR-STY-07** (Must, MVP) · GDD Part IX
"Canonical: the Last Stand", Part XIII "Failure endings"
**Date** 2026-09-14 · **Build** on T61 · **Closes** PL-M5-44, PL-M4-20, PL-M5-69 · **Further-closes** PL-M5-71
**CI** engine **1307** · harness **343** · content-loader 23 · testlab 22 · schema **190 across 17 types** · a11y OK
**Runner** `prototype/harness/measure/t62.ts` (9 modes; asserts nothing, CI does not run it)

---

## 1. The defect, measured rather than asserted

A Last Stand is **the single commonest way a run ends**, and every single one of them was a card.

`measure/t62.ts --reach` and `--stand`, 40 runs a policy, 600 actions:

| policy | ends in a Last Stand | turns of agency in it | choices at the closing frame |
|---|---|---|---|
| settler | 67.5% (27) | **0.00** | **0.00** |
| drifter | 77.5% (31) | **0.00** | **0.00** |
| brawler | 75.0% (30) | **0.00** | **0.00** |
| homebody | 35.0% (14) | **0.00** | **0.00** |
| **all** | **102 of 160 (63.8%)** | **0.00** | **0.00** |

`runEndReason` is read at the top of `availableActions`, which returns `[]` the instant it is non-null.
The blow that completed the condition ended the run on the same frame: no final turn, nothing to spend,
and therefore precisely the *"You Died" card* FR-STY-07 forbids and GDD IX rule 5 calls a screen rather
than a scene. T82 shipped the trigger and declared this (PL-M5-44); this task is the scene it opens.

Two of FR-STY-07's three named failure endings also turned out not to exist as run-end reasons at all
(`--structure`): there is **no `overrun` reason** — a horde wounds you and never ends the run — and **no
shelter-loss reason** — `breachShelter` takes the base, never the survivor. What exists is four deaths.

---

## 2. THE GDD NAMES THREE SPENDS AND TWO OF THEM DO NOT EXIST

This is the finding that set the shape of the task, and it is the T87 finding arriving for the second
time in two tasks (*"the prescribed cure rested on a surplus that does not exist"*).

GDD IX's own examples are *"hold the door so a companion gets out, take as many with you as you can, say
the thing you never said"*. **Two of the three name a person.** `--hands`, measured at the exact frame
the condition becomes true, over those 102 stands:

| at the stand | |
|---|---|
| companions at your side | **0.00 · 0.0% of stands** |
| survivors ever *met* | **0.00 · 0.0% of stands** |
| at a base you still hold | **0.0%** |
| carrying a loaded firearm | **0.0%** |
| holding any weapon at all | 5.9% |
| **items in the pack** | **3.72 · 97.1% carry something** |
| other dead standing with you | 1.76 (≥2: 56.9%, ≥3: 16.7%) |
| wounds / burden | 6.87 / **218.6** — the line is **80** |
| day | **2.5** |

What is actually in the pack: canned food 80.4%, water 52.0%, scrap 46.1%, charcoal 18.6%, a bandage
2.0%. So the survivor this scene is written for is **alone, on day two and a half, two-and-a-half times
past what their body can take, holding a can of food and a bottle of water, with no one to hold a door
for and no one left to say anything to.**

An authored sequence built on the GDD's three examples would have shipped with two of its three branches
unreachable. So the acts are a **menu, not a script** — T61's load-bearing decision applied one layer
down — the reachable acts are written against the pack, and the two people-acts (`hold-the-door`,
`say-it`) are authored anyway as acts that never fire rather than branches that crash. They light up
with no code change the day T59/T60 move the mortality curve (PL-M5-72).

---

## 3. What shipped

1. **A death opens the stand instead of ending the run.** `runEndReason` reports **null** for exactly
   that window, so `isRunOver`, the harness loops, the Test Lab runner and `sceneOf` all go on meaning
   what they always meant. That is the T87 lesson from the other side: *the way to add a terminal state
   safely is to not make every reader learn about it.*
2. **It lasts exactly one turn.** GDD IX says *"one last set of choices"*, singular. Every act ends the
   run, so the window cannot be held open, farmed, or escaped from — measured at **1.00** turns.
3. **All four DEATHS open one**, not just the fight. A `lastStand`-only build would have left 36.2% of
   deaths on the card. Neither **win** opens one: `escaped` and `held` close on the project's own words.
4. **No new state, no save rung.** Two keys in the existing `story.endingFlags` (a `Flags` record since
   v7). **Save stays v10.**
5. **New LEAF `sim/stand.ts`**; **17th schema-gated content type** `content/stands/` — 4 files, 18 acts,
   one def per death; plus the engine's own unconditional floor act (`Stop fighting it.`), which lives in
   code so the T57 exit-gate invariant cannot be broken by a content set that authors nothing admissible.
6. **Gated like every pool since T81.** No pool ⇒ the armed flag is never seeded ⇒ byte-identical.

### Result

`--acts` / `--distinct`, 160 finished runs across four policies:

| | before | after |
|---|---|---|
| deaths that got a final set of choices | **0 of 160** | **160 of 160 (100%)** |
| turns of agency in a stand | 0.00 | **1.00** |
| acts offered (incl. the floor) | — | 3.71, from **8 distinct menus** |
| the floor act offered | — | **100.0%** of stands |
| distinct closing texts | 47 | **58** |
| distinct Last Stand texts | 22 | **27** |
| distinct ending clauses firing | 24 | **31** |
| shape `sacrifice` | **0.0%** | **36.3%** |
| shape `fade` | 62.5% | 36.3% |
| shape `entrenchment` | 37.5% | 27.5% |

The run-end distribution is **unchanged to the decimal** (67.5 / 77.5 / 75.0 / 35.0), which is the right
invariant: T62 changes what happens at a death, not which runs die.

---

## 4. PL-M5-69 closed WITHOUT widening `sacrifice`

T61 authored `ending.sacrifice.json` and declared it unreachable. **Both obvious repairs measured dead**:

- **A fight at your own door.** Re-derived with a new `homebody` policy that claims the nearest base and
  then stays in it: **15.2 turns a run inside a held base, 75% of runs, and in combat there on 0.00 of
  them.** T76's hard sanctuary and T83's siege-as-event own that between them.
- **A breach becoming a fight.** `--siege`, 480 runs: **17 breaches, and not one with the player at
  home** — because `SIEGE_PLAYER_DEFENCE` (15) is *larger* than `SIEGE_BASE_DEFENCE` (12), so standing
  in your own base is the thing that stops it being breached.

The route that opened is this task's own. Before T62 a death contained no **act**, so `atBase` was the
only proxy available for *"this death bought something"*. Now an act declares the shape it resolves
toward, which **narrows** `sacrifice` to *died doing something for something else* rather than widening
it to *died somewhere* — the thing T61 explicitly refused. `atBase` is untouched and still a route.

Only the two acts that buy someone else time or ground declare it (`hold-the-line`, `hold-the-door`). A
first cut also let `leave-what-you-carry` declare it and `sacrifice` took **51.2%** of all runs; a gift
you were about to stop needing is not a sacrifice, and dropping the claim gave the measured 36.3 / 36.3 /
27.5 three-way split.

### The cost of reaching a shape — the task's sharpest surprise

Every clause in `ending.sacrifice.json` quietly assumed a base, because T61 could author *"you went down
at your own door"* safely only while the shape was unreachable. Reaching it turned **seven** of them into
sentences simply false of the runs printing them (`the-long-hold` told a bot that had never claimed
anything that it "had held that address for days"; `cost-them` printed "you did not go quietly and it was
not cheap for them" over a fever death).

**And gating them correctly made things worse before it made them better.** With the base clauses gated,
a rootless survivor had four admissible clauses against a cap of three, and **distinct Last Stand texts
FELL from 22 to 17.** It took **nine new run-fact clauses** on the same axes `fade` already had — nodes
seen, nodes cleaned, overruns, survivors lost, humanity shift, days — before the number recovered to 27.
**Reaching a shape costs content**, and the ending clause ceiling went 24 → 32 to pay for it.

A second false start belongs here too: the act-keyed clauses were first authored at weights 62–80 and
*lowered the* count, because the act's own text is already `lines[1]` and a high-weight clause restating
it took a permanent slot. Dropped to 26–44 they land only in a thin ending. **That is T61's own
`requiresAlone` dial lesson, recurring one task later.**

---

## 5. Nine audit findings, all nine real

The three worst were each a different kind of quiet failure.

1. **The act-prose lookup returned the wrong def's words — 10 of 18 authored act texts could never
   print.** Three act ids are authored in all four files with *different* prose (leaving your pack reads
   differently when you are bleeding out than when you have been out of water for a day). `standActLine`
   scanned the pool and took the first hit, which is always `stand.fever` — so every death got the fever
   file's words. **And it was not even stable**: the shipped terminal harness loads content with an
   unsorted `readdirSync`, so *which* file's prose printed was filesystem-order dependent — the precise
   machine-independence the act sort's id tiebreak exists to buy, lost one function later. Fixed by
   recording the death in the beat and resolving against its own def.
2. **The FLOOR act declared a shape, destroying the only `sacrifice` route that existed before this
   task.** `STAND_FLOOR_SHAPE = "fade"` on the one act present on every menu, above every derived test:
   a survivor who went down *inside a base they still held* and chose "Stop fighting it" was reported as
   a `fade` where T61's `atBase` rule says `sacrifice`. It now declares nothing — stopping is what you do
   when there is nothing left to spend, not a claim about what the run was.
3. **Emptying the pack left the hand full.** `drop` cleared `inventory` alone, so `player.equipment` went
   on pointing at an item id the pack no longer carried and the instance stayed stranded in `state.items`
   — a dangling reference that survives a save round-trip, under prose about setting everything down.
   Now mirrors the `drop` verb's own bookkeeping.
4. **`sacrifice` is unreachable from a quiet death, so two new clauses were dead on arrival.** Both
   routes into the shape imply `reason === "lastStand"`. `the-fever-took-you` and `the-dry-end` were
   **deleted rather than left as decoration**, along with three more gated on acts that declare no shape.
   The schema's claim that T62 reaches the shape "from all four deaths" was false and is corrected
   (PL-M5-73).
5. **A final kill never removed the body**, so three authored sentences ("one less of them on this
   street", "the street is one body lighter") were false. Now goes through the roster exactly as
   `killEnemy` does, with the kill table's own `CORPSES_PER_KILL`/`BLOOD_PER_KILL` rather than a second
   set of numbers — the invented `STAND_BLOOD = 12` was documented as "the walker table's own deposit"
   and the walker table's deposit is **18**.
6. **"There are four words on the wall"** — `STAND_NOTE` is *"dead here — careful"*, which is **three**.
   The same clause also claimed to be "the only thing in this city" in the player's handwriting, which
   the `pin` verb makes false and nothing in `EndingRequirement` can gate on. Reworded.
7. **The mark was written twice** when the node already carried it — and not as a corner case: `noteFor`
   offers this exact phrase *first* whenever a node has corpses on it, i.e. exactly where a Last Stand
   happens. Now deduped like `noteFor`.
8. **An entrenchment clause asserted a run-long habit nothing gates** ("the way you had been writing on
   walls all run", for a player who may never have touched `pin`). Reworded.
9. **`hold-the-line`'s plural was wrong most of the time it fired.** `walkers` counts the one holding
   you, so `minWalkers: 2` means *the grabber plus exactly one more* about 70% of the time it fires.
   Reworded to be true at one other.

The auditor also noted a gap rather than a defect: the runtime content guard validated ids, reasons,
shapes and requirement keys but **not** `effect`, a numeric `weight`, or the schema's own rule that
`effect: "kill"` requires `requiresCombat`. All three are now checked at the door, which is the point of
having one — **neither shipping client runs the schema at boot.**

**Ten audit-fix tests were run against `/root/zb-unfixed`, the tree as it stood when the findings landed:
seven failed there.** The three that passed are deliberate paired negative cases asserting behaviour that
was already right and must stay right.

---

## 6. Mutation — 69 mutants, 68 killed, 1 PROVEN equivalent

Scoped suite (8 files / 255 tests / **4.6 s** against the full 1307 / ~30 s), chunks of ≤10, with a
pre-flight residue check that aborts without touching the tree unless every mutant's original text is
present exactly once.

**60 killed first round. Of the nine survivors, six were test gaps, one was a REAL HOLE, and two were
only equivalent after that hole was fixed.**

The hole: `standSpent` read one of the two flags a spend writes, so a state carrying
`stand.death.<reason>` without `stand.spent` — a hand-edited save, or one written by a build that set
only one — had `standIsOpen` **and** `isRunOver` both true, and which one the player got came down to the
order of two branches in `availableActions`. That is not a contract. `standSpent` now reads both halves.

Three of the six test gaps were **one missing case**: the *pyrrhic win*. `deathReason` checks the
finished project before the slow deaths, so a player who finishes the road while dying of thirst reports
`escaped` — and three separate mutants made that run open a stand no def covers, so **the run would
simply never end.**

The last survivor — swapping the stand branch below the run-over branch — is now **equivalent**, proved
exhaustively rather than argued: over all **1792 (state, flag-set) pairs** across seven bodies and every
subset of the eight stand flags, `standIsOpen && isRunOver` is true **0 times**. It is equivalent
*because* of the fix the mutation run itself forced.

**68/69 + 1 proven equivalent after six new tests.**

---

## 7. Byte-identity

`--identity` and `--identity-endings` drive six 400-action bot runs each, digesting every narration,
choice-id list and save blob, and compare against the **pristine pre-T62 baseline**:

| configuration | lines | chars | digest | baseline |
|---|---|---|---|---|
| no pools at all | 200 | 421,700 | `6a133f53bf94a152` | **identical** |
| endings registered, **stands not** | 200 | 424,102 | `4f3ebb52b3a733b0` | **identical** |

The second is the stronger claim and the one that matters: this task edited `ending.sacrifice.json`,
`ending.fade.json`, `ending.entrenchment.json` and the ending schema, and **none of it is visible to a
run played without stands.**

All **1216 pre-existing engine tests pass unedited** (one test *fixture* gained the two new `RunSummary`
fields, which `tsc --noEmit` caught and `vitest` did not — the **fifth** consecutive task for that
lesson).

---

## 8. Not inert in the Test Lab — the first M5 task in five that isn't

T83, T84, T85, T86 and T87 all had to declare themselves inert in the headless soak (PL-M5-50). T62 is
not: the Lab registers the pool, and **every one of the 24 soak runs that ends now goes through a stand**
(`ends {"lastStand":10,"infection":6,"dehydrated":8}`, 24/24 passed, 0 crashed). Both browser pages build
and register it too (`"stands":4` in each).

---

## 9. Declared limits — do NOT re-claim

- **PL-M5-72 — FR-STY-08 (epilogues) is deliberately NOT built**, and this task re-confirms T61's
  measurement with its own numbers: **0.00 companions standing and 0.00 survivors ever met, at the frame
  a stand opens, in 102 stands across 160 runs.** There is nobody to follow. The stand's act menu and the
  ending's clause menu can both hold an epilogue the day that changes. A reach problem, not a content one.
- **PL-M5-73 — `sacrifice` is a Last-Stand shape in the shipped set.** Both routes imply
  `reason === "lastStand"`. Changing it means deciding, honestly, that a quiet death can be a sacrifice;
  no shipped act claims it.
- **PL-M5-74 — the stand arms at `startRun`, so a run begun before T62 keeps its old ending**, even
  loaded by a client that ships stands. `runEndReason(state)` takes no graph — the same constraint that
  forced T87 to bend derive-don't-store, bent a second time for the same reason. No migration, no way to
  corrupt an in-flight save. T65's if the owner wants otherwise.
- **PL-M5-75 — no stand constant is run through `sim/difficulty.ts`** (the fourth consecutive task to say
  so). `STAND_ACT_LIMIT`, `STAND_COST`, `STAND_NOTE_MAX` and the act weights are flat on Story and
  Ironman alike. T59/T60's.
- **`starved` fires in 0.0% of 160 runs** across all four policies — the stand authored for it
  (`stand.hunger.json`) is real and tested, and nothing in ordinary play reaches it. Hunger loses the
  race to thirst every time. Worth a look in the T59/T60 balance pass.
- **The run is still short** (PL-M5-65, unchanged): a stand happens on day 2.5, and `escape` remains 0.0%
  in these policies because no bot in them finishes a project.

---

## 10. Files

**New** — `prototype/engine/src/sim/stand.ts`, `content/stands/*.json` (4),
`content/schemas/stand.schema.json`, `prototype/engine/test/stand.test.ts` (91 tests),
`prototype/harness/test/standContent.test.ts` (19), `prototype/harness/measure/t62.ts`.

**Changed** — `engine/src/{index.ts, sim/survival.ts, sim/ending.ts, actions/coreActions.ts,
map/regionGraph.ts, map/seedWorld.ts, map/types.ts}`, `engine/test/ending.test.ts`,
`harness/{src/playCli.ts, test/endingContent.test.ts, web/ui.js, web/build-html.mjs}`,
`testlab/src/{boot.ts, loadContent.ts}`, `testlab/web/build.mjs`,
`content/endings/{ending.sacrifice,ending.fade,ending.entrenchment}.json`,
`content/schemas/ending.schema.json`, `docs/status.json`, `CHANGELOG.md`.
