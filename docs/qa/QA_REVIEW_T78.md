# QA Review — T78 · Director & drift correction — a threat curve with a positive slope

**Date:** 2026-09-13 · **Milestone:** M5 (first task, seq 101) · **Task:** T78 (design review 2026-09-12, step 7)
**Status:** DONE · **Not byte-identical** — intentional behaviour change, declared like T74–T77. The
threat curve's slope is the thing this task exists to move.

**CI (clean sandbox):** engine **802** (was 759 at T77) / harness **264** / content-loader **23** / testlab
**22** / schema gate **160** / a11y gate OK / `tsc --noEmit` clean in all four packages. Save schema
**v10 holds — no migration rung**: every new field is optional-tolerated-absent (`Wound.inflictedHour`,
`World.directorReliefDay` / `directorReliefBeats`, `RegionState.directorBias` / `directorBiasHours`),
and a bias of zero is *absent*, never a stored 0, so a clean region is byte-identical to a pre-T78 one.

---

## 1. What was wrong

Four mechanisms pushed the threat curve **downward**, and together they made the world safest for the
player who was doing worst (design review §III, T78's brief):

1. **`playerDistressed` was true for any wound with `treated < 100`**, and wounds never close with time.
   After the first fight the director sat in `relief` on **100% of the remaining turns** of every
   measured run (86% of all turns under a fighting policy, 70% under a careful one), pushing density
   down a point a turn. The comeback rope was the only beat it ever played.
2. **The drift targets ignored the authored baseline.** `equilibriumDensity = 20 + threat·3/5 −
   activity·2/5` and `threatTarget = density/2` are a fixed point near zero: over 30 idle days every
   shipped district converged to **threat 0–11 / density 0–22** whatever it was authored at. Downtown's
   70/80 read 10/20 by day 14; the authored threat spread of 50 was 9–11; the four difficulty modes
   were **217/217/218/218** bodies apart at day 30.
3. **`pressureRead` was pinned at 21–23, under `DIRECTOR_LOW_BAND` 25**, so the director read
   `escalate` on every undistressed tick — a bang-bang controller at one output. Calm turns: 80%.
4. **Nothing ramped with the calendar.** Day 40 was day 2 with fewer zombies. And the diurnal tide,
   which T74 had made honest but slower, sat in a **27..31** band against phase targets of 15 and 55.

---

## 2. What shipped

### `sim/director.ts` — distress by weight or shock; relief rationed; beats that last

- **Distress** is now `woundBurden ≥ DIRECTOR_WOUND_DISTRESS` (40 — one untreated bite) **or** an
  open wound younger than `DIRECTOR_FRESH_WOUND_HOURS` (6). A laceration dressed down to a scab is
  not a crisis. Every live wound source now stamps `inflictedHour` (`combat.ts` ×4, `overrun.ts`,
  `events.ts`, `wounds.ts#woundPlayer`); a pre-T78 wound counts from 00:00 of its day and can only read
  *older*, never fresh.
- **Relief is rationed**: at most `DIRECTOR_RELIEF_PER_DAY` (4) beats per in-game day, keyed on the
  day stamp. `directorBeat` itself reads the ration, so a capped-out tick reports `hold` — the beat
  the telemetry sees is the beat taken.
- **The bias.** Every beat that lands also leans the region's drift anchor by ±step, clamped to
  `±DIRECTOR_BIAS_MAX` (10), decaying one point per `DIRECTOR_BIAS_DECAY_HOURS` (24) in every region,
  banked (T74 idle-HOLD at zero), and decaying **whether or not the director is enabled** — disabling
  stops the beats, not the clock. Found by measuring the first cut, see §4.1.

### `sim/regionDrift.ts` — the anchor and the ramp

- `equilibriumDensity` / `threatTarget` take an optional **anchor** (`driftAnchor(baseline, day,
  bias)`): the same coupling (3/5, 2/5, 1/2) measured as *deviations from the authored point* instead
  of from zero. Loop gain 0.3 < 1, so the authored dials are the drift's fixed point and the jitter
  keeps it alive around them. Without a graph (a fixture, an off-screen advance without one) the
  pre-T78 absolute targets apply — a declared fallback, not an inert layer.
- **The day ramp**: the anchor climbs `DAY_RAMP_PER_DAY` (1) per day after the first, capped at
  `DAY_RAMP_CAP` (30). It lives on the anchor, not as a floor in `pressureRead` (§4.2).
- `worldSim.ts` hands the transient graph to drift; `driftRegions(state, hours, graph?)`.

### `sim/timeOfDay.ts` + `sim/clocks.ts#relaxBy` — the tide retuned

`GLOBAL_THREAT_HOURS_PER_STEP` 3 → **1**, new `GLOBAL_THREAT_POINTS_PER_STEP` **3**, via `relaxBy`
(`relax` with a step size; identical at 1). PL-M5-09's inherited correction.

### `prototype/harness/measure/t78.ts` (new) — the committed runner

`npx tsx measure/t78.ts [--director|--onoff|--ramp|--tide]` on the shipped city. Every figure below
re-derives from it on either tree (the two first-cut figures in §4.1 are labelled as such).

---

## 3. Measured, before → after

The policies are deliberately crude and **bad at the game** (the T77 discipline). Read them as a probe
of the systems, never as a model of skilled play.

**Off-screen, 30 idle days (`t78.ts`, seeds t78-a/b):**

| | before | after |
|---|---|---|
| Downtown (authored 70/80) at d14 / d30 | 10/20 · 11/22 | 82/91 · 99/100 |
| Rivermouth, the start region (35/45), d7 / d30 | 9/17 · 9/17 | 41/52 · 65/76 |
| mean threat d0 → d30 (authored mean 51.67) | 51.67 → 6.8 | 51.67 → 79.7 |
| authored threat spread 50, at d14 / d30 | 9–10 / 10–11 | **49–51** / 40–41 |
| bodies citywide d0 → d30 | 201 → 217 | 201 → 284 |
| day-30 bodies, Story/Survivor/Hardcore/Nightmare | 217/217/218/218 | **284/284/284/284** (§6) |
| riot / bloated at d30 | 4/7 | 4/8 · 5/6 (§6) |

**The director under play (`--director`, 8 seeds × 400 turns, shipped city):**

| | before (fight / careful) | after (fight / careful) |
|---|---|---|
| beats: escalate / relief / hold | 13% / **86%** / 1% · 22% / **70%** / 8% | 7% / **25%** / 68% · 9% / **29%** / 61% |
| relief on the turns after the first wound | **100% / 100%** | 28% / 44% |
| distressed turns | 86% / 70% | 85% / 64% |
| pressure mean (min–max) | 23.0 (17–37) / 24.1 (17–42) | 34.0 (17–61) / 34.5 (17–62) |
| calm turns (pressure < 25) | 80% / 64% | 11% / 10% |
| director lean on the current region, mean (floor turns) | — | −4.1 (7.9%) / −2.1 (2.7%) |
| mean end day | 3.75 / 3.88 | 3.63 / 3.63 |

**The T30 DoD — director ON vs OFF (`--onoff`, fight policy):** mean pressure **34.02 vs 35.47**, end
density/threat where the run ended **55.9/47.1 vs 62.6/53.1**, mean lean −4.1 vs 0. The undistressed
idle probe is identical either way (home density 63/63) — see §6.

**The tide (`--tide`, idle days 8–12 on 2-hour turns):** band **27..31 → 16..49** against targets of
15 (midday) and 55 (night). The midday floor is reached (min 16); the night ceiling is not (max 49,
mean 42) — a ~one-phase lag on the rising side, the night's climb peaking in the early morning.

**The ramp (`--ramp`, immortal idle probe at the start node, 40 days):** mean daily pressure **d2 ≈ 23
→ d40 ≈ 18–21 before**, **d2 ≈ 36 → d40 ≈ 44–49 after**; the home region ends at threat 55–65 / density
63–75 instead of 5–11 / 10–18. The two seeds that got wounded on the way show the lean: their home
district ends **10 points lower** than the two that did not.

---

## 4. Corrections to the brief, all measured

1. **The bias was not in the brief; the measurement demanded it.** With the drift anchored, the
   director's ±1 nudge on the dial itself was undone by the next drift step, and the first cut's
   on/off probe could not tell ON from OFF — *first cut, dial nudge only, a tree that no longer exists
   and is not re-derivable:* mean pressure 35.44 vs 35.47, end density 61.1 vs 62.6. A pacing
   controller whose removal changes nothing is dead wiring, the class of fault the whole pass exists
   to remove. So a beat now leans the anchor (the header's own words since T30: *"T24's relaxation
   stays the neutral substrate; the director is the directed bias on top of it"*). On the shipped tree
   the same probe separates them by 6–7 points of density and threat.
2. **No `dayFloor` on `pressureRead`; a ramp on the anchor instead.** A floor on a *read* changes
   telemetry and beats and nothing else; a ramp on the anchor becomes density, which T75 turns into
   bodies — the review's whole point was that consequences must not terminate in a number nobody acts
   on. The director's read sees the ramp through `region.threat` for free.
3. **`DIRECTOR_WOUND_DISTRESS` is 40, not the brief's 60** — one untreated bite (`wound.bite`
   severity 40, the T77 `SCENT_FULL_AT`), so there is one sentence for it: a fresh bite is a crisis,
   a dressed cut is not. On the crude bots (burden 128–268) 40 vs 60 makes no measured difference —
   see §6, the narrowing versus the ration.
4. **The tide's night target is still not reached** (max 49 vs 55) on the 2-hour grain. The 30-point
   swing is this task's; the ceiling is T60's.
5. **PL-M2-03 is closed** (Rivermouth 35 → 41 by day 7 off-screen, where it used to fall 35 → 7).
   **PL-M4-26's upward-driver half is closed** — a region's threat can now climb live→failing→dead on
   the radio, and does (§6). **PL-M5-09's tide correction is done. PL-M5-24** (the director's old
   `treated < 100` idiom) is closed by construction.

