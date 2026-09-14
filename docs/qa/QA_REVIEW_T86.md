# QA Review — T86 · Faction reputation becomes consequential

**Milestone** M5 (seq 109) · **Status** DONE 2026-09-14 · design review step 12c · FR-NPC-10
**Closes** PL-M4-43 · **half-closes** PL-M4-34 (the reputation half; trading is still not built)
**Full CI** engine **1105** · harness 287 · content-loader 23 · testlab 22 · schema **180** · a11y OK
(engine was 1049 at T85; **all 1049 pre-existing tests passed unedited**)
**Runner** `prototype/harness/measure/t86.ts` — every figure below is re-derivable on demand.

---

## 1. What the brief said, and what the measurement said back

The brief was **right about the disease and wrong about the cure**. Its diagnosis held up line for line:

| Brief's claim | Measured |
|---|---|
| `player.reputation` / `groups[].hostility` / `groups[].strength` are WRITE-ONLY | **TRUE.** One writer (`seedFactions`), **zero readers** in `engine/src`. |
| No verb changes reputation | **TRUE.** Reputation moved in **0 of 160 runs**. |
| `factionArchetype()` is called by nothing | **TRUE — and worse:** *all six* faction readers (`factionPool`, `factionOf`, `factionIdOfNpc`, `areRivals`, `bondSeed`, `factionArchetype`) were imported by NOTHING outside `social.ts` and the barrel. |
| 4 of 6 `TrustEventKind` are dead | **TRUE** — `help`, `trade`, `rob`, `abandon`. |
| `SOCIAL_DELTAS` `stood-by-me` / `robbed-me` / `abandoned` / `saw-cruelty` unreachable | **TRUE** — `remember()` was only ever called with `kindness`, `menaced-me`, `confided`. |

Its **three prescribed cash-outs all landed on machinery the player never reaches**:

1. *"reputation below a threshold forces disposition `hostile` (which `canRecruitEligible` already refuses)"* — **the recruit gate fires zero times.** Faction members recruited across **320 measured runs (160 of them immortal): zero.** A *maximum-favourable immortal suitor* that walks straight to each of the ten faction survivors and then does nothing but talk/feed/water/recruit **arrives at 8 of 10, meets 3 of 10, and recruits 0 of 10** — `met` requires `talk:`, `talk:` is offered only while unmet, and `RECRUIT_MIN` (70) sits two `share` steps above every disposition but `friendly`.
2. *"a faction `homeNode` at high reputation offers trade"* — **nobody stands on a homeNode**, and **there is no trade verb.** The marina is reached in **10%** of ordinary runs, the Quad and the Foundry in **0%**. The engine dispatches **37 action types and none of them trades**; PL-M4-34 says as much and is still open.
3. *"at low reputation seeds an ambush"* — the same node, the same 0–10%.

**The cause of (2) is mortality, not topology**, which is the finding worth carrying: an immortal bot reaches all three home nodes, while a mortal one is ended by `lastStand` in **30–40 of 40 runs by day 1.8–3.7**. No reputation design can be "live in ordinary play" while that is true, and tuning the gates down until a day-3 death crosses them would make standing swing on a single encounter — worse, not better. It is declared (**PL-M5-62**), not papered over.

So T86 kept the brief's **mechanism** and moved its **occasions**.

---

## 2. What shipped

**A new leaf module, `sim/reputation.ts`.** `social.ts` reads `humanityOf` from `events.ts`, and `events.ts` now needs the standing axis — importing the other way would have closed a cycle. The faction-graph readers and the T53 attitude axes (`remember`, `respect`/`fear`/`memory`, `socialActive`) moved here and are **re-exported from `social.ts` verbatim**, so every T53-era import path and the barrel are untouched.

1. **Five channels write the axis.**
   - `adjustReputation` — the quiet write, one faction only: **`give-food` / `give-water` (+4), `recruit` (+6), `threaten` (−12)**. All three verbs already threaded `graph` and already gated on `socialActive`, so this is a five-line insertion each.
   - `adjustReputationPublic` — the loud write, which also moves the faction's rivals: the **`adjustReputation` encounter effect** and **witnessed cruelty**.
