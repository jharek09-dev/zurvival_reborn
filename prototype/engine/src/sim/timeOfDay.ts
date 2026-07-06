/**
 * Time-of-day danger — the phase-of-day raises or lowers danger (M2 task T28 · FR-SIM-04 · GDD IV).
 *
 * The clock (T12) already rolls through five phases; until now the phase was only *narration* plus a
 * hardcoded stealth term buried in the combat roll. T28 gives the phase a single owner and makes it
 * mean something for danger across three systems, each a pure read so nothing new is randomised:
 *
 *   - **Stealth concealment** — darkness cuts visibility, so a slip-away is *harder to spot* at night
 *     (the countervailing realism). The T15 `detectChance` sources its phase term from
 *     {@link phaseConcealment} here (the same numbers it always used, now with one owner), so the
 *     combat/stealth golden behaviour is unchanged.
 *   - **Harder searches** — a search in the dark is louder (you can't see what you're knocking over):
 *     the search action deposits {@link phaseSearchNoise} extra points into node memory, so the dead
 *     are likelier to hear you rummaging after dark. This routes through the existing T14 model — the
 *     deposit's `params.noise` override — leaving `noiseOf` untouched.
 *   - **The threat tide** — the {@link tickTimeOfDay} layer body relaxes `world.globalThreat` toward a
 *     phase target: city-wide danger *rises after dark and ebbs by day*, real cyclic world state the
 *     director (T30) and the Scene both read. It is the layer's whole job.
 *
 * So night is more dangerous *overall* — the dead are more numerous and roused (higher tide) and your
 * rummaging carries further — even though the dark also hides a careful mover. Purity (ADR-0001): the
 * phase is a total function of the clock, so the whole model is deterministic — no RNG, no wall-clock.
 * The tide relaxes at most a bounded step per tick and is clamped 0–100, so it can never manufacture an
 * impossible state; a zero-hour tick is inert.
 */

import type { GameState, Phase } from "../state/types.js";

// --- the phase danger vectors (tunable engine constants) ------------------------------------

/**
 * Points of concealment the light level grants a stealth mover, *subtracted* from the T15 detection
 * chance — dimmer phase, smaller silhouette, harder to spot. Night hides most; midday not at all.
 * (These are exactly the phase numbers `detectChance` has used since T15, now named and owned here.)
 */
export const PHASE_CONCEALMENT: { readonly [p in Phase]: number } = {
  dawn: 5,
  morning: 0,
  midday: 0,
  evening: 5,
  night: 15,
};

/** Extra noise (points) a search deposits by phase — the dark makes rummaging louder / riskier. */
export const PHASE_SEARCH_NOISE: { readonly [p in Phase]: number } = {
  dawn: 0,
  morning: 0,
  midday: 0,
  evening: 6,
  night: 12,
};

/** The city-wide `globalThreat` level each phase pulls toward — the diurnal danger tide (0–100). */
export const PHASE_THREAT_TARGET: { readonly [p in Phase]: number } = {
  dawn: 30,
  morning: 25,
  midday: 15,
  evening: 40,
  night: 55,
};

/** `globalThreat` relaxes ~1 point per this many in-game hours toward the phase target. */
export const GLOBAL_THREAT_HOURS_PER_STEP = 3;

// --- pure read helpers (consumed by combat detection + the search action) -------------------

/**
 * Concealment (percentage points) the current light grants — the T15 `detectChance` subtracts this,
 * so a bigger value (night) means a *lower* chance of being spotted. Owned here as the phase's single
 * stealth term.
 */
export function phaseConcealment(phase: Phase): number {
  return PHASE_CONCEALMENT[phase];
}

/** Extra search noise (points) for a phase — added to a search's deposit so night rummaging carries. */
export function phaseSearchNoise(phase: Phase): number {
  return PHASE_SEARCH_NOISE[phase];
}

/** The `globalThreat` level a phase tends toward — night high, midday low. */
export function phaseThreatTarget(phase: Phase): number {
  return PHASE_THREAT_TARGET[phase];
}

const clampPct = (n: number): number => Math.max(0, Math.min(100, Math.trunc(n)));

/** Move `current` toward `target` by at most `maxStep`, at least one point when there is a gap. */
function stepToward(current: number, target: number, maxStep: number): number {
  const gap = target - current;
  if (gap === 0) return current;
  const mag = Math.min(Math.abs(gap), Math.max(1, maxStep));
  return current + Math.sign(gap) * mag;
}

/**
 * The body of the `timeOfDay` world-sim layer (pipeline stage 8, after weather). Relax
 * `world.globalThreat` toward the current phase's target as the tick's hours pass — the diurnal
 * danger tide. Touches only `world`; returns the same state reference when nothing moved or on a
 * zero-hour tick (preserving the empty-turn contract). Deterministic; no RNG, no clock read beyond
 * the phase already on `meta`.
 */
export function tickTimeOfDay(state: GameState, hours: number): GameState {
  const h = Math.max(0, Math.trunc(hours));
  if (h === 0) return state;
  const target = phaseThreatTarget(state.meta.phase);
  const globalThreat = clampPct(stepToward(state.world.globalThreat, target, Math.trunc(h / GLOBAL_THREAT_HOURS_PER_STEP)));
  if (globalThreat === state.world.globalThreat) return state;
  return { ...state, world: { ...state.world, globalThreat } };
}