---

## 5. Audit — three passes, and this time the context was lost between them

Two independent adversarial passes (engineering; completeness-and-honesty), then a verification pass
on every fix. Process note, for the record: the first attempt at this task lost its session mid-audit
(both auditors were cut off with no report). The work was recovered from the session transcript and
the 00:29 diff, re-proven by re-running CI to the recorded numbers, and the audits were re-run from
scratch — nothing below is inherited from the aborted pair.

**Engineering pass — six findings, all fixed with a discriminating test each:**

- A **non-finite clock** (`meta.day` = `1e999` → Infinity, or NaN; `loadGame` does not validate it)
  made every open wound read age 0 — the shock clause fired *forever* — and a NaN day dodged the ration
  outright (NaN never equals itself) while the tick wrote the bad day into `world.directorReliefDay`
  (serialised as `null`). Now `woundAgeHours` fails **closed** (a non-finite clock reads every wound as
  old) and the ration is keyed and stamped through `wholeHours`.
- **All six live wound-stamp sites were unprotected**: a mutation dropping `, state.meta.hour` from
  any one of them survived the suite, because the only test called `inflictWound` directly. The shock
  clause could have died per source, silently — the dead-wiring class this pass removes. Now
  `test/woundStamp.test.ts` runs each source through the real pipeline (walker blow, bloated burst,
  crawler grasp, parting blow, overrun, encounter effect) plus the exported `woundPlayer` helper, which
  the verification pass found as an unstamped seventh source.
