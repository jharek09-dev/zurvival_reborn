/**
 * Time-of-day danger — the phase-of-day raises or lowers danger (M2 task T28 · FR-SIM-04 · GDD IV).
 *
 * The clock (T12) rolls through seven phases (T71: early morning · dawn · morning · midday · late
 * afternoon · dusk · night); the phase is narration plus a stealth term the combat roll reads. T28 gives
 * the phase a single owner and makes it mean something for danger across three systems, each a pure read
 * so nothing new is randomised:
 *
 *   - **Stealth concealment** — darkness cuts visibility, so a slip-away is *harder to spot* after dark
 *     (the countervailing realism). The T15 `detectChance` sources its phase term from
 *     {@link phaseConcealment} here. (T71 retuned these vectors for the seven-phase day — the darkest
 *     phases, night and early morning, conceal most and press hardest; midday is the safe floor.)
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
import { relaxBy, wholeHours } from "./clocks.js";

// --- the phase danger vectors (tunable engine constants) ------------------------------------

/**
 * Points of concealment the light level grants a stealth mover, *subtracted* from the T15 detection
 * chance — dimmer phase, smaller silhouette, harder to spot. Night hides most; midday not at all.
 * (These are exactly the phase numbers `detectChance` has used since T15, now named and owned here.)
 */
export const PHASE_CONCEALMENT: { readonly [p in Phase]: number } = {
  "early morning": 12,
  dawn: 5,
  morning: 0,
  midday: 0,
  "late afternoon": 0,
  dusk: 5,
  night: 15,
};

/** Extra noise (points) a search deposits by phase — the dark makes rummaging louder / riskier. */
export const PHASE_SEARCH_NOISE: { readonly [p in Phase]: number } = {
  "early morning": 10,
  dawn: 0,
  morning: 0,
  midday: 0,
  "late afternoon": 0,
  dusk: 6,
  night: 12,
};

/** The city-wide `globalThreat` level each phase pulls toward — the diurnal danger tide (0–100). */
export const PHASE_THREAT_TARGET: { readonly [p in Phase]: number } = {
  "early morning": 45,
  dawn: 30,
  morning: 25,
  midday: 15,
  "late afternoon": 22,
  dusk: 40,
  night: 55,
};

/**
 * `globalThreat` moves `GLOBAL_THREAT_POINTS_PER_STEP` points per this many in-game hours toward the
 * phase target. T78 retuned both against the T71 seven-phase day (PL-M5-09): at the old 1 point / 3 h
 * the tide could not cross a 25-point gap inside a 3-hour phase, so it sat in a 27..31 band against
 * targets of 15 (midday) and 55 (night) — measured over idle days 8–12 with `harness/measure/t78.ts
 * --tide`. At 3 points / 1 h it spans 16..49 with a ~one-phase lag on the RISING side (the dead take
 * the evening to rouse: the night's climb peaks in the early morning, mean 45 against night's mean 42).
 * The midday floor is reached (min 16 against a target of 15); the night ceiling is not — max 49,
 * mean 42, against 55 — on a 2-hour turn grain. The ~30-point swing is what T78 delivers; the
 * ceiling is T60's to tune. The first week is a climb from 0 either way; the band figures describe
 * the settled tide.
 */
export const GLOBAL_THREAT_HOURS_PER_STEP = 1;
export const GLOBAL_THREAT_POINTS_PER_STEP = 3;

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
  // The tide banks its remainder hours (T74). Before, the old stepToward's `Math.max(1, ...)` floor made
  // GLOBAL_THREAT_HOURS_PER_STEP a dead knob — the tide moved one point per turn whatever the period.
  // T74 noted honestly that making the knob live made the tide SLOWER (26..32 → 28..32 over five days):
  // a 3-hour period cannot cross a 25-point gap inside a 3–6 hour phase. T78 retuned it (see the
  // constants above): the banked hours come due at the period, and each due step moves the tide
  // GLOBAL_THREAT_POINTS_PER_STEP points — the same `bankHours` carry every other clock uses, so a
  // 2-hour turn and an 8-hour sleep spend the same hours. The phase target is read ONCE per tick from
  // the state handed in: on the played path the pipeline has already advanced the clock (stage 2), so a
  // 9-hour sleep relaxes the whole 9 hours toward the phase it WAKES in (dawn, 30 — measured: 40 → 30,
  // where nine 1-hour ticks reach 43); `advanceWorld` leaves `meta` to its caller, so an off-screen
  // advance relaxes toward whatever phase the caller's meta says. A T74-declared chunking limit
  // (relaxation toward a moving target), unchanged by the retune.
  // A carry banked under the OLD 3-hour period (a pre-T78 save holds 0–2 hours) would come due as up to
  // two extra 3-point steps on its first tick here. Drop anything at or beyond the live period instead:
  // at most two hours of tide are lost once, and a `1e999`/NaN carry is scrubbed by the same line.
  // (At a 1-hour period the carry is always 0, so `threatTideHours` is a field that only ever reads 0
  // while the period stays 1 — kept because the period is a tunable, and the T74 idiom is uniform.)
  const carried = Math.min(wholeHours(state.world.threatTideHours), GLOBAL_THREAT_HOURS_PER_STEP - 1);
  const tide = relaxBy(state.world.globalThreat, target, carried, h, GLOBAL_THREAT_HOURS_PER_STEP, GLOBAL_THREAT_POINTS_PER_STEP);
  const globalThreat = clampPct(tide.value);
  if (globalThreat === state.world.globalThreat && tide.rest === (state.world.threatTideHours ?? 0)) return state;
  return { ...state, world: { ...state.world, globalThreat, threatTideHours: tide.rest } };
}
