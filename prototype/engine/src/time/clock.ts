/**
 * The world clock — time cost turns into advancing time (M1 task T12 · FR-CORE-03 · GDD IV).
 *
 * Every resolved action spends hours; those hours roll the shared clock forward through the day
 * phases and across midnight into the next day, and tick the monotonic turn counter. Phases are
 * a pure function of the hour, so the clock never drifts out of sync with the phase and two runs
 * that spend the same hours land on the same phase.
 *
 * Pure and deterministic (ADR-0001): no wall-clock, no RNG. Hours in are truncated to a
 * non-negative integer, so the clock can only ever move forward.
 */

import type { Meta, Phase } from "../state/types.js";

/**
 * The day phase for a given hour (GDD IV). Boundaries:
 *   dawn 05–07 · morning 08–11 · midday 12–16 · evening 17–20 · night 21–04.
 * Accepts any integer hour and normalizes it modulo 24, so callers never have to.
 */
export function phaseOf(hour: number): Phase {
  const h = ((Math.trunc(hour) % 24) + 24) % 24;
  if (h >= 5 && h <= 7) return "dawn";
  if (h >= 8 && h <= 11) return "morning";
  if (h >= 12 && h <= 16) return "midday";
  if (h >= 17 && h <= 20) return "evening";
  return "night"; // 21–23 and 00–04
}

/**
 * Advance the clock by `hours` (truncated, floored at 0). Rolls the hour across days, recomputes
 * the phase, and increments `turn` by one — a costed action is one resolved turn. Returns a new
 * `Meta`; the input is untouched.
 */
export function advanceClock(meta: Meta, hours: number): Meta {
  const spent = Math.max(0, Math.trunc(hours));
  const total = meta.hour + spent;
  const hour = total % 24;
  return {
    ...meta,
    day: meta.day + Math.floor(total / 24),
    hour,
    phase: phaseOf(hour),
    turn: meta.turn + 1,
  };
}