- **A disabled director froze the lean forever** — the decay loop sat behind the enabled check while
  `driftRegions` kept reading the bias, so `director.disabled` turned a lean into a permanent scar,
  against the header's own promise. Decay now runs before the check.
- A pre-T78 save's `threatTideHours` carry (banked under the old 3-hour period) came due as up to two
  extra 3-point steps on its first tick. Dropped; at most two hours of tide lost once.
- "Story barely escalates" was false: `scaleInt(1, 0.5)` is 0, so **Story never escalates and never
  leans a district upward** — `difficulty.ts` had said so all along. Comment corrected; pinned by test.
- The stored bias was never asserted in range — the read-side clamp hid an overshoot to 11. Pinned.

**Honesty pass — nine over-claims, all corrected in the text they lived in:**

- *"the low band is now reachable only in a district the player has pacified"* — false. **Every
  escalate beat on the shipped city is a day-1 beat** (24 of 24 under both policies, 4 of 4 in the idle
  probe, none after day 1 in 889 measured turns): the low band is reached only while `globalThreat`
  climbs from 0 on the first day. Stated now, with the pacified case marked unmeasured (PL-M5-33).
- The tide's "trough in the late afternoon" was midday; "≈10 under both targets" was true of the
  ceiling only. Corrected to the measured phase means.
- The radio crossing days were anchor-days for the wrong gate (`REGION_FALL_AT` governs *military*
  signals; Ironworks and Rivermouth have none — theirs die at `REGION_SILENT_AT` 60). Re-measured
  against the real gates and signals (§6).
