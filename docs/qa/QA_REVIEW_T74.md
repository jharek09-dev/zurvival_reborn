# QA review — T74 · Hour accumulators (the sub-cycle granularity fix)

**Task:** M4 T74 — *Hour accumulators — the sub-cycle granularity fix*
**Source:** `docs/qa/DESIGN_REVIEW_2026_09.md` step 1 (Tier A, "reconnect")
**Date:** 2026-09-12
**Build:** engine 637 / harness 262 / content-loader 23 / schema 160 / a11y OK
**Verdict:** **PASS** — 0 blockers outstanding. Two adversarial audits + one verification pass; every finding fixed or explicitly declared.

---

## 1. What the task was

Thirteen — in the end **fourteen** — periodic systems computed `Math.trunc(hours / period)` against the
**current action's hour cost** and discarded the remainder. Ordinary turns cost 1–2 hours against periods
of 2–12, so the work never happened on the turns the game actually produces. Three duplicated copies of a
`stepToward(current, target, maxStep)` helper compounded it from the other side: `Math.max(1, maxStep)`
moved a full step on a zero-step tick, which made every `*_HOURS_PER_STEP` constant a **dead knob**.

The fix banks the remainder per subject, using the `desertPressure` idiom (T53): an optional integer field
that reads as 0 when absent, so **no `SAVE_SCHEMA_VERSION` rung** (stays v10 — the T56
optional-tolerated-absent precedent).

## 2. Measured before/after

Identical fixtures run against the pre-T74 tree and the T74 tree.

| Measure | Before | After |
| --- | --- | --- |
| Base food produced over a day of **2-hour turns** (one gardener) | **0** | **4** |
| The same day as one 24-hour fast-forward | 4 | 4 |
| Neglected companion over 120h of 2-hour turns | morale still 60, never left | **deserted at hour 70** |
| Off-screen survivor after 48h of 2-hour turns | never moved | reached faction home |
| Horde over 24h of 2-hour turns (6-node line) | never moved | crossed all 6 nodes |
| Region density, 24 × 1h vs 1 × 24h | **27 vs 18** (disagreed) | **18 vs 18** |
| `globalThreat` tide, 12 × 1h | 12 (1 point per turn) | 4 (12h ÷ a 3h period) |
| Region loot over 24h of 2h turns — downtown / mercy / ironworks / hillcrest | **0 / 0 / 0 / 12** | **4 / 7 / 9 / 21** (= the fast-forward, exactly) |
| Storm roads over a pinned 24h day of 2h turns | 100 → 100 | 100 → 92 |
| Snow grid / roads over the same | 100 / 100 | 96 / 96 |
| `advanceWorld` 12 × 2h vs 1 × 24h, job output | **0 vs 4** | **4 vs 4** |

## 3. Scope, declared honestly

**Fourteen** sites now bank, against the **nine** the task note enumerated. The extras, all the same bug
class, found by re-deriving the list rather than trusting the note:

| Site | Accumulator | Why it was added |
| --- | --- | --- |
| `routes.ts` wear | `world.routeWearHours` | the note's `stepToward` half; the floor made it move a **6-point** rise every turn |
| `weather.ts` grid drain | `world.powerDrainHours` | only a storm drained the grid; rain/snow truncated to nothing |
| `weather.ts` road drain | `world.roadDrainHours` | even a storm's roads truncated to nothing on an ordinary turn |
| `jobs.ts` off-screen wall decay | `world.wallDecayHours` | the watchtower halving lost every odd hour |
| `loot.ts` off-screen contest | `region.lootContestHours` | **not in the note at all**: four of the six shipped regions lost no loot on a 2-hour turn, five of six on a 1-hour turn |

The loot contest is the significant one: "a region you leave unsearched gets thinner" did not happen during
play, only across a fast-forward. Its T56 scarcity dial now rides the **period** rather than the point
count — scaling points per tick would re-truncate every tick, and on Story a low-activity region would
*still* have lost nothing on an ordinary turn. `contest === 1` short-circuits to the unchanged divisor, so
a Survivor/unset run debits exactly as before.

## 4. The invariant, and where it still does not hold

The verification bar was: *a run of 2h turns and a single `advanceWorld` over the same span must produce
the same job output, making "a played hour == a fast-forwarded hour" actually true.* Met, and proven for
jobs, scavenge and morale in `test/clocks.test.ts`.

**Declared limits** (in the `sim/clocks.ts` header, not glossed):

1. **RNG-per-tick layers.** `tickWeather` rolls one shift per tick, `driftRegions` draws one jitter per
   region per tick, `tickHordes` draws a wander target per arrival. Twelve ticks draw twelve times; one
   tick draws once. Chunking changes the *draws*, not the arithmetic. A per-hour draw schedule is a
   determinism change well beyond T74.
2. **Relaxation toward a moving target.** A dial that reaches its target stops counting; if the target then
   moves, the fine-grained path has banked fewer hours than the coarse one, which counted them before it
   knew the dial would pin. Inherent to a relaxation model — the two paths saw different target histories.
   With a fixed target the relaxation dials are exactly chunking-invariant.
3. **Three lossy-by-design rules.** A job cycle that comes due and stalls mid-tick spends its hours (the
   hour passed, the work did not happen); a job already stalled when the tick begins banks nothing, so a
   stall clearing inside one long fast-forward under-produces relative to the same span played out (the
   *played* path is the accurate one — parked as **PL-M5-08**); and `stepToward` steps beyond the remaining
   gap are dropped, because a dial cannot move past its target.

**The idle rule**, applied uniformly: a clock with nothing to do **holds** — it neither accrues nor resets
— and only an *assignment ending* resets it to zero (a worker pulled off a job, a companion taken off the
scavenge order, a cache with nothing left to rot). Holding is what stops an idle world rewriting state, and
the save, every turn.

