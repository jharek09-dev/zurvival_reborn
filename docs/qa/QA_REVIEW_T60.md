# QA Review — T60 · Staged balance pass 2: pacing/director & difficulty modes

**Task** T60 (M5, `seq` 114) · **GDD Part IV** "The Apocalypse Director" · **GDD XVI** "Balancing method /
Design rules for balance" · **PRODUCTION §8** staged balance passes 1–2 · **FR-SIM-10** · **PRD §4**
**Date** 2026-09-15 · **Build** on T59 · **Closes** PL-M4-53 (part), PL-M4-54, PL-M4-57 (part),
PL-M5-33, PL-M5-45 (part) · **Declares** PL-M5-81..85
**CI** engine **1373** · harness **350** · content-loader 23 · testlab 22 · schema **191** across 17 types · a11y OK
**Runner** `prototype/harness/measure/t60.ts` (4 modes: `--beats`, `--onoff`, `--lean`, `--modes`, `--pacing`;
asserts nothing, CI does not run it; every lookup goes through a fallback so it runs line for line on a
pre-T60 tree too)

> **Balance pass 2, so run-level byte identity is deliberately broken again** — that is what a balance
> pass is for, and T59 set the precedent. What is pinned instead is the **change set** (§10), every
> constant in it is covered by a mutant (§9), and every existing test that moved carries its reason in
> the test file. The **content gate still holds absolutely**: a content set that authors no `tone`
> draws, hauls and logs bit-for-bit as before, proved by its own test.

---

## 1. The thesis

**The Apocalypse Director was worth 0.1 turns, and no retuning of its bands could have changed that,
because both bands were unreachable rather than mistuned.**

Measured on the pre-T59/T60 tree, 120 runs across five bot policies:

| | director ON | director OFF |
|---|---|---|
| mean run | 50.0 turns | 49.9 turns |
| day reached | 4.16 | 4.13 |
| encounters | 11.74 | 11.78 |
| combats | 3.51 | 3.39 |

`highPressureTurns` **0.0%** and `oscillations` **0.00** in every policy. Every escalate beat in a run
was a day-1 beat (72/72, 116/116, 106/106 by policy) — PL-M5-33 said so after T78 and it was still true
after T59.

The cause is arithmetic, not tuning. `pressureRead` blends the city tide with the player's region
threat; `driftRegions` holds that region dial **exactly on its authored anchor on 40% of turns and
within a point of it on 63%**, so the only term with real travel is the tide, and averaging a ~33-point
tide swing with a near-pinned dial halves it to ~16 inside a 45-point band. **A 16-point signal cannot
cross a 45-point band.** Forcing an escalate beat on every single tick moved the run 0.8 turns; a 6×
wider bias cap on top of that moved it 1.2. The controller's entire authority was ±1 a tick on two
dials of one district, against a substrate designed to pull them straight back.

GDD Part IV names five inputs — *"recent tension, time since the last real threat, resource desperation,
emotional highs and lows, and repetition"*. The engine read one and a half. `telemetry/repetition.ts`
was exported and imported by nothing.

---

## 2. Pass 3 — giving the director an input, and an output

### The input: time since the last real threat

GDD IV's own second-named input, and it works **only with an explicit beat set**. The log is mostly not
about the player: over 6,301 turns a run writes ~127 beats and **60.3 of them are `horde.move`** —
off-screen masses stepping between nodes, 47% of the whole log; `npc.died` adds 15.1 more, for survivors
the player has never met. A "did anything happen this turn" rule reads the map moving as the player
being threatened, and the streak is then 0 on 100% of turns: dead, and it looks alive.

With `DIRECTOR_THREAT_BEATS` written out, the read is **mean 4.91 turns, max 43, coasting on 45.7% of
turns** — live and oscillating.

### The correction that mattered most: the sensor and the actuator were the same wire

`encounter.begin` is both the beat that says "something happened to you" **and** the channel the escalate
beat acts through. Wired naively, the loop blinds itself the instant it acts: firing a scene resets the
coasting clock, so "coasting" can only ever mean "the encounter system is idle" — the one state in which
the encounter pool cannot be leaned. Measured on exactly that wiring, **the escalate beat reached the
weighted ambient pick 6 times in 120 runs** (0.8% of 767 picks) against 8.8% of turns spent in the beat.

