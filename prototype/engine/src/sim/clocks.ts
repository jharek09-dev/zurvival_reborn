/**
 * Hour accumulators — the sub-cycle granularity fix (M4 task T74 · design review 2026-09-12 step 1).
 *
 * Every world system in here runs on a *period*: a job turns a cycle every `hoursPerCycle`, a region
 * drifts a point every `DENSITY_HOURS_PER_STEP`, a horde walks a node every `HORDE_HOURS_PER_STEP`.
 * Until T74 each of those computed `Math.trunc(hours / period)` against **the current action's hour
 * cost** and threw the remainder away. Ordinary turns cost 1–2 hours against periods of 2–12, so
 * `trunc(2 / 6)` was 0 and the work simply never happened on the turns the game actually produces.
 * Measured against the pre-T74 build, precisely:
 *   - the base produced **nothing** on a 1–2 hour turn; `job.kitchen` (4h) also turned on a 4-hour
 *     `rest`, and every 6-hour job only across the 9-hour sleep — one gardener ≈ 1 fresh food per
 *     in-game DAY, against the ~7 items a search run pulls;
 *   - morale drifted one 4-point step per 9-hour sleep and **nothing** on any other turn, so the
 *     morale-driven desertion path took ~10 nights (the FEAR-driven path, `desertPressure`, accrues by
 *     elapsed hours and was always live on ordinary turns — that half was never broken);
 *   - off-screen survivor regroup (`trunc(h / 12)`) **never fired once**, because the longest action
 *     the game can produce is the 9-hour sleep;
 *   - a horde advanced only when the player rested or slept;
 *   - only a storm (`powerPressure` 3) drained the grid on an ordinary turn, at 12 points/day; every
 *     lighter weather pressure truncated to nothing.
 *
 * The fix is to **bank the remainder** — the idiom `desertPressure` (T53) already uses correctly.
 * A subject carries the hours it has accrued toward its next cycle as an optional integer field
 * defaulting to 0, so a save written before T74 loads with every clock at zero and no
 * `SAVE_SCHEMA_VERSION` rung is needed (the T56 optional-tolerated-absent precedent).
 *
 * The point of banking is an invariant the module headers have claimed since T23 but never held:
 *
 *   **a played hour == a fast-forwarded hour** — N turns of `h` hours do exactly what one
 *   `advanceWorld(N·h)` does.
 *
 * Truncation broke it in both directions (six 2-hour turns produced nothing where one 12-hour advance
 * produced two cycles). `bankHours` makes the arithmetic associative — `trunc((a + b) / p)` is
 * recovered from `trunc(a / p)` plus `trunc((a mod p + b) / p)` — so the invariant now holds for every
 * **production/decay** clock: jobs (subject to rule 3 below), stash spoilage, scavenge, morale,
 * regroup, wall decay, the loot contest, the weather drains and horde movement.
 *
 * Where it still does NOT hold, and why — declared rather than glossed:
 *   1. **RNG-per-tick layers.** `tickWeather` rolls one shift per tick, `driftRegions` draws one
 *      jitter per region per tick, `tickHordes` draws a wander target per arrival. Twelve ticks draw
 *      twelve times; one tick draws once. Chunking therefore changes the *draws*, not the arithmetic.
 *      Giving these a per-hour draw schedule is a determinism change well beyond T74.
 *   2. **Relaxation toward a MOVING target.** A dial that reaches its target stops counting (see
 *      {@link relax}); if the target then moves, the fine-grained path has banked fewer hours than the
 *      coarse one, which counted them before it knew the dial would pin. This is inherent to a
 *      relaxation model, not an accumulator defect: the two paths saw different target histories.
 *      With a fixed target the relaxation dials are exactly chunking-invariant.
 *   3. **Three lossy-by-design rules**, all deliberate: a job cycle that comes due but stalls mid-tick
 *      (the last input was spent, the wall filled up) SPENDS its hours — the hour passed and the work
 *      did not happen; a job already stalled when the tick BEGINS banks nothing at all, so a stall that
 *      clears inside one long fast-forward under-produces relative to the same span played out (the
 *      played path is the accurate one — with the shipped garden->kitchen pairing, 24 hours played as
 *      1h/2h/4h turns all yield 1 fresh + 3 canned, while a single 24-hour advance yields 4 fresh + 0
 *      canned, because the kitchen had nothing to cook at the instant the advance began; interleaving
 *      job cycles within a tick is a scheduling change well beyond T74 — parked as PL-M5-08); and
 *      {@link stepToward} steps beyond the remaining gap are dropped rather than re-banked, because a
 *      dial cannot move past its target.
 *
 * The rule every site follows for an idle clock: **a clock that has nothing to do HOLDS — it neither
 * accrues nor resets — and only an assignment ENDING resets it to zero** (a worker pulled off a job,
 * a companion taken off the scavenge order, a cache with nothing left to rot). Holding is what keeps
 * an idle world from churning state, and the save, every single turn.
 *
 * Pure, integer-only (ADR-0001), no RNG, no clock read.
 */