2. **Standing spills to rivals, and the rivalry is DERIVED.** The shipped content already names `npc.hector-ruiz ↔ npc.sarah` and `npc.dana ↔ npc.marcus` — both cross-faction — so the Slagworks ↔ Harbor feud is **read off the graph and never stored** (the T79 `lastVisit` / T84 `richness` / T85 `roomSlots` precedent). An optional faction-level `rivals` list covers a feud with nobody named behind it; the Quad Collective uses it. This is what finally makes the design review's sentence true: *helping one faction can now anger another.*
3. **Standing is read as TERRITORY, not one node.** A faction's people carry its standing: at or below `REPUTATION_HOSTILE_AT` every member reads and behaves `hostile` — no talk, no ask, no threaten, no recruit, and the Scene says which door closed and why. `minReputation`/`maxReputation` gate the encounter pool, because **encounters are the liveliest channel in the game** (11.8 fire per ordinary run, 66 per immortal one).
4. **`saw-cruelty` finally has its occasion.** T53 wrote the entry with the comment *"reserved; needs an events hook"*; this is that hook. Eight authored encounters carry a negative `adjustHumanity`, and everyone standing there now remembers it — at a standing cost to their faction.
5. **Content**: `rivals` on `FactionDef` + schema; standing effects authored into **4 existing encounters**; **4 new encounters** (`the-roster` ungated for the Quad, plus one reputation-gated beat per faction).

**Derived, never stored.** `NPCState.disposition` keeps its authored value — a faction won back reverts its people with no migration — and `player.reputation` was already in the save. **No save-schema rung; stays v10.**

---

## 3. The numbers

| | before | after |
|---|---|---|
| Runs where any reputation moved | **0 of 160 (0.0%)** | **121 of 160 (75.6%)** |
| Readers of `player.reputation` in `engine/src` | **0** | 6 modules |
| `SOCIAL_DELTAS` entries reachable | 3 of 7 | **4 of 7** (`saw-cruelty` wired) |
| Mean Δ Harbor Holdout / Slagworks Crew per run | 0.00 / 0.00 | **+4.44 / −4.49** |

The spill is visible in that last row: the Holdout rises and the Crew falls by almost exactly as much, off the same acts.

**The ceiling — what the CONTENT allows** (`--zealot`: an immortal bot that tours every authored standing act for one faction and takes the extreme choice each time):

| faction | best standing reached | crosses its gate |
|---|---|---|
| Harbor Holdout, toward | +58.4 mean, range [39..67] | **KIN in 90%** |
| Harbor Holdout, against | −24.6 mean, range [−49..3] | **HATED in 50%** |
| Quad Collective, toward | +40.8 mean, range [24..48] | **KIN in 70%** |
| Slagworks Crew, against | −45.4 mean, range [−59..−29] | **HATED in 60%** |
| Slagworks Crew, toward | −24.2, range [−25..−21] | **never** (declared) |
| Quad Collective, against | +3.2, range [−8..20] | **never** (declared) |

### The dials were set by measurement, twice
A first cut put the gates at **±50** and **nothing crossed them**: `--standing` reached HATED in **0%** and KIN in **0%** across three temperaments, and the reputation-gated encounters fired in **none** of 40 runs. That is the T85 cistern defect exactly — *a threshold nothing reaches has re-created the problem it was built to fix* — so the band was re-derived from what the content actually allows and set to **±40**.

Then the same instrument caught a second one: the **Quad Collective moved ±4 across every ceiling run and crossed neither gate**, because it had **no authored standing act of its own** — only the spill from the Slagworks. *A faction with standing and no occasion is the very defect T86 exists to fix*, so `encounter.hillcrest.the-roster` was written for it, and the Quad's own gated beat, first written on the low side, was **re-pointed at a standing it can actually reach** once the ceiling probe measured its floor at −8.