## 5. Audit trail

Two adversarial subagents (engineering correctness; completeness & honesty) then a verification pass.
Everything below was found after the implementation was green, and is fixed unless marked *declared*.

| # | Severity | Finding | Resolution |
| --- | --- | --- | --- |
| 1 | MAJOR | `relax` **threw the bank away** when a dial sat on its target, so hours were lost at every equilibrium | now holds the carry; returning it unchanged also keeps the same-reference contract |
| 2 | MAJOR | 14th site missed: the loot contest still truncated | fixed, with the difficulty dial moved onto the period so it is invariant at **every** mode |
| 3 | MAJOR | `tickPeople` / `tickGroups` / stalled jobs / settled routes rewrote state **every turn** — churning the save and the FR-CORE-04 `changed` telemetry | idle gates on all four; verified same-reference over consecutive ticks at many turn lengths |
| 4 | MAJOR | `tickGroups`' `Math.min(steps, 2)` hop cap swallowed due steps; re-banking them made an unbounded stored burst (1296 h measured) | cap **removed** — it could never fire before T74, and `MOVE_HOURS` is the rate limit |
| 5 | MINOR | `bankHours` was not total on `NaN`; a hand-edited save could persist one, breaking `loadGame(saveGame(s))` and churning forever (`NaN !== NaN`) | `wholeHours` scrubs every path, banked **and** held |
| 6 | MAJOR (honesty) | "desertion and betrayal CANNOT occur" — **false**: the fear-driven path (`desertPressure`, which accrues by elapsed hours) was always live on ordinary turns | claim corrected everywhere; it is the *morale* half T74 restores |
| 7 | MAJOR (honesty) | "morale never drifted" / "the base produced nothing except across the sleep" / "a horde only advanced when the player rested" — each overstated (a 6h+ turn moved morale; `job.kitchen` turned on a 4h rest; the 8h quarantine moved the horde) | all three rewritten to the measured behaviour |
| 8 | MAJOR (honesty) | `timeOfDay.ts` implied T74 widens the threat tide. It **narrows** it: measured band 26..32 → 28..32 | comment corrected and the real cause (a 3-hour period against 3–6 hour phases, 25+ points away) handed to **T78** |
| 9 | MAJOR (honesty) | weather comment claimed the grid never fell; a storm did drain it at 12 points/day | corrected to the pinned arithmetic |
| 10 | MINOR | a surviving T52 test asserted inertness of a stalled generator and only passed because 24 h is a whole number of cycles | strengthened to every turn length, now true by construction |
| 11 | *declared* | the watchtower decay fix sits on a path nothing calls in play (`advanceWorld`), and the live stage-6 decay has no watchtower divisor at all | **PL-M5-07** |
| 12 | *declared* | a stall clearing mid-fast-forward under-produces | **PL-M5-08** |

Rebaselined assertions (the T71/T72 discipline — no golden fixture files exist):
`jobs.test.ts` "a sub-cycle tick banks nothing" → now asserts it **banks its remainder** and the next hour
completes the cycle; `radio.test.ts`'s within-the-turn drift case now seeds `threatHours:
THREAT_HOURS_PER_STEP - 1`, because drift no longer moves a point every turn.

## 6. Determinism & save

- **Not byte-identical, intentionally** — declared the way T71/T72 were. A pre-T74 save replayed on this
  build produces a different horde sequence from the same seed, because hordes now *arrive*, which clears
  `dest` more often and draws the `horde` stream more frequently.
- **No new RNG stream, no reordered draws.** `driftRegions` still draws one jitter per region per tick;
  `tickWeather` still draws one float plus its conditional pick; `tickHordes`' wander draw sits where it
  did.
- **No save rung.** `SAVE_SCHEMA_VERSION` stays **10**. All fourteen fields are `readonly …?: number`;
  `saveGame` is a whole-state pass-through with no whitelist; a field-free save ticks byte-identically to
  one carrying explicit zeros. Verified over 200-turn and 68-real-turn runs: every round-trip
  `toStrictEqual`, no `NaN` in any blob, every accumulator a non-negative integer or absent.
- **No scope creep.** `HORDE_HOURS_PER_STEP` is still 4 (T76 wants 2), no new `node.walkers` write,
  `zombies.ts` / `noise.ts` / `combat.ts` / `director.ts` / `events.ts` / `economy.ts` byte-identical.

## 7. What this unlocks, and what it invalidates

- **The base economy is ~5× up.** `order:scavenge` (1 item / 2h) no longer strictly dominates `job.garden`
  — the review's §IV dominance arithmetic is the one balance claim T74 invalidates immediately, and it
  should be re-derived before T59/T60.
- **Stash spoilage is live**, which makes `room.kitchen`'s refrigeration and `POWER_SPOIL_AT` real — and,
  with the weather drains live, makes a storm-driven grid failure a genuine threat rather than decoration.
- **Desertion has two live paths now.** The fear path always worked; the morale path is added on top at
  roughly five times the old rate. Worth watching in the T57 owner playtest.
- **Hordes move every turn.** T76 (collision, 4–6 hordes, step 4→2h) must be tuned against *this* build;
  tuning against the pre-T74 travel times would fit dials to the wrong curve.
- **T78 inherits a correction, not just a feature**: the tide is now slower than before. Fixing its slope
  means re-tuning `GLOBAL_THREAT_HOURS_PER_STEP` against the T71 seven-phase day, or it stays pinned in a
  4-point band.
- **The M4 exit gate / beta**: the `FUN_GATE_SLICE` transcript that motivated the review — twenty turns of
  "a horde on the move" with nothing arriving — now reads differently, but **arrival is still not an
  event** until T76. The gate should not credit T74 with more than it delivered.