/** What a banked tick yields: whole periods that came due, and the remainder to carry. */
export interface Banked {
  /** Whole cycles/steps that came due this tick (never negative). */
  readonly steps: number;
  /** Hours left over, to be carried on the subject into the next tick (always `0 <= rest < per`). */
  readonly rest: number;
}

/**
 * Integer-only, finite, non-negative — the discipline every accumulator field keeps (ADR-0001).
 * Exported because the sites that HOLD a clock write the carry straight back without going through
 * {@link bankHours}; they must scrub it too, or a hand-edited save's `NaN` would persist (and, since
 * `NaN !== NaN`, churn the state every tick forever).
 */
export const wholeHours = (n: number | undefined): number =>
  Number.isFinite(n) ? Math.max(0, Math.trunc(n as number)) : 0;
const whole = wholeHours;

/**
 * Add `hours` to the `carried` remainder and drain whole `per`-hour cycles out of the total.
 * `carried` is the subject's optional accumulator field — `undefined` (a pre-T74 save, or a subject
 * that has never run this clock) reads as 0.
 *
 * Total by construction: a non-positive `per` is treated as 1 (a per-hour clock), and anything that is
 * not a finite number — negative, fractional, `NaN` off a hand-edited save — is floored to a whole
 * non-negative count. So no caller can put a fractional, negative or `NaN` value into a saved
 * accumulator, which would otherwise survive `JSON.stringify` as `null` and break save losslessness.
 *
 * The `rest` is what makes the clock hour-exact: `bankHours` over a sequence of ticks yields the same
 * total `steps` as one `bankHours` over their summed hours, for any chunking.
 */
export function bankHours(carried: number | undefined, hours: number, per: number): Banked {
  const p = Math.max(1, Number.isFinite(per) ? Math.trunc(per) : 1);
  const total = whole(carried) + whole(hours);
  const steps = Math.trunc(total / p);
  return { steps, rest: total - steps * p };
}

/**
 * Move `current` toward `target` by at most `maxStep` points. The shared replacement for the three
 * copies that lived in `regionDrift`, `timeOfDay` and `routes`, each of which clamped the step with
 * `Math.max(1, maxStep)` — which made every `*_HOURS_PER_STEP` constant a **dead knob**: a zero-step
 * tick still moved a full step, so every dial moved once per turn no matter how many hours passed or
 * how the constant was tuned (in `regionDrift` and `timeOfDay` that was 1 point a turn; in `routes`,
 * where the floored step count is multiplied by `ROUTE_WEAR_RISE_PER_STEP`, it was a full 6-point rise
 * on a one-hour turn). Here a zero step moves nothing, and the period governs.
 *
 * Steps beyond the remaining gap are dropped, not re-banked — a dial cannot overshoot its target.
 */
export function stepToward(current: number, target: number, maxStep: number): number {
  const step = whole(maxStep);
  const gap = target - current;
  if (gap === 0 || step === 0) return current;
  return current + Math.sign(gap) * Math.min(Math.abs(gap), step);
}

/** A relaxation result: the dial's new value and the remainder to carry on the subject. */
export interface Relaxed {
  readonly value: number;
  readonly rest: number;
}

/**
 * The banked form of the relaxation the drift models use: accrue `hours` against `carried`, then step
 * `current` toward `target` by the cycles that came due.
 *
 * A dial already **at** its target has nothing to count down to, so its clock HOLDS: it accrues no new
 * hours (an equilibrium does not store up a burst to spend the moment the target twitches) and it
 * keeps whatever it had already banked (hours are never thrown away). Because the carry comes back
 * unchanged, the caller's `rest !== (carried ?? 0)` check is false and the layer returns the very same
 * state reference — the "nothing moved ⇒ nothing written" contract these layers have held since T24,
 * so an idle world does not churn the save every turn.
 */
export function relax(
  current: number,
  target: number,
  carried: number | undefined,
  hours: number,
  per: number,
): Relaxed {
  return relaxBy(current, target, carried, hours, per, 1);
}

/**
 * {@link relax} with a step SIZE: every cycle that comes due moves the dial `points` toward the target
 * (T78, for the diurnal tide, whose targets sit 25 points apart across 3-hour phases — one point per
 * cycle could never get there). Identical to `relax` at `points` 1; a non-positive or non-finite
 * `points` is treated as 1, so no caller can make a clock stand still by mis-tuning it. The HOLD rule
 * and the overshoot rule are unchanged.
 */
export function relaxBy(
  current: number,
  target: number,
  carried: number | undefined,
  hours: number,
  per: number,
  points: number,
): Relaxed {
  if (current === target) return { value: current, rest: whole(carried) };
  const { steps, rest } = bankHours(carried, hours, per);
  const size = Math.max(1, Number.isFinite(points) ? Math.trunc(points) : 1);
  return { value: stepToward(current, target, steps * size), rest };
}
