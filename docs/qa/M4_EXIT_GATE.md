# M4 Exit Gate — content-complete city & public-beta hardening (T57)

The **M4 Definition of Done** (PRODUCTION §M4), and the milestone's decisive gate — the content-complete
analogue of the M3 **Slice Fun Gate** ([`FUN_GATE_LOG.md`](FUN_GATE_LOG.md)). Like that gate, the verdict on
its human criteria is the **owner's call and cannot be auto-passed**: this packet prepares and proves
everything buildable, then hands the owner a scripted playtest for the parts only a player can judge.

> **Authority.** A pass closes M4 (MVP / public beta) and opens **M5** (release candidate). A fail does not
> "add more content" — per PRODUCTION §4 it re-invests in whatever the playtest shows is missing, content
> frozen until it passes.

## The bar (PRODUCTION §M4 · PRD §4/§7)

1. **Content-complete & schema-valid** — the first city is content-complete and validates in CI (FR-CNT-02).
2. **Repetition under target** — verbatim encounter repetition sits **under the PRD §4 target (< 5%)** across
   a full run.
3. **Infection is identity** — infection-as-identity plays as *a harder way to keep going* (FR-INJ-08),
   **comprehension-tested with players**.
4. **Handable beta** — the beta is **stable enough to hand out**.

## How the gate splits: proven vs owner-pending

Two of the four criteria are fully machine-provable and are **proven now**; the other two have a human half
that — exactly as the M3 gate was rendered by an owner playtest — is **deferred to the owner** (§ *Owner
playtest*). Nothing in this packet claims the human half.

| # | Criterion | Machine-provable half | Human half (owner) |
|---|-----------|-----------------------|--------------------|
| 1 | Content-complete & schema-valid | ✅ **PROVEN** | — |
| 2 | Verbatim repeats < §4 target | ✅ **PROVEN** | — |
| 3 | Infection is a harder way to keep going | ✅ **PROVEN** (FR-INJ-08 survivable; legible without the number) | ✅ **RENDERED** 2026-09-12 — *reads as identity* |
| 4 | Beta stable enough to hand out | ✅ **PROVEN** (repro-from-seed, lossless save/resume, no soft-lock, boots + plays) | ⚠️ **RENDERED, SPLIT** 2026-09-12 — *handable* ✅ · *"one more day"* ❌ → carried to M5 |