The fix is not a tuning one. A scene counts as a threat only if it *was* one, which is what the new
`tone` field already says — `birdsong` is not the world coming for you. `threatening()` excuses a scene
whose logged tone is `relief` or `neutral`, written as an **explicit membership test** rather than
`tone !== "tension"`: `data` comes off a save, and under the negated form a hand-edited `tone: "x"`
reads as "not a threat" on every beat and the run escalates forever. After the correction the escalate
beat is **23.8% of turns** and reaches 330 of the ambient tables a run consults.

### The output: the beat leans the ambient encounter pool

The encounter pool fires **12.5 times a run**, it is the liveliest channel in the game (T86 said the same
when it looked for one), and what it offers is felt immediately. `DIRECTOR_TONE_LEAN` weights a
`tension` row up and a `relief` row down on an escalate beat, and the reverse on relief; `neutral` never
moves. Gated on `tonesAuthored(graph)`, so a pool that says nothing about tone gets the pre-T60
arithmetic exactly.

Measured at the point of application (`--lean` table (a), the mean share of the ambient table's weight):

| beat | share of turns | tension | relief | neutral |
|---|---|---|---|---|
| hold | 57.5% | 23.2% | 35.8% | 41.0% |
| **escalate** | 23.8% | **46.7%** | 26.4% | 26.8% |
| **relief** | 18.7% | 28.7% | **29.8%** | 41.5% |

**The escalate half lands: +23.5pp of tension over a hold turn.** The relief half does not, and §6 says
why rather than cranking the multiplier.

### Sweeps behind the constants

| rebuild sweep | conditional tension under escalate | escalate share of picks | mean run |
|---|---|---|---|
| lean 150/67 | 51.6% | 24% | 50.2 |
| **lean 200/50 (shipped)** | **58.6%** | **23%** | 50.2 |
| lean 300/33 | 69.1% | 21% | 49.9 |
| lean 400/25 | 70.9% | 21% | 49.5 |
| coasting threshold 2 | 42.9% | 50% | 52.7 |
| **coasting threshold 3 (shipped)** | **58.6%** | **23%** | 50.2 |
| coasting threshold 4 | 51.6% | 16% | 51.1 |
| coasting threshold 5 | 53.3% | 8% | 51.2 |

200 is where the lean stops paying: a 50% larger multiplier buys 10pp and the next 33% buys 2pp, while
leaving a ~41% chance of a non-tense scene so the pool never becomes deterministic. Threshold 3 is the
best combination of reach and conditional strength; 2 makes escalate the dominant beat and dilutes it.

**A finding worth stating on its own: the tone axis is not a difficulty axis.** Firing more tension
scenes does not shorten runs — at threshold 2 wounds went 9.98→10.78 and items 9.55→10.12 *together*,
and the run got longer. Tense scenes cost health and pay loot.

### The telemetry now reports the controller

`telemetry/pacing.ts` was banding on absolute `pressure`, i.e. measuring a controller that no longer
exists and never could have. Those fields are **kept** — five tasks of baselines compare against them,
and a metric that reads 0 for a known reason is worth more than one quietly deleted — with the reason
written into the module header. What replaced them is the **beat census**: `holdTurns` /
`escalateTurns` / `reliefTurns`, `beatSwitches`, `coastingTurns`, `longestQuietStreak`, and the signed
tide lean. With the director off, every turn is `hold` and `beatSwitches` is 0, **exactly and by
construction** — which is what T30's DoD sentence *"disabling the director changes pacing metrics"* was
always asking for.

---

## 3. Pass 4 — making the difficulty modes exist

### The diagnosis

Per-dial isolation, each dial alone at its Nightmare magnitude with the other four at identity, against
an identity control of 50.0 turns:

| dial | pre-T60 | Δ |
|---|---|---|
| `needDrift` 1.5 | 44.0 | **−6.0** |
| `needRelief` 0.7 | 48.4 | −1.6 |
| `lootContest` 1.8 | 49.7 | −0.3 |
| `lootYield` 0.6 | 49.9 | −0.1 |
| `directorAggression` 3 | 50.2 | **+0.2** |

**One dial of five did 78% of the work; three were indistinguishable from nothing, and the pacing dial
had the wrong sign.** Every dial was scarcity, needs or pacing — "harsher consequences" was a thing the
mode descriptions promised and no dial delivered, which is what PL-M4-57 named.

### What shipped

1. **`lootYield` re-sited (closes PL-M4-54).** T56 put it on the yield CAP, where it was only ever read
   as a boolean gate while the draw used the raw cap. A gate can only fire where `cap === 1`, and there
   `trunc(1 × 0.8)` and `trunc(1 × 0.6)` are both 0 — **the dial could not tell two modes apart anywhere
   in the game.** It now scales the district's offered POINTS before they convert to items.
2. **`infectionRisk`, new (closes part of PL-M4-57).** A multiplier on `BITE_INFECT_RATE`. Against a base
   of 2 the four modes land on the whole numbers 1/2/3/4 — one clean step each, no rounding rule to
   argue about.
3. **`woundTolerance`, new (closes the headline half of PL-M5-45).** A multiplier on `LAST_STAND_AT`,
   flat at 80 on Story and Ironman alike for four consecutive tasks. Lower is harsher, so it is the one
   dial that runs downward.
4. **`directorAggression` given a real job** — it scales the tone lean, which is its first live use:
   before T60 it scaled an escalate nudge that fired only on day one.
5. **Profiles retuned** (PL-M4-53, first-pass magnitudes).

### Why the haul dial scales points and not units

Units are a small integer whose modal value is 1, and a multiplicative dial on a small integer is a
switch, not a dial. Three variants were built and measured:

| siting | items a run at 1.0 / 0.8 / 0.6 / 0.5 | verdict |
|---|---|---|
| scale UNITS, truncate | 9.2 / 5.9 / 4.4 / 4.1 | a cliff at the top: the first 20% costs 3.3 items, the next 20% costs 1.5 |
| scale UNITS, round | 9.2 / 8.3 / 7.1 / 7.0 | a cliff at the bottom: a one-unit haul survives every multiplier down to 0.5, so 0.6 and 0.5 are the same dial |
| **scale POINTS (shipped)** | **9.5 / 7.0 / 6.0 / 5.5** | monotone across the whole range, no cliff at either end |

### Per-dial isolation, after (control 51.5 turns)

| dial | turns | Δ | what it moves |
|---|---|---|---|
| **`infectionRisk` 2** | 44.3 | **−7.2** | infection deaths 21→54 of 120 — the commonest death in the game |
| `needDrift` 1.35 | 48.5 | −3.0 | dry turns 15.6%→16.9% |
| `woundTolerance` 0.7 | 49.2 | −2.3 | Last Stand deaths 49→52 |
| `lootYield` 0.6 | 49.4 | −2.1 | items 9.5→6.0 |
| `directorAggression` 3 | 50.3 | −1.2 | (was **+0.2**) |
| `needRelief` 0.7 | 50.3 | −1.2 | dry turns 15.6%→22.6% |
| `lootContest` 1.8 | 51.1 | −0.4 | items 9.5→8.8 |
| *(`infectionRisk` 0.5)* | *54.1* | *+2.6* | *infection deaths 21→2* |

`needDrift`'s share of the total single-dial effect falls from **78% to 17%**. The two strongest dials
are now comparable and come from **different axes** — consequence and needs.

### The modes, end to end

| mode | turns | median | day | searches | items | dry% | deaths |
|---|---|---|---|---|---|---|---|
| story | 71.6 | 70 | 5.98 | 7.3 | 10.2 | 8.1% | lastStand 55 · dehydrated 49 · infection 15 · starved 1 |
| survivor | 51.5 | 56 | 4.14 | 6.2 | 9.5 | 15.6% | lastStand 49 · dehydrated 47 · infection 21 · starved 3 |
| hardcore | 43.1 | 45 | 3.56 | 5.2 | 5.9 | 16.1% | dehydrated 46 · lastStand 44 · infection 30 |
| nightmare | 39.0 | 41 | 3.18 | 5.0 | 5.3 | 23.4% | dehydrated 47 · lastStand 39 · infection 33 · starved 1 |

Per policy, so one policy's advantage cannot pass for a mode's:

| policy | story | survivor | hardcore | nightmare |
|---|---|---|---|---|
| settler | 68.9 | 52.1 | 43.0 | 36.5 |
| drifter | 72.5 | 54.0 | 47.4 | 41.3 |
| brawler | 66.2 | 43.0 | 35.7 | 35.7 |
| forager | 90.5 | 58.1 | 44.2 | 38.8 |
| medic | 60.0 | 50.3 | 45.0 | 43.0 |

**Monotone in every policy** (brawler ties at the top two). The pre-T60 complaint that Story's advantage
lived almost entirely in the `forager` policy is gone. No mode is impossible (Nightmare's median run is
41 turns over three days) or trivial (Story's is 70 over six). GDD XVI asks for death *timing and
causes* to be tuned: all four causes are represented in three of four modes, and the commonest cause
differs **by mode** — Story dies in a fight, Nightmare of thirst and fever.

**Nightmare was deliberately pulled back from harsher.** A version at `needDrift` 1.5 / `needRelief` 0.5
ran 34.8 turns with **43.1% of turns on an empty canteen** — straight back into the regime T59 existed
to end, where the water clock ends every run and the other six dials measure inert. The shipped
Nightmare is 4 turns longer and kills four ways instead of one. A mode that is harder in a way that
makes every other dial dead is not a harder mode; it is the same mode with a shorter fuse.

---

## 4. What this pass does NOT fix, stated plainly

- **The relief half of the tone lean does not land.** §6.
- **`lootContest` is structurally dead**, not under-cranked: over a 3.3× magnitude range (1.8 / 3 / 6)
  it moves the haul (8.8 / 7.9 / 6.3 items) and moves survival by nothing (51.1 / 51.1 / 50.9 against a
  51.5 control). It competes for `loot`, and after T59 a run is bounded by drinkable **water**, which it
  never touches. T60 built the obvious fix — rivals drink too, on the same banked clock — measured it at
  about half a turn, **and reverted it**: a new drain on the binding resource for a result inside the
  noise of what the dial already had. PL-M5-81.
- **`lootYield` buys items, not turns.** Survival sits at 49.4 turns at every setting below 1. The dial
  now does exactly what its name says and the run barely notices, which is a fact about the game, not
  about the dial.
- **`base%` is flat at 13–14% across all four modes.** Claiming a safehouse is difficulty-independent.
  Not touched here because the bot policies claim whenever they can, so the measurement cannot
  distinguish a dead dial from a bot artefact. PL-M5-82.
- **`woundTolerance` has coarse resolution.** The untreated-wound burden at a grab has a 32% atom at
  exactly 40 (one `wound.bite`), so the threshold moves in discrete steps of ~10 points of dial; 0.7 and
  0.55 measured bit-identical over 60 runs. And **0.5 puts the threshold ON 40**, where the test is
  `>=`, so any grab while carrying a single untreated bite becomes instantly fatal — a cliff a retune
  must know about. Declared in the dial's own doc.
- **`DIRECTOR_LEAN_HIGH` is a daylight signal.** PL-M5-84, §6.
- **PL-M5-20 (horde overrun has no difficulty dial and no pacing signal) is not closed.** The telemetry
  half is better — the beat census exists — but the overrun is still difficulty-flat. Re-declared.
- **PL-M5-11 (repopulation) and PL-M5-75 (stand constants)** are untouched and re-declared.

---

## 5. The adversarial audit — 13 real findings, every one fixed or declared

Five independent adversarial passes were run against the finished build, on a `/root/zb-unfixed`
snapshot taken before any of them was addressed. **Nine of the thirteen were in code this task wrote.**

| # | finding | severity | disposition |
|---|---|---|---|
| 1 | `tideLean` returned **NaN** for a prototype-chain `meta.phase` (`"constructor"`, `"__proto__"`, …) — a plain-object index sails past a `=== undefined` fallback. `sim/difficulty.ts` had fixed this exact bug and written the reason down; T60 reintroduced it four files away. Only `loadGame`'s phase whitelist was in the way. | REAL | fixed — `hasOwnProperty` guard + `isFinite` on the target; pinned by a test that **pollutes `Object.prototype` with a numeric key**, which is the only thing that distinguishes the two guards |
| 2 | `turnsSinceThreat`'s totality note was false: the guard was `isFinite`, and `loadGame` does not validate `meta.turn`, so a hand-edited `"turn": 1e308` is FINITE and makes every tick coasting for the rest of the run, pinning `directorBias` at its cap — the exact "escalate forever" the comment called impossible. | REAL | fixed — `Number.isSafeInteger`. A first fix also added a clamp on the result; a mutation sweep showed it could never engage (two safe integers cannot differ by more than 2^53) and it was removed rather than shipped as a guard that cannot fire |
| 3 | `ambientWeights` reported a table on turns where **no draw happened** — the single-candidate short-circuit was missing, and 20.5% of everything it reported had nothing behind it. It **halved the apparent strength of the lean** in the one measurement that exists to isolate it. | REAL | fixed — the short-circuits now mirror `chooseEncounter` exactly |
| 4 | `toneLean`'s down-lean **saturated at `aggression >= 2`**: `100 + trunc(-50 × agg)` clamps to 1 for every value from Hardcore up, so Hardcore and Nightmare were bit-identical on the suppression side (relief weight **43** in both on shipped content) while the amplification side kept growing — a 2× dial step bought a **64× odds step**, and at 212:1 the disfavoured row is not biased down, it is removed. GDD IV says *"biases (never forces)"*. | REAL | fixed — the down-lean is now the **reciprocal** of the up-lean with a floor, so the dial is a rotation of the odds and stays monotone on both sides |
| 5 | `toneLean` scaled the **relief** beat by `directorAggression`, contradicting three documented invariants at once — `difficulty.ts` ("a multiplier on the Director's *escalate* nudge"), `director.ts`'s `nudge` ("relief is deliberately unscaled … it does not yank away the comeback rope"), and `director.ts`'s "Story's director never escalates". Story's director *did* escalate, through the one channel this task calls its only real authority. | REAL | fixed — aggression applies to `escalate` only; pinned by a test asserting the relief beat's table is **identical in all four modes** |
| 6 | A missing `tone` was `neutral` to the actuator (`weightOf`) and a **threat** to the sensor (`threatening` fails closed on an absent tone). Live for the one-shot tier, which authors no tone and was 23% of every scene that fired — so T60's headline fix covered only half the channel. | REAL | fixed — the beat is stamped with the **resolved** tone (`def.tone ?? DEFAULT_TONE`), still gated on `tonesAuthored` so a tone-less pool writes the pre-T60 payload byte-for-byte |
| 7 | `lootYield` leaked into the **depletion rate, backwards**: a zero haul debited nothing, so **Nightmare drained districts 10.4% more slowly than Survivor** over identical draws, slower in all 14 (loot, searchPct) cells — and the site's own comment claimed depletion stayed owned by `lootContest` "exactly as before". | REAL | fixed — a denied haul costs the district what it offered. The rummage happened; the scaling is about what you could carry away |
| 8 | `advanceInfection`'s totality guard turned a rate in (0,1) into **perHour 0** — `rate > 0` passes 0.5 and `Math.trunc` then returns 0, so the fever stops entirely: the one outcome the guard exists to prevent. | REAL | fixed — truncate first, then test |
| 9 | The "it looks stripped" affordance was **mode-blind**: on Hardcore and Nightmare a node whose cap is 1 can never pay, and was still advertised as "Search A". T84 wrote the rule this broke ("a Scene that offers two hours and 25 noise without saying so is lying by omission") and T60 re-opened it for two of four modes. | REAL | fixed — the label reads the dial, testing the **cap** so an unlucky draw is never mislabelled |
| 10 | The escalate branch's legality clamp was **dead code** (the branch above already returns on the same condition — deleting it passed the whole suite) **and the wrong quantity**: `pressureRead` is a blend, so a district at threat 100 / density 100 under a cold tide reads 50 and was escalated ten times running. | REAL | fixed — new `crested(state)` asks the **district**, both dials, fail-closed on a district it cannot read |
| 11 | The relief **ration** and the tone lean disagreed across pipeline stages: `tickDirector` spends the ration at stage 11, the pool reads the beat at stage 13, so on the day's last rationed relief the nudge landed and the pool got the identity lean. `directorBeat` reported `hold` to the pool on **39.9% of turns**. | REAL | fixed — `directorIntent` (the want) leans the pool; `directorBeat` (the want, rationed) drives the nudge and the telemetry. The ration governs the persisted district lean, which is what T78 rationed and why |
| 12 | *"A content set cannot quietly join this list"* was false: `logHistory` appends a beat whose `type` is whatever the content says, and the schema constrains it to `minLength: 1`, so `{"kind":"logHistory","event":"combat.cleared"}` forges a threat and suppresses the escalate beat. | REAL | guarded — a harness content test asserts no authored `logHistory` event collides with `DIRECTOR_THREAT_BEATS`; the claim in the comment is corrected. (The asymmetry is at least safe: a forged `encounter.begin` carries no tone and fails closed, so content can counterfeit a threat but never a false calm) |
| 13 | `DIRECTOR_LOW_BAND`'s docstring still described the pre-T60 controller ("Pressure below this ⇒ escalate") while nothing reads it. | REAL | fixed — both bands documented as historical, with the reason |

**And the numbers.** A dedicated fact-checking pass ran every figure quoted in a T60 comment against the
harness. It found the citation `measure/t60.ts --pacing` pointing at a **flag that did not exist** (the
dispatch silently fell through to `--beats`), and **eleven quoted figures materially wrong** — the log
census, the quiet clock, the anchor share, the peak-pressure band, the `infectionRisk` headline, and
more. Most had been measured *before* `threatening()` started excusing relief and neutral scenes — in
the same task — and never re-derived after the correction landed. **This is the defect T59's audit found
eleven times, committed again.** Every figure in the code and in this document has now been re-derived
on the shipped tree; `--pacing` is a real mode; and every claim that *cannot* be re-derived (a pre-T60
reading, or a rebuild sweep) now says so in the sentence that makes it.

Three further issues the audit raised were fixed as hygiene: importing `measure/t59.ts` ran its `main`
(so every T60 invocation first executed 120 full T59 runs), `--lean`'s table (b) printed a dead `n`
column, and `turnsSinceThreat` had no doc comment of its own — the totality note had attached to
`threatening`, which is how finding 2's false invariant became invisible.

**The performance claim was also wrong.** `turnsSinceThreat`'s doc said the scan cost "the length of the
current quiet streak … not the length of the run". Measured: **mean 15.1 entries, p95 78, max 281**, and
on **8.5% of turns there is no threat beat in the log at all**, where the scan is the whole history. Not
a performance problem at shipping run lengths (tens of microseconds a turn), but the stated bound was
false one turn in twelve, and the comment now says what the instrument says.

---

## 6. The finding this pass could not fix: the lean lands, the delivery is swamped

The escalate lean is unambiguous at the point of application (+23.5pp of tension over a hold turn). The
relief lean is not — at the table it is +2.2pp at best, and at the point of *delivery* the relief beat
fires slightly **more** tension than a hold turn does.

Three confounds, measured:

1. **About half of all scenes are scripted one-shots**, picked deterministically by fit with no draw
   (T48). The lean never touches them, by design.
2. **The recency term dominates the weight.** `base × (1 + idScore + 2·tagScore)` spans two orders of
   magnitude; the lean is a factor of 2 on top.
3. **The beat correlates with which rows are eligible at all** — and this is the real one.

`--lean` table (c), mean eligible rows per table by tone:

| beat | tension | relief | neutral |
|---|---|---|---|
| hold | 0.97 | 1.11 | 1.46 |
| escalate | 1.03 | 1.35 | 1.12 |
| **relief** | **1.36** | **0.72** | 1.30 |

**When the director asks for relief, the pool has its fewest relief-toned rows eligible and its most
tension-toned ones.** The cause is in the requirements, not the arithmetic: `the-small-hours` is a
tension scene gated ON stress, so it becomes eligible exactly when the player is in trouble, while every
relief scene was gated to dawn/morning, to a shelter, or to a node kind. **A lean can only choose
between rows that are eligible, so no multiplier can fix this — only content can.**

One counterweight was authored (`encounter.common.someone-elses-light`, a relief scene for dusk and
night, un-gated on need or stress, available in every node kind) and it raised the escalate beat's
eligible relief rows to 1.35. **It did not close the gap on the relief beat**, and this document does not
claim it did. PL-M5-83 tracks the content work: relief-toned ambient content whose requirements are
satisfied under duress.

This is stated rather than buried because it is the honest shape of the result: **T60 built a controller
whose output is measurable, and measured that half of it is currently absorbed by the content it acts
on.** That is a better position than the one it started from — where the whole controller was worth 0.1
turns and nothing could tell you why — but it is not "the director works".

---

## 7. What T60 deliberately did not do

- **Retune `PHASE_THREAT_TARGET`.** `DIRECTOR_LEAN_HIGH` is reachable only in daylight: `>= 8` fires on
  30.8% of dawn turns and 13.8% of morning turns and on **zero of 1,698 turns** of late afternoon, dusk,
  night and early morning, because night's target is 55 and the tide closes a gap at 3 points an hour so
  it tops out near 49. Making the branch symmetric means retuning T28's diurnal curve, which is a bigger
  change than a pacing pass should make. PL-M5-84.
- **Add an eighth dial.** `lootContest` proves the point: a dial that is structurally dead is not fixed
  by a larger magnitude, and a knob nothing reads is a defect (T56 / T74 / PL-M5-11).
- **Touch `docs/mission-control.html` or the Cowork artifact** (owner's instruction, 2026-09-13).

---

## 8. Results

| | pre-T60 | post-T60 |
|---|---|---|
| director ON vs OFF | 50.0 / 49.9 turns | 51.5 / 51.8 turns |
| escalate beat, share of turns | day 1 only | **23.8%**, spread across days 1–8 |
| escalate beat, weighted picks reached | **6 in 120 runs** | 330 a sample |
| tension share the director asks for, escalate vs hold | — (no lean existed) | **46.7% vs 23.2%** |
| `highPressureTurns` / `oscillations` | 0.0% / 0.00 | unchanged, and now documented as dead |
| beat census in the pacing telemetry | did not exist | hold / escalate / relief, switches, coasting, quiet streak, tide lean |
| dials in the difficulty set | 5 | **7** |
| strongest dial's share of total single-dial effect | **78%** | **17%** |
| dials measuring within noise of nothing | 3 of 5 | 1 of 7 |
| Story → Nightmare span | 56.7 → 40.7 turns (1.39×) | **71.6 → 39.0 turns (1.84×)** |
| modes monotone in every bot policy | no (Story's edge was mostly `forager`) | **yes** |
| commonest death, by mode | the same in every mode | Story `lastStand`, Nightmare `dehydrated`+`infection` |

---

## 9. Tests and mutants

**New:** `prototype/engine/test/pacing60.test.ts` (28 tests), plus 4 new tests in `difficulty.test.ts`,
1 in `infection.test.ts`, 4 in `harness/test/content.test.ts`.

**Mutation sweep: 55 mutants, 51 killed** (50 by test, 1 by `tsc`), 4 declared.

The first round left **15 survivors, and 9 of them were test gaps in fixes this task had just made** —
the safe-integer clock, the prototype guard, the resolved-tone stamp, the points-vs-units siting, the
depletion debit, both consequence dials, the infection guard and the affordance label were all shipped
*without a test*, which is the same failure T59's sweep found (PL-M5-27 had no test at all). All nine
are closed. Two of the nine needed the test rewritten to go **through the engine** rather than around it:
the tone stamp was asserted on a hand-built beat, and the haul siting on the arithmetic rather than on
`resolveSearch` — in both cases the mutant walked straight past.

Four survivors are **declared, with the reason in the code**:

| mutant | why no test can kill it |
|---|---|
| `DIRECTOR_LEAN_HIGH` 8 → 9 | a pure tuning magnitude; its only justification is a measured share, and pinning 8 over 9 would pin taste (as T59 declared `LOOT_POINTS_PER_ITEM`) |
| `TONE_LEAN_FLOOR` removed | unreachable at the four shipped aggressions — Nightmare's reciprocal is *exactly* 25, the floor value. Reachable only if a retune takes aggression above 4, which PL-M4-53 anticipates |
| `Math.max(1, …)` in `lastStandAt` removed | the four profiles bottom out at 56; a bound on a future retune |
| `scaleInt`'s `mult === 1` short-circuit removed | equivalent for integer inputs; it is a byte-identity *guarantee*, not a behaviour (pre-existing, T56) |

The audit of the tests themselves found **five vacuous assertions in the first cut**, every one rewritten:

- *"biases, never forces"* passed with the lean deleted **and** with both weight floors deleted — at
  which point Nightmare's relief row carried a weight of **−2525** and was drawn 0 times in 40 seeds.
  It now builds the worst case the engine can construct (Nightmare, escalate, a `weight: 1` row whose id
  and tag both just fired) and asserts the floor **exactly**, plus the lean's strength isolated from the
  recency terms by two rows identical in everything else.
- *"the signed tide lean averages toward zero rather than flooring"* used a `[-1, +1]` fixture that sums
  to 0, where `trunc` and `floor` agree. Now `[-1, -1, +1]`, and the mirror so `ceil` is caught too.
- *"a crested district is never escalated into"* set the tide to 100 as well, so the relief branch fired
  and the clamp was never exercised. Now a **cold** tide, so the blend cannot be what refuses — which is
  what exposed finding 10.
- *"the pool has something kind to offer at night"* defaulted a missing `phases` to `["night"]`, so two
  pre-T60 phase-agnostic scenes satisfied it and the scene the test exists for could be deleted.
- Three census assertions (`coastingTurns <= samples`, `longestQuietStreak >= 0`, `beatSwitches <
  samples`) were true by construction. They now **recompute the value independently** rather than bound
  it.

---

## 10. Every constant that moved

| constant | file | before | after |
|---|---|---|---|
| `DIRECTOR_THREAT_BEATS` | `sim/director.ts` | — | new (8 beat types) |
| `DIRECTOR_COASTING_TURNS` | `sim/director.ts` | — | new, 3 |
| `DIRECTOR_LEAN_HIGH` | `sim/director.ts` | — | new, 8 |
| `DIRECTOR_TONE_LEAN` | `sim/events.ts` | — | new (escalate 200/50/100, relief 50/200/100, hold identity) |
| `TONE_LEAN_FLOOR` | `sim/events.ts` | — | new, 25 |
| `DEFAULT_TONE` | `sim/events.ts` | — | new, `neutral` |
| `lootYield` siting | `sim/loot.ts` | yield-cap gate | points→items conversion |
| `infectionRisk` | `sim/difficulty.ts` | — | new · story 0.5 · survivor 1 · hardcore 1.5 · nightmare 2 |
| `woundTolerance` | `sim/difficulty.ts` | — | new · story 1.25 · survivor 1 · hardcore 0.85 · nightmare 0.7 |
| `needRelief` (story) | `sim/difficulty.ts` | 1.3 | **1.5** |
| `needDrift` (hardcore) | `sim/difficulty.ts` | 1.25 | **1.2** |
| `needDrift` (nightmare) | `sim/difficulty.ts` | 1.5 | **1.35** |
| `needRelief` (nightmare) | `sim/difficulty.ts` | 0.7 | unchanged (0.5 measured and rejected — §3) |
| `tone` (13 ambient encounters) | `content/encounters/*.json` | — | 5 tension · 4 relief · 4 neutral |
| `encounter.common.someone-elses-light` | `content/encounters/` | — | new (relief, dusk/night) |
| `tone` property | `content/schemas/encounter.schema.json` | — | new (enum) |

Unchanged and deliberately so: `DIRECTOR_STEP`, `DIRECTOR_BIAS_MAX`, `DIRECTOR_RELIEF_PER_DAY`,
`DIRECTOR_LOW_BAND`, `DIRECTOR_HIGH_BAND` (kept as historical, documented), `BITE_INFECT_RATE`,
`LAST_STAND_AT` (now the Survivor value), `lootContest` magnitudes, every T59 constant.

---

## 11. Parking lot

**Declared:** PL-M5-81 (`lootContest` is structurally dead, and the measured reason), PL-M5-82 (`base%`
flat across modes), PL-M5-83 (relief-toned ambient content eligible under duress — the §6 finding),
PL-M5-84 (`DIRECTOR_LEAN_HIGH` is a daylight-only signal), PL-M5-85 (GDD IV's other three inputs —
resource desperation, emotional highs and lows, repetition — are still unread; `telemetry/repetition.ts`
is still imported by nothing).

**Closed:** PL-M4-54 (in full), PL-M5-33 (in full), PL-M4-53 (part — magnitudes retuned against
measurement, still first-pass), PL-M4-57 (part — one of the three named consequence dials shipped),
PL-M5-45 (part — `LAST_STAND_AT` dialled; the stand and project constants remain flat).

**Re-declared unchanged:** PL-M5-11, PL-M5-20, PL-M5-75.

---

## 12. Verdict

**Ship.** The director now reads an input GDD Part IV names, acts through a channel a player meets, and
reports what it did in metrics a test can assert — where before it was worth 0.1 turns and nothing could
tell you why. The difficulty set went from five dials with one doing 78% of the work to seven with a
consequence axis, and the four modes separate monotonically in every bot policy and kill you differently.

The two things a reader should carry away are in §6 and §5: **half the tone lean is currently absorbed by
content eligibility**, measured and declared rather than papered over; and **the same task that
criticises numbers-in-comments committed that defect eleven times**, caught only because the numbers were
checked against the instrument they cited. Both are written into the code, not just into this document.