---

## 4. Defects THIS TASK introduced — all six caught by its own instruments

An adversarial audit of the diff returned six findings. Five were real.

1. **A CRUEL ACT COULD RAISE THE FACTION THAT HATED YOU MOST.** `witnessCruelty` charged standing **once per witness**, and each charge spilled to every rival — while a rival's own single charge did not scale. Measured on shipped content with the people-sim's own co-location census (three Quad members on the quad): emptying the Quad's ration crate, the cruellest single choice in the game, took the **Slagworks Crew from −25 to +2**, a +27 swing — larger than every positive act the Crew authors put together. *Fixed:* one charge per distinct **faction**, not per head.
2. **STANDING WAS FARMABLE BY OSCILLATION — and the test's own title claimed it wasn't.** The spill rode every write at 50%, so alternating a `give-food` between two feuding factions netted each of them `delta × (1 − pct/100)` per cycle, unbounded to the clamp: **+2 to BOTH the Harbor Holdout and the Slagworks Crew per pair of shared meals**, through the real `availableActions` → `applyAction` pipeline. No spill percentage fixes this (100% conserves for a feuding *pair* but leaks the moment one faction has two rivals and the other has one), so **the cure was the channel, not the number**: a shared meal is private; what you did at the overpass is public. The test titled *"…so a feud cannot be farmed by oscillating"* asserted `spilled < moved`, which was the **cause** of the exploit rather than a check against it.
3. **A COMPANION A REGION AWAY SAW IT.** `witnessCruelty` remembered onto every entry in `actors` with no location check, and `social.ts` reads exactly those fields for desertion and betrayal — **three remote cruel acts put a companion guarding the base into betrayal range**, ten into desertion range. *Fixed:* filtered to companions standing at the node, like the survivor half three lines below always was.
4. **THE HOSTILE DOOR WAS HALF SHUT, AND THE SCENE CONTRADICTED ITSELF INSIDE ONE PARAGRAPH.** `ask` — the one people-verb the first cut missed — kept handing a hated faction's map intel over, printing *"They lower their voice: 'a cache out at Far'"* and *"Rex has heard what Kin say about you — there is nothing to talk about"* in the **same narration**. The audit also proved the door had **no way back**: at the floor, not one offered choice could raise the faction again. *Fixed twice over:* `ask` is gated, and **`give-food`/`give-water` deliberately survive the closed door** — they will not speak to you, they will still take a meal — so a hated faction is a decision, not a trap.
5. **THE QUAD'S ONE OCCASION WAS SITED ON A NODE NOBODY REACHES** — `the-roster` was gated on the Quad's `homeNode` (5% of runs *even for a bot walking straight at it*) while its own sibling `the-reckoning` carries a note explaining why that is wrong. *Fixed:* region-gated, like its siblings.
6. **A TURN-ZERO RUN ASSERTED A DEBT NOBODY HAD INCURRED.** `standingBand`'s `welcome` floor sat at exactly 20 — the Quad Collective's authored baseline — so the Scene said *"The Quad Collective owe you something"* before the player had taken a single action. *Fixed:* the floor sits above the highest baseline any content can author.

The audit also independently re-verified byte-identity (8 seeds × 400 actions, full `saveGame` JSON: identical), the no-soft-lock invariant, determinism on replay, no save rung, and fail-closed requirement evaluation.

**One further defect the audit's own test attempt exposed:** `recruit()` refused a hostile *disposition* at the resolve layer but not a hostile *standing*, so a client dispatching the action directly could shanghai a member of a faction that had turned on the player — while the module's own doc promised *"a caller that skips the offer gate still can't … shanghai a hostile"*. `graph` is now threaded through.

---

## 5. Mutation testing — 52 mutants, 42/52 on round one