- *"the difficulty modes were one body apart because repopulation had nothing to fill toward"* — the
  after-run refutes the cause: at density 83 the spread is **zero**. The modes reach the population only
  through the escalate step, which no longer fires after day 1. Restated (§6).
- Two first-cut numbers were quoted as if re-derivable. Labelled. Three test comments said "against
  the unfixed code" about the first cut rather than the baseline; one test's stated reason was wrong.
- "The ramp outpaces the decay" — both are 1/day; "matches". `DIRECTOR_NEED_DISTRESS` was mirrored
  in the runner as "not exported" — it is now, and the runner reads it off the namespace.

**Verification pass:** every fix re-mutated and killed by its named test (F1 ×2, F2 ×6, F3, F4, F5,
F6); every quoted figure in every header re-derived on both trees and matched; radio timeline
re-derived independently and matched; no test title or comment presents a first-cut number as
re-derivable. Two further residuals fixed: `woundPlayer` stamped; the `MILITARY_FAILING_AT` wording.

---

## 6. Declared limits and what this does not do

- **The narrowing is nearly inert on measured play; the ration did the work.** The bots carry a wound
  burden of 128–268 (wounds never close, dressings are scarce), so the weight clause never releases
  them and the shock clause fires on 3–5% of turns; distressed turns moved 86%→85% and 70%→64%. Relief
  fell 86%→25% and 70%→29% through the ration alone. The narrowing protects a player who *dresses*
  wounds — proved at the unit level, unreachable by these bots. Whether wounds should close with time
  is T59/T60's (**PL-M5-30**).
- **Mean end day did not move** (3.75→3.63, 3.88→3.63; thirst and infection still end every run). This
  pass changes what the world does, not yet how long a run lasts.
- **For an undistressed player the director is idle after day 1.** The on/off idle probe is identical
  (63/63); the T30 DoD holds *under distress* (ON 55.9 vs OFF 62.6). `DIRECTOR_LOW_BAND` 25 against
  anchored pressure of 34–50 is a retune for T60 — or a band relative to the anchor (**PL-M5-33**).
- **The ramp saturates the top districts.** Downtown and Mercy hit 99–100/100 by day 30; the authored
  spread erodes 50 → 40 there through the clamp, not the drift. The ramp's LEVEL (1/day, cap 30) is
  T59/T60's; the SLOPE is this task's deliverable.
- **The radio network goes dark on a schedule.** Under the ramp the Ironworks ham operator falls silent
  on day 7–8, Hillcrest's evac-stadium signal fails on day 7 and dies on day 27, the Rivermouth plea
  dies on day 27, and (content, not the ramp) the EAS ends on day 13 — so by day 27 every region-bound
  signal is dead air and only the numbers station and the anomaly remain. That is the *"war being lost
  on the radio"* PL-M4-26 asked to be reachable; whether day 27 is the right day is T59/T60's
  (**PL-M5-32**).
- **The difficulty spread is now ZERO bodies at day 30** (284 ×4, mean density 83.5 in all modes; was
  one body). Repopulation still has no dial (**PL-M5-11** stays open, and now has a density worth
  biting on) and the escalate step no longer fires after day 1.
- **Riot/Bloated stay dormant** (**PL-M5-12**: 4/6 → 4/8 and 4/6 → 5/6 over 30 days) even with
  Downtown and Mercy at density 100: both sit at carrying capacity from the seed and repopulation
  HOLDS there. The ≥70 gate is now met; the input is no longer the problem, the capacity is.
- **T79's cap must be re-derived.** Its brief caps neglect at `baseline.threat + 20`; T78's ramp alone
  adds 30, plus ±10 of bias, on the same anchor (**PL-M5-31**).
- **One beat per tick**, whatever the tick's hours (an 8-hour sleep is one beat, four 2-hour turns are
  four) — the T74 pass left the director per-turn on purpose; the ration bounds it.
- At a 1-hour tide period `threatTideHours` only ever reads 0 — kept because the period is a tunable
  and the T74 idiom is uniform.
- A pre-T78 save's wounds carry no hour and read as opened at 00:00 of their day: a wound inflicted
  earlier the same day can read fresh for up to six hours after load. Conservative side, stated.

**Lesson to carry.** Three tasks have now said it and this one says it a fourth way: **a fix that is not
measured is a guess** — the first cut was internally consistent, fully tested, and inert. Only the
on/off probe on the shipped city showed it. And a corollary from the honesty pass: **the second
mechanism you add gets credited for the first one's work unless you measure them apart.**
