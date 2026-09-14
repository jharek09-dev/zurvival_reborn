# QA Review — T61 · Multiple endings assembled from run components

**Task** T61 (M5, `seq` 111) · **FR-STY-06** (Must, v1) · GDD Part XIII "Endings philosophy"
**Date** 2026-09-14 · **Build** on T87 · **Closes** PL-M5-67 · **Half-closes** PL-M4-15
**CI** engine **1216** · harness **324** · content-loader 23 · testlab 22 · schema **186 across 16 types** · a11y OK
**Runner** `prototype/harness/measure/t61.ts` (11 modes; asserts nothing, CI does not run it)

---

## 1. The defect, measured rather than asserted

Before T61 the closing text of a run was a function of **the run-end reason alone**.

`measure/t61.ts --distinct`, 40 goal-directed settler runs:

| | runs | distinct component fingerprints | **distinct closing texts** |
|---|---|---|---|
| dehydrated | 7 | 7 | **1** |
| infection | 3 | 3 | **1** |
| lastStand | 30 | 21 | **1** |
| **total** | **40** | **31** | **3** |

Thirty Last Stands — twenty-one of them materially different lives — printed the identical 137
characters. `--pyrrhic`, 120 project-directed runs: **5 wins → 1 closing text**, while 100% of those
wins were carrying wounds or fever, 100% ended alone, and 100% had someone dead behind them.

The PRD's own acceptance criterion for FR-STY-06 — *"two 'survival' endings differ based on tracked
components"* — was not merely unmet, it was **unreachable**. `assembleEnding` and `epilogue` had **zero
mentions** in the engine, and no code path anywhere read a single run component into the closing text.

### What the components were actually worth (`--components`, `--ceiling`, `--people`)

This is the reading that shaped the build, and half of it is bad news.

| component | mortal settler | immortal ceiling |
|---|---|---|
| history events per run | **100.3** (7–322), 19 beat types | **1402** (983–2100) |
| `moral` beats | 2.35/run, 97.5% of runs | — |
| humanity moved off baseline | **97.5%** of runs, 13 distinct values | 100%, 23 distinct |
| survivors DIED (`npc.died`) | 11.9/run, 80% of runs | **18.0 of 18, in 100% of runs** |
| base ever claimed | 77.5–80% | 100% |
| zombies put down | 4.3/run, 95% | 122.9/run |
| nodes entered | 3–7 | 7–31 (of 60) |
| **survivors MET** | **0.00** | **0.00** |
| **companions alive at end** | **0.00** | **0.00** |
| **`story.lore` / `story.mysteries`** | **0 entries, 100% of runs** | **0** |
| **faction reputation** | **0.00** | **0.00** |

Three consequences, and each one is load-bearing:

1. **The Living History is a genuinely rich source** — 19 beat types, `moral` in 97.5% of runs,
   `shelter.claimed` in 77.5%, the T83 siege outcomes in 45/10/7.5%. The FR's "the history is the
   source" is not aspirational; the log really does know what happened.
2. **The final frame is nearly empty by comparison.** So the summary reads the **log** for everything
   that *happened* and the state only for what is *true at the end*. A base claimed on day 2 and lost on
   day 9 is in the log; `player.shelterId` is null either way.