**Three mutants were retired by DELETING the code they exposed**, which is the good outcome:
- a `fa === fb` guard in `factionRivalsOf` that was **exactly redundant** with the `out.delete(id)` below it;
- an `alive !== false` check on a companion — `Survivor` **has no `alive` field** (`killCompanion` deletes the entry), so the check was dead code dressed up as a guarantee;
- an `effectiveDisposition` call in the Scene's unmet-survivor branch, which the hostile `continue` a few lines above makes **unreachable**.

Of the remaining 49: **47 killed, 2 proven equivalent** with the proof written into the comment (a zero-spill allocation fast path, and a sort over a list whose elements do not interact).

**Six of the ten round-one survivors were test gaps — and three of those six were tests written for THIS TASK'S OWN AUDIT FIXES.** The `ask` gate test called `socialChoices` on a fixture whose survivors had no `knowledge`, so it asserted against an empty list; the band test used fixture factions none of which carried the baseline that caused the bug. **Both passed against the unfixed code.** That is the T75 lesson (*"write the test that fails against the UNFIXED code"*) and the T77→T85 lesson (*"an audit fix still needs its own test"*) arriving together, for the **sixth consecutive task** — this time not as a missing test but as a *vacuous* one, which is harder to see and no better.

Method per the T85 note: a **scoped suite** (11 files, 189 tests, 6.0 s) rather than the full 1105, **chunks of ≤10**, and a **pre-flight residue check** that aborts if any mutant's original text is not present exactly once. No sweep was killed and no mutant was left applied.

---

## 6. Declared limits — do NOT re-claim these

- **PL-M5-62 — THE GATES DO NOT BITE IN ORDINARY PLAY.** Standing *moves* in 75.6% of runs, but no mortal bot policy crosses HATED or KIN in 40 runs, and the three reputation-gated beats fire in **0 of 320 ordinary runs**. The cause is measured and is not this task's: `lastStand` ends 30–40 of 40 runs by day 1.8–3.7, and region.hillcrest is entered in **0%** of ordinary runs against **87.5%** of immortal goal-directed ones. An immortal kind bot does reach HATED in 7.5% and KIN in 5%, and fires `the-vote`. This is T59/T60 balance and the T82 mortality curve, not a reputation dial.
- **PL-M5-63 — THE SLAGWORKS CREW CANNOT BE WON ROUND, and the Quad Collective cannot be made to hate you.** Every positive act the Crew authors totals +14 from a −25 baseline; the Quad's floor measures at −8. Both are half-dead axes, honestly bounded by content rather than by the model, and both want an authored act rather than a dial.
- **PL-M5-64 — A COMPANION ALREADY RECRUITED FROM A NOW-HATED FACTION DOES NOT LEAVE.** The standing override is read by `canParley`-adjacent gating and `canRecruitEligible`; a companion who already joined is never re-checked. Their faction turning on the player ought to move them, and does not.
- **`bondSeed`, `areRivals` and `factionArchetype` are STILL not read outside `social.ts`** — T86 gave the faction pool five new readers, but PL-M5-06's dead-export list is only partly shorter.
- **INERT IN THE TESTLAB SOAK — byte-identical to T85's** (`{lastStand 10, infection 6, dehydrated 8}` / 985 actions / day 3.8), for the same reason T83 and T85 were: the four policies never engage the faction layer (PL-M5-50, now re-confirmed a third time).
- **Trading is not built** (PL-M4-34). `the-berth` pays in what the game can actually hand over.

---

## 7. Verification

- Full CI green: **engine 1105 / harness 287 / content-loader 23 / testlab 22 / schema 180 / a11y OK**, plus `tsc --noEmit` in all four packages, the harness end-to-end turn, the negative schema and a11y gates, the testlab soak, and the single-file page build.
- **All 1049 pre-existing engine tests passed unedited** — every new path is behind the T53 `socialActive` pool gate or an optional `graph` parameter whose absence is the exact prior behaviour.
- **56 new tests** in `test/reputation.test.ts`, one per audit finding and one per mutant class.
- Format-patch built on T85, verified by `git am` onto a fresh baseline with an empty `diff -r`.