> **Rendered 2026-09-12** on the T77 build, against the [80-run testlab sweep](#5--the-80-run-testlab-sweep-2026-09-12--the-t77-build)
> plus the owner's own play. The verdict is a **qualified PASS** with a named re-invest list carried into M5 —
> see [§ Verdict](#verdict--rendered-by-the-owner-2026-09-12). The CI block below is the **T57-tier** run
> (engine 580 / harness 255); the current build is engine **759** / harness **264** (`QA_REVIEW_T77.md`).

## Evidence — the machine-provable half

All of it is consolidated in one gate suite, `prototype/harness/test/exitGate.test.ts` (20 assertions), so the
exit criteria can't silently rot. It is **harness-only** — it reads shipped content + the engine's public API
and adds no engine/content, so **byte-identity holds by construction** (`diff -r prototype/engine/src` and
`diff -r content` vs the pre-part baseline are both empty; the T54/T55/T56 shape).

### 1 · Content-complete & schema-valid (FR-CNT-02)

A machine-checked **manifest** enumerates every M4 in-scope Content-Bible **pool** — and checks the
client-side systems (depth screens, the audio→text cue matrix) are present — cross-checking that references resolve:

| System | Shipped | Bar | Note |
|--------|--------:|-----|------|
| Regions | 6 | =6 | one connected, symmetric graph, single known start (`buildRegionGraph` with **every** pool) |
| Nodes | 60 | 40–65 | PRODUCTION §6.4 city budget; 14 claimable safehouses |
| Survivors | 18 | ≥15 | the **defined beta subset** (PRODUCTION §7 permits it over the 100-cap); party cap 3 |
| Encounters | 26 | ≥20 | count asserted; all **7** categories (FR-ENC-05, Must) |
| — multi-stage (04) | ✓ | ≥1 | `overpass-toll` (talk → fight → chase) |
| — evolution (08) | ✓ | before/during/after | `garden-center-{before,during,after}` |
| — chains (03) | ✓ | sets + gates flags | flag-set beats + flag-gated payoffs |
| — moral/Humanity (06) | 10 | ≥3 | choices that move Humanity |
| Infection | 4 stages | =4 | incubating→symptomatic→advanced→terminal, no bar |
| Radio | 7 | ≥5 | all 5 families: emergency/military/civilian/ham/unknown |
| Recipes | 16 | all 6 families | medical/weapon/shelter/survival/repair/purify |
| Jobs | 6 | ≥5 rooms | garden/kitchen/salvage/infirmary/generator/watch |
| Factions | 3 | ≥2 | membership integrity (every member is a shipped survivor); relationship substance FR-NPC-02/05/06/07 → `social.test.ts` |
| Arc | 1 | ≥1 | subject resolves; the full-city beta boot now **registers + can fire** it (was slice-only) |
| Difficulty | 4 + Ironman | all reachable | story/survivor/hardcore/nightmare |
| Zombie roster | 7 (+5 enemies) | ≥7 / ≥4 | 7 distinct behaviours (T46 · FR-CBT-06/07); each combat-distinct type maps to a real enemy |
| Named wounds | 4 | ≥4 | bite/fracture/laceration/sprain (T16) |
| Depth screens | 5 | ≥5 | inventory/companions/shelter/map/codex (FR-UI-04, client — `screens.test.ts`) |
| Audio→text cues | 48 | ≥20 | every meaningful sound cue has a text equivalent (FR-AUD-06, client — `cueMatrix.test.ts`) |
| Accessibility | gated | — | palette contrast + colour-blind CI gate (NFR-ACC-01/03, `validate:a11y`) |

Cross-ref integrity (the manifest's teeth): every faction member, arc subject, npc home-node, and encounter
node-anchor resolves to a real shipped id — **no dangling references**. The **schema gate** (CI
`validate`) independently validates all **160 content entries across 13 types** and rejects malformed content.

> **Honest scope.** "Content-complete" = every M4 system present and schema-valid across the whole city at the
> **defined beta-subset volume PRODUCTION §7 permits**, not every pool at its theoretical maximum. The deep
> launch survivor/encounter pours (toward the ~60–100 survivor cap, the wider encounter set) are the tracked
> M5+ deferrals PL-M4-16/PL-M4-63; the *systems and the city* are complete, the *volume* is the beta subset.

### 2 · Verbatim repeats under the §4 target

Re-confirmed over the **content-complete, all-pools** boot (T48 gates it over the encounter pool alone). Encounter
selection rides its own RNG stream, independent of the radio/economy/jobs/factions pools — so registering the whole
world does **not** perturb selection, which is itself the assurance the exit boot re-checks. Deterministic full-city sweep, ~54 days:

```
136 encounter fires · verbatim-repeat 0.00% (target < 5%) · 0 immediate repeats
20 distinct encounters · max single share 12.5% · 5 ambient categories fired
```

The sweep is an ambient-selection probe (it keeps nodes uncontested and claims no safehouse), so the
**combat** and **shelter** categories are out of *its* scope by construction — both are nonetheless **authored
and shipped** (proven by the manifest), so all 7 categories exist; 5 fire in the ambient sweep. `T48`'s
`repetition.test.ts` remains the standing hard gate; this is the exit-tier re-proof over the full content.

### 3 · Infection is a harder way to keep going (FR-INJ-08) — machine half

- **Survivable, not a loss screen.** At `terminal` the run is **not over** (`isRunOver` false) — a cure race
  opens; the run ends by infection only if that race is neglected (the delayed succumb, proven in the engine
  `infection.test.ts`). The cure stays on the menu at the worst stage, so the fight is always actionable.
- **Legible without the number.** Each stage reads from a distinct symptom; the hidden progression number
  never appears in status, scene, or the diagnosis line. This is the standing **T49 comprehension gate**
  (`harness/test/infection.test.ts`), re-touched here at the exit tier.

> The **human half** — does infection *read* as an identity you inhabit rather than a hidden timer — is the
> owner playtest below.

### 4 · Beta stable enough to hand out — machine half

- **It boots and plays.** `npm run play` stands up the full content-complete city (every pool registered),
  renders the story-first single-decision Scene with live sound-captions and the depth-screen footer, and
  plays through the world — including the **authored arc** (`the-last-customer`), now registered in the full-city
  client, not just `play:slice`; `--difficulty` and `--ironman` are honoured at boot. (Smoke: exit 0.)
- **Repro-from-seed.** A full content-complete playthrough is **byte-identical** from the same seed (final
  state + transcript) — the property every beta bug report leans on (report the seed, reproduce the run).
- **Lossless persistence.** The shipped save **format** round-trips deep-equal at a rich content-complete
  state; quit/resume is byte-identical at **every** boundary of a content-complete run (T21 held at the exit
  tier, from the save string alone).
- **No soft-lock.** Across sampled long runs (multiple seeds) the engine always offers a legal action until the
  run **cleanly** ends — never a dead end. (Long-run soak proper is M5/T66.)

> Reliability/perf **hardening** proper — crash-free ≥ 99.5%, the turn-budget/perf numbers, long-run soak,
> bounded history growth — is **M5/T66** by PRODUCTION's own scoping; the M4 bar is "handable", proven above.

### 5 · The 80-run testlab sweep (2026-09-12 · the T77 build)

The evidence above was proven at the **T57 build (engine 580)**. T74–T77 then reshaped the engine underneath
it — hour accumulators, zombie repopulation, horde collision, the noise→arousal→detection chain — so a sweep
was run before the verdict, at a scale the gate suite does not reach. **The gate suite itself was not re-run
as part of this sweep**; it is green on the current build (harness 264, `QA_REVIEW_T77.md`).

**Report:** `zurvival-testlab-report.json`, generated `2026-09-12T23:18:44Z` against a build stamped
`2026-09-12T23:17:12Z`. **10 seeds × 4 policies (`random`/`careful`/`greedy`/`fighter`) × stocked and unstocked
starts = 80 runs**, 400-turn cap, 100 ms turn budget.

```
80 runs · 80 passed · 0 failed · 0 crashed · 0 recorded failures · 3,829 actions · 896 encounter fires
```

> **What the report records vs. what it verifies — read this before the table.** `replay: true`,
> `saveSample: 10` and `detSample: 1` are **inputs**: they say determinism-replay and a 10-step save
> round-trip were switched **on** for all 80 runs. The report then records **zero failures** — but its
> `byCheck` map is `{}` and no run's `failuresByCheck` names a check, so the report **never enumerates the
> checks that ran**. A zero with no denominator is consistent with "everything passed" *and* with "nothing
> ran". Nothing below is stated as *verified* on that basis, and fixing it is the first M5 chore
> (**PL-M5-28**). Separately, `resumed` is **false in all 80 runs** and `fromSave` is `null`: saves were
> **serialised** in every run (47,988–75,217 bytes), and **no run in this report resumed from one**.

| Criterion | Gate-tier evidence (T57, engine 580) | What the sweep adds |
|---|---|---|
| 1 · content-complete | manifest: every in-scope pool, counts vs floors, no dangling refs | **Nothing — not re-proven.** The manifest remains the sole proof, and it ran at engine 580. The sweep touched 18 of 26 encounters, 6.8 nodes of 60 and 1.5 regions of 6; it cannot speak to completeness |
| 2 · verbatim repeats < 5% | one 54-day sweep · 136 fires · 0.00% · **20 distinct** · 5 ambient categories | **The rate holds at 6.6× the fire count: 896 fires, verbatim-repeat 0.00% in every run, 0 immediate and 0 windowed repeats.** But over a **narrower** slice: only **18 distinct encounters of the 26 shipped**, drawn from just two namespaces (`common` ×15, `rivermouth` ×3) — *no other region's encounter pool was ever reached*, because runs die in region 1. `overpass-toll` alone is 12.3% of event steps, in 65 of 80 runs |
| 3 · infection survivable | `isRunOver` false at `terminal`; the cure stays on the menu | **42 of 80 runs reached `terminal`; 14 of those outlived it** (13 dehydrated, 1 starved) — by bots that ran the cure race **7 times in 3,829 actions** (5 `treat-infection`, 1 `diagnose`, 1 `quarantine`). Terminal is not a loss screen even when nobody fights it. The strongest evidence this criterion has |
| 4 · handable | repro-from-seed, save round-trip, resume-at-boundary, multi-seed no-soft-lock, smoke exit 0 | **80/80 runs came back clean**: zero crashes, zero recorded failures, and **every run ended on a legitimate reason with none reaching the 400-turn cap** (longest run 81 turns) — the strongest available evidence that nothing stalls, across 3,829 actions. Turn budget: **0 of 3,829 steps exceeded 100 ms** (mean 0.23 ms, p95 0.30, max 0.90) |

**Banked for M5/T66** (recorded, not claimed — 80 short runs are a sweep, not a soak):

```
turn budget  0 of 3,829 steps over budget · mean 0.23 ms · p95 0.30 ms · max 0.90 ms   (NFR-PERF-01: 100 ms)
crash-free   80 / 80 in this sweep                      (NFR-REL-01 bar: ≥ 99.5% — needs a soak, T66)
history      3.46 entries/turn max · 212 entries max    (PL-M2-06)
save size    47,988 – 75,217 bytes
```

#### What this sweep does *not* establish

Held to the same discipline as `measure/t77.ts`: **the policies are deliberately crude and bad at the game.**
The 24 action prefixes they ever issue are `event`, `move`, `rest`, `slip`, `search`, `fight`, `flee`,
`strike`, `drink`, `treat`, `eat`, `retreat`, `drop`, `hold`, `give-food`, `threaten`, `treat-infection`,
`talk`, `stash-deposit`, `diagnose`, `give-water`, `claim-shelter`, `stash-withdraw`, `quarantine`. `fortify`,
a room build, a job, a craft, a recruit, `ask` and a radio tune are issued **zero times by any policy**.

So the following are **coverage gaps in the testlab, not findings about the game** — nothing here is evidence
about those systems in either direction:

- The **entire shelter story is one run**. `claim-shelter` fired **once** in 3,829 actions, `stash-deposit`
  twice, `stash-withdraw` once, `quarantine` once — and all three shelter-category encounter fires — all
  inside the single run `tl-8 / random / unstocked`. The shelter, rooms, jobs and crafting layers (T51/T52)
  are **unexercised**.
- `companionsMax` is **0 in all 80 runs**; `talk` fired 3 times. The companion, faction and relationship
  layers (T45/T53) are **unexercised**.
- `arcsTouched` is 1 in every run *including a 21-turn, 2-encounter run*, and no arc-namespaced id appears in
  any run's choices. It is a registration count, not a play signal, and **evidences nothing** about the arc.
- `greedy` never issues `drink`, `eat`, `rest` or `treat` — **0 of its 598 actions** — and enters 0 combats.
  All 20 of its runs die dehydrated on day 3 exactly. Any reading that averages `greedy` in is measuring a
  policy that does not play the game.
- `verbatimRepeatRate` is 0.00% while 36 same-encounter re-fires occur across 18 runs, so the metric counts
  something narrower than "this encounter came up again". The 0.00% should not be read as "no repetition".

**The testlab is not in the repository.** Its source and runner exist only on the owner's machine, so — unlike
`measure/t77.ts` — none of the numbers above can be re-derived from a fresh clone. Landing it under
`prototype/harness/measure/` with the report's spec as a script is **PL-M5-28**, along with the three fixes
this reading wants: a **builder/negotiator policy**, a **policy that maintains its needs** (so a stocked start
means something), and a `byCheck` map that **enumerates the checks that ran**.

#### What it does establish that the gate did not ask for

The sweep measures the loop's **shape**, and the shape is the M5 brief, now confirmed in live play rather than
simulation:

| Reading | Measured (80 runs) |
|---|---|
| The run is short | mean end day **4.53** (range 3–8). Every end is the survival clock: **dehydrated 50 · infection 28 · starved 2** — no run in 80 ended by violence |
| The city is not seen | **6.8 nodes of 60** visited per run (max 16); **1.5 regions of 6** (max 4; 45 of 80 runs never left their first). Only two encounter namespaces were ever reached |
| Pressure never peaks | `highPressureTurns` **0 in all 80 runs**; `oscillations` **0 in all 80**; mean pressure 22.8, mean per-run peak 29.3 (highest peak observed 41); longest calm streak mean 24.7 turns, max 68 |
| Violence has no terminal stake | 215 combats, 2.7 overruns and 7.0 wounds per run — and **not one of the 80 runs ended by violence** |
| The combat category never fires | 215 combats entered, 416 fights taken, 563 wounds — and **zero combat-category encounter fires** in 80 runs. §2 assumed combat was out of the *ambient probe's* scope by construction; in live play it does not fire either |
| Encounter reach is thin | **18 distinct of 26 shipped**, 14 of them carrying 98% of fires; three fired once or twice, all in the same single run |

The pacing row is the third independent sighting of the same thing: the **2026-07-05 Loop-Feel Check** logged
"opening ~day still too calm — pressure should land by ~turn 3"; **T60's brief** recorded `highPressureTurns 0`
and `oscillations 0` over a 400-turn *simulation*; this sweep reproduces both across 80 *played* runs.


## CI (clean cloud sandbox) — all green

```
engine        580 (+0, untouched)      content-loader  23     harness  255 (+23 exitGate.test.ts)
schema gate   160 entries / 13 types   malformed rejected     a11y gate OK · malformed rejected · smoke exit 0
```

---

## Owner playtest — the human verdict (to be rendered by Jharek)

The two human halves. Play the beta and answer the two questions below; record the verdict in the table that
follows (mirroring the FUN_GATE_LOG format). If a question fails, note what to re-invest in — not "more
content".

**How to play.** From a fresh clone: `cd prototype/harness && npm install`, then:

- `npm run play` — a new run of the full city (fixed demo seed).
- `npm run play -- <seed>` — a chosen seed. `-- --difficulty <story|survivor|hardcore|nightmare>` and
  `--ironman` set the floor. `-- --resume <file>` resumes a save (press **S** in-run to save & quit).
- Keys in-run: a **number** to choose; **I/C/B/M/L** open inventory/companions/shelter/map/codex (free, no
  turn spent); **S** save & quit; **Q** quit. Full handout: [`../BETA.md`](../BETA.md).

### Q1 — Does infection read as *a harder way to keep going* (criterion 3)?

Play until you take a bite and let the infection climb (or start a seed that bites early). Watch the symptom
prose escalate — fever → senses you can't trust → burning up but still moving — **without ever seeing a
number**. Look for the moment it stops being "a health bar going down" and becomes "who I am now, and I'm
still going." Then decide:

- Could you **read your stage from symptoms alone** and act (diagnose / cure race / quarantine) without
  wanting a number?
- At `terminal`, did it feel like **a harder way to keep playing** (a race you're still in) rather than a
  death sentence?

### Q2 — Is the beta handable, and does it pull "one more day" (criterion 4)?

Play a real session or two (try a different difficulty). Watch for anything that breaks the hand-out bar — a
crash, a confusing dead end, an unreadable scene, a save that won't resume. Then the durability question the
milestone is really about (GDD XVI): **at session's end, did you want to start the next day?**

- Would you be comfortable **handing this build to a friend** to play unattended?
- Did a run produce a **retellable moment**, and did the loop pull you back for **one more day**?

### Verdict — rendered by the owner, 2026-09-12

| Field | Entry |
|-------|-------|
| Build | T77 — engine **759** · content-loader 23 · harness **264** · schema gate 160/13 · a11y OK (`QA_REVIEW_T77.md`), i.e. the T57 gate packet plus T74–T77. The CI block in § *CI* above is the T57-tier run and is superseded by these numbers |
| Date | **2026-09-12** |
| Playtesters | Owner (Jharek). No external testers — the external "one more day" test is **T69**, the M5 exit |
| Q1 — infection reads as identity | **PASS.** The mechanical claim holds at scale: 42 of 80 runs reached `terminal` and 14 outlived it, by bots that ran the cure race 7 times in 3,829 actions — terminal is a race you are still in, not a loss screen. That the *symptom prose* reads as identity rather than a hidden timer is the owner's own reading; the sweep cannot speak to prose and does not |
| Q2 — handable / "one more day" | **SPLIT.** *Handable* — **PASS**: 80 of 80 runs came back clean, zero crashes, zero recorded failures, every run ending on a legitimate reason with none reaching the 400-turn cap, and 0 of 3,829 steps over the 100 ms budget. This build can be handed to a friend. *"One more day"* — **NOT MET**, and not claimed: the run is over on day 4.5, one region of six is seen, pressure peaks zero times in 80 runs, and not one run ends by violence |
| **Decision** | **PASS (qualified) — M4 closed, M5 opened, 2026-09-12.** M4's Definition of Done is *content-complete city* + *beta stable enough to hand out*. Content-completeness rests on the T57 manifest (the sweep does not re-prove it and does not claim to); handability is re-established on the current build. **Grip is not part of M4's bar** — it is M5's declared investment (T78–T87 reconnect, T59/T60 tune) and its formal gate is T69's external "one more day" test. The re-invest list below is therefore **carried into M5, not discharged**, and no item on it is new content |
| Notes / re-invest in | See § *Re-invest carried into M5*. Content stays frozen: every item is a reconnection or a dial on a system already shipped |

> **What this verdict deliberately does not say.** It does not say the loop grips — the sweep says the
> opposite, on the record. It does not say the shelter, jobs, crafting, companion or faction layers work in
> play: the sweep never exercised them, and the one run that touched shelter at all is a single accident of
> the `random` policy (§5). It does not say determinism-replay or the save round-trip were *verified* — the
> report records zero failures without naming the checks that ran, and no run resumed from a save. It does
> not claim NFR-REL-01 or NFR-PERF-01 are met; those need T66's soak. It does not re-prove criterion 1. A
> qualified pass that names what it is missing is the FUN_GATE_LOG shape; an unqualified one would be the
> over-claim the T57 audit caught the first time.

### Re-invest carried into M5

Every item is measured in §5, and every one already has a scheduled owner — the design review's build order.
Nothing here asks for more content.

| # | Reading (measured) | Where it is owned |
|---|---|---|
| R1 | Run ends day 4.53 (3–8); all 80 ends are the survival clock | **T59** (survivability/scarcity), **T87** (a way to win at all) |
| R2 | 6.8 nodes of 60 and 1.5 regions of 6 seen per run; only two encounter namespaces ever reached | **T84** (node identity, scout, loot-as-yield), **T78/T79** (drift stops flattening regions) |
| R3 | `highPressureTurns` 0 and `oscillations` 0 in all 80 runs; highest peak observed 41 | **T78** (a threat curve with a positive slope) → then **T60** (tune the bands once the curve can move) |
| R4 | 215 combats, 7.0 wounds/run, and not one of 80 runs ends by violence | **T80/T81/T82/T83**, and **T87** for the run's ending |
| R5 | **18 distinct encounters of 26 fired**, from two namespaces; 14 carry 98% of fires. The verbatim-repeat gate holds at 0.00% — the shortfall is *reach*, not repetition | **T59** (run length), **T84** (reach). T48's repeat gate is unaffected |
| R6 | **Zero combat-category encounter fires** in 80 runs, against 215 combats entered. §2 excused this as out of the ambient probe's scope; live play shows it does not fire either | **New** — needs a triage before T80/T82 build on it. Filed as **PL-M5-29** |
| R7 | Testlab not in the tree; no builder policy; no policy that maintains its needs; `byCheck` names no checks | **PL-M5-28**, the first M5 chore |

> **Not on this list, on purpose.** A stocked start changes `greedy` and `random` end-day by *nothing*
> (3.00 and 4.00 either way) while `careful` and `fighter` gain 1.1 days. That is **not** a scarcity finding:
> `greedy` never issues `drink`, `eat`, `rest` or `treat` in 598 actions, so a policy that never consumes
> cannot be moved by a stocked start. It is a testlab gap (PL-M5-28), and routing it to T59 would have been
> exactly the bot-artifact-as-balance-reading error §5 exists to prevent.

_T57 is `done`; M4 is `done`; M5 is active as of 2026-09-12. The next task is **T78** (seq 101)._