3. **"Who lived" — the GDD's first-named ending component — is measured to be NOBODY, always.** All 18
   authored survivors are dead in 100% of immortal runs, the player has met **zero** of them in any
   policy or mortality mode, and no companion has ever been standing at the end of a run in 320
   measured runs (T86's PL-M5-63). An ending built around the people you kept would have been born
   dead.

### Two brief claims corrected

- **`story.mysteries` is a stub**, exactly as `endingFlags` was before T87: two non-comment mentions,
  both declarations, 0 entries in 100% of runs. "Which mysteries you touched" has no data. Not built on.
- **The task note's humanity figures are stale.** It says "17 authored encounter effects … −78
  reachable". Measured: **20** `adjustHumanity` effects (10 negative, 10 positive), worst case −99.
  And the reachable range across 200 runs is **31–73** — the authored `≤28` and `≤12` bands in
  `humanityBand` are hit **0 times** (new PL-M5-70).

---

## 2. The shape of the fix

### The load-bearing decision: components are a MENU, not a template — and it is T87's

T87 found a thin-and-wide item ledger and answered it with a disjunctive `accepts` menu rather than a
bill of materials, so that every dead item became an *alternate payment* instead of a hard gate. The
components of a run are thin-and-wide in exactly the same way — each present in somewhere between 0%
and 100% of runs, and no fixed set present in most. An ending built from a template would print holes
or boilerplate for the ordinary run.

So an ending is **an opening plus the strongest `ENDING_CLAUSE_LIMIT` (3) clauses whose requirements the
run satisfies**. A component that is dead today is a **clause that never fires** rather than a gap in
the text — and lights up with no code change the day T59/T60 move the mortality curve. That is the same
trade as `accepts`, and it is the only reason this module can be honest about a game whose people all
die.

### There is no single true ending, and it is mechanical here

`EndingShape` is derived from what the run **was**, not from how it stopped. Two runs that both end in
a Last Stand are a `sacrifice` and a `fade` depending on whether you went down inside a door you had
claimed or out in a street you were passing through. Only `escaped` fixes a shape on its own.

### The first line is never replaced

`lines[0]` is *byte-for-byte* the text the run would have closed on before T61 — `winNarration` for the
two wins, `endingNarration` for the four deaths. Everything T61 adds is additional. That keeps the
authored scenes and their tests intact, keeps GDD IX rule 5 ("death in combat is a scene, not a screen")
true of the sentence the player reads first, and makes the content gate below trivially safe.

### What shipped

- **New LEAF module `sim/ending.ts`** — `summarizeRun` (30 components), `shapeOfSummary` / `endingShape`,
  `matchesEnding` (30-key closed requirement vocabulary), `assembleEnding`, `endingText`,
  `closingNarration`. Nothing in `sim/` imports it.
- **A 16th schema-gated content type** `content/endings/` + `content/schemas/ending.schema.json`, four
  files (one per shape), **52 authored clauses**.
- Pool plumbed through `graph.endings` → `buildRegionGraph` (11th arg) → `startRun` (12th arg) →
  `sceneOf`, plus the CLI, **both browser clients** and the testlab.
- **No new state, no save rung — save stays v10.** Everything is derived from `GameState` +
  `state.history`, so an ending is reproducible from seed + state: load a finished run on another
  machine and it closes on the same words.

### One thing deliberately NOT built

The shape is **not** stamped into the `run.ended` history beat, though that is the obvious move.
`recordHistory` diffs a turn whose own events have not been appended yet, so a siege resolved on the
final turn would be invisible to a shape computed there, and the stamped shape could disagree with the
one `assembleEnding` renders one frame later. **The shape is a read, and reads are taken from finished
state.**

---

## 3. Results

`--endings`, `--endings-holdout`, `--endings-zealot`:

| policy | finished runs | **distinct closing texts** | Last Stands → texts | wins → texts |
|---|---|---|---|---|
| **pre-T61** settler | 40 | **3** | 30 → **1** | 5 → **1** |
| settler | 40 | **23** | 25 → **15** | — |
| project-directed | 60 | **26** | 38 → 13 | 3 escapes → **2** |
| holdout-directed | 60 | **24** | 36 → 11 | 7 holds → **3** |

**FR-STY-06's acceptance criterion is met**: two "survival" endings differ based on tracked components
(3 escapes → 2 texts; 7 holds → 3 texts), and — the criterion's other half — a failure never shows a
bare "You Died": every one of the six run-end reasons closes on a scene, and now on a scene plus what
the run was.

**Clause supply is 3.7–4.2 admissible per run (1–7), and the cap binds in 60–70% of runs** — which is
the property that makes two runs of the same shape differ instead of converging on "everything that was
true of you". 31 of 52 authored clauses fire in a 241-run sweep (`--coverage`).

**PL-M5-67 closed.** A pyrrhic win now reads differently: `went-out-broken` / `the-fever-came-too` /
`went-out-whole` split the escapes, `barely-standing` / `clean-hold` split the holds.

**PL-M4-15 half-closed.** Humanity finally has a reader that changes output — `kept-your-hands` fires in
31.5% of runs, `hard-house` / `spent-yourself` / `the-price` carry the other direction. The honest half:
the clauses that fire are keyed on `humanityShift`, the *direction of travel*, because the absolute
`≤28` band the parking-lot note pointed at is unreachable (PL-M5-70).

---

## 4. Dials set by measurement

Every number below was moved by a reading, not by taste.

1. **An "alone" clause is a tautology and must not outrank a fact.** Companions are 0 in 320 runs, so
   `requiresAlone` is true of every run. A first cut put `escape/went-alone` at weight 76 to make the
   pyrrhic shade land — and it consumed a permanent slot in every escape ending, crowding out four
   clauses that said something specific. Returned to 40: it lands in a *thin* ending and loses to
   anything the run actually earned.
2. **A threshold the game cannot reach is not a threshold.** `entrenchment/a-long-run` at `minDays ≥ 8`
   fired 0/241; mortal runs end on day 1–5. Set to 4 (now 23.7%). `sacrifice/the-long-hold` 6 → 3.
3. **A bot that always takes the first fork only ever measures one win.** The two projects are
   exclusive, so the zealot policy measured `escaped` and never `held` — a property of the bot, not the
   game. A `holdout` policy that takes the other fork proves both: **7 holds in 60 runs**.
4. **The `entrenchment` opening was overclaiming.** With the shape firing for any claimed run (82%),
   *"you became part of what the city is now"* was being said over settlers who claimed on day 1.6 and
   died on day 2.9. Rewritten to be true at both ends of the range.

---

## 5. Adversarial audit — nine claims, seven real

An adversarial pass was run against the finished build. Each fix has a test in
`engine/test/endingAudit.test.ts`, and **17 of its 19 assertions fail against a copy of the unfixed
tree**; the two that pass are declared as a forward guard rather than left to look like regressions
(T86's lesson, landing on this task's own work).

1. **`sacrifice` fired for a survivor who died nowhere near the base.** The predicate mixed historical
   log counts with a final-frame fact and never asked *where you were*: a player grabbed in a pharmacy
   across the map while owning a fortified marina was told *"You went down at your own door"* directly
   under a first line reading *"the city closed over the place where you had been."* **A shape whose
   prose names a place must test that place.** Fixed with a new `RunSummary.atBase`.
2. **Two clauses narrated a mechanic the engine does not have.** `breachShelter` calls
   `releaseShelter` — a breach **takes the base off you permanently** — so `minBreached ≥ 1` was never
   evidence that *"you put the boards back and slept there again the following night."* Worse, because a
   breach also implies `baseLost`, the general line and the specific one printed back to back and
   contradicted each other. Both rewritten; a new `maxBreached` keeps the general line off the breach case.
3. **The `fade` opening called a settled survivor rootless.** `entrenchment` required rooms, stages or a
   defence *on top of* the claim, so a player who claimed a base and simply lived in it fell through to
   `fade` and was told *"nothing you had was yours for long"* — measured, that is the ordinary settled
   run, not an edge case. **Claiming an address is the whole of what entrenchment means.** The
   vocabulary was also monotone (every field a bound, none a negative), so the rootless clause could not
   be gated off a settler: `forbidsClaimed` added.
4. **A def with no `clauses` array passed the graph guard and threw a `TypeError` on the exact frame the
   player died.** The guard itself was written `e.clauses ?? []` — the author anticipated the case and
   then did not defend the consumer. Neither shipping client runs the schema, so `buildRegionGraph` is
   the runtime door: it now rejects the def, and `assembleEnding` tolerates one anyway.
5. **Two more silent content failures.** A typo'd `shape` ("entrenchement") passed every engine guard
   and silently deleted that shape's ending — indistinguishable from "the pool isn't registered". A
   typo'd `when` key (`minNights` for `minNightsHeld`) turned a gated clause **unconditional**, which is
   the opposite of what the author asked for. Both now throw, against an exported
   `ENDING_REQUIREMENT_KEYS` the schema is checked against in *both* directions.
6. **A non-numeric weight sorted to the FRONT and made the comparator non-transitive** — `NaN` is falsy,
   so such a pair fell through to the id tiebreak while numeric pairs still compared by weight, and
   `Array.prototype.sort` was free to decide the rest. That is precisely the machine-independence the id
   tiebreak exists to buy, lost to the one input nobody validates — and it failed in the unsafe
   direction. Coerced. A clause with empty prose also rendered as a silent double space; dropped.
7. **A summary of a LIVE run could name a death that had not happened.** `reason ?? "lastStand"` was
   defended on the grounds that `won` stayed false so nothing downstream could be fooled — and the one
   downstream consumer in the module read `reason` and reported a living settler as a `sacrifice`.
   `RunSummary.reason` is now `RunEndReason | null` and `endingShape` returns null for a live run.

Two claims were **latent rather than live** and are recorded as such: the shape and the clause tests
computed two separate summaries and agreed only because neither read the one field that needs the graph
(`committed`). They now share one fold — which also halves the walks over a log measured at up to 1402
events.

**Not defects, chased and cleared:** every beat type the summary counts is actually emitted (verified
against `history.ts`, `events.ts`, `siege.ts`, `social.ts`); `siege.held`/`siege.repelled` are
exclusive branches so `nightsHeld` cannot double-count; the gate and byte-identity hold over 40 driven
runs; purity and save/load reproducibility hold; the pool is in the right argument position in all four
clients; and no renderer keys on the narration *text*, so the longer closing breaks nothing.

---

## 6. Mutation testing — 48 mutants, 40 killed first time, 48/48 after

Scoped suite (6 files / 131 tests / **3.4s** vs the full 1216 / ~25s), chunks of ≤10, pre-flight residue
check, restore in `finally`.

| batch | target | first-round |
|---|---|---|
| 1 | `summarizeRun` components | 8/10 |
| 2 | `shapeOfSummary` + `matchesEnding` | 10/10 |
| 3 | selection, cap, gate, line assembly | 10/10 |
| 4 | **the seams** — `regionGraph` guards, `startRun`, `sceneOf` | **10/10** |
| 5 | remaining `summarizeRun` fields | 2/8 |

**All eight survivors were test gaps; none was a code defect.** They were `baseLost` without its
`claimed &&` conjunct (which would have fired `requiresBaseLost` on every drifter), the
`nodesSeen`/`nodesCleaned` separation, the `>= 100` search boundary, `won` dropping `held`, the project
stage prefix and its flag value, `companions` counting non-companion actors, and `rooms` read off the
player's location rather than the base. Six new tests, then 48/48.

**The distribution is the interesting part, and it inverts T87's.** That task found all four of its
round-one survivors in the *wiring* and none in the module. Here **every seam mutant died on first
exposure** — because the audit had just forced seam tests — and **every survivor was in the module's
own field-by-field reads.** Ninth consecutive task for the T75/T77 family lesson, from the other side:
the lesson is not "test the wiring", it is *test whichever half you did not just think hardest about.*

---

## 7. Byte-identity

`--identity`, six bot runs of up to 400 actions each with **no ending pool registered**, digesting every
scene narration, every choice-id list and every save blob:

```
PRE-T61  (pristine baseline)   lines: 236  chars: 418705  digest: 0f3948b1480ff763
POST-T61 (this tree, no pool)  lines: 236  chars: 418705  digest: 0f3948b1480ff763
```

Identical. All 1506 pre-existing tests also pass unedited. The gate is `endingsActive(graph)` — the
T81/T83/T84/T85/T86/T87 idiom, with the pool attached to the graph **only when non-empty**, so the "is
this system registered" read every other pool uses cannot answer yes to an empty array.

---

## 8. Declared limits — do NOT re-claim these

- **PL-M5-69 — the `sacrifice` shape is UNREACHABLE in this build, and the cause is not the predicate.**
  Measured over 120 finished runs across three policies (`--sacrifice`): a survivor stands inside a base
  they still hold for **6.2 turns a run, in 75.8% of runs — and is in combat there on 0.00 of them.** A
  Last Stand is `combat.grabbed && woundBurden >= LAST_STAND_AT`, so with no fight possible at your own
  address there is no Last Stand possible there either. **T76** made the claimed shelter a hard sanctuary
  (`overrunsPlayer` excludes it) and **T83** resolves the night as a siege event rather than as a fight.
  **T62 is the task that turns the Last Stand from an ending into a stand (PL-M5-44), and this shape is
  the ending it lands in** — authored ahead of it deliberately, and recorded here rather than papered
  over by widening "sacrifice" until it means "died somewhere".
- **PL-M5-70 — humanity's authored extremes are unreachable.** `humanityBand`'s `≥85`, `≤28` and `≤12`
  bands are hit **0 times in 200 measured runs** (range 31–73), so T61's humanity clauses are keyed on
  the *shift* rather than the band. The band prose has been unreachable since T47 and stays that way.
- **PL-M5-71 — 21 of 52 authored clauses never fire in a 241-run sweep**, and the two reasons are
  different: four are gated on a companion (measured 0 in 320 runs — T86's PL-M5-63), ten belong to the
  unreachable `sacrifice` shape (PL-M5-69), and the remaining seven are simply outcompeted, which is the
  cap doing its job. Only the first two groups are debts.
- **`escape` is 5.0% and `entrenchment` 68–82%** of finished runs. The shape axis has a real spread but
  it is not an even one, and the cause is upstream: **the run is still short** (PL-M5-65, unchanged).
- **Epilogues (FR-STY-08, Should) and the GDD's "final broadcast" are NOT built.** 0 survivors are ever
  met and no radio beat appears in any measured run's history, so both would ship dead. The clause menu
  can hold either the day they are reachable.
- **Hidden endings** (GDD XIII) need the truth layer and are not attempted.
- **Not balanced against difficulty modes**: no T61 constant runs through `sim/difficulty.ts`, exactly
  as for every T83–T87 constant (PL-M5-45).

---

## 9. Files

**New** — `prototype/engine/src/sim/ending.ts`, `prototype/engine/test/ending.test.ts`,
`prototype/engine/test/endingAudit.test.ts`, `prototype/harness/test/endingContent.test.ts`,
`prototype/harness/measure/t61.ts`, `content/schemas/ending.schema.json`,
`content/endings/ending.{escape,entrenchment,sacrifice,fade}.json`

**Changed** — `engine/src/map/{types,regionGraph,seedWorld}.ts`, `engine/src/actions/coreActions.ts`,
`engine/src/index.ts`, `harness/src/playCli.ts`, `harness/web/{ui.js,build-html.mjs}`,
`testlab/src/{boot,loadContent}.ts`, `testlab/web/build.mjs`, `docs/status.json`, `CHANGELOG.md`
