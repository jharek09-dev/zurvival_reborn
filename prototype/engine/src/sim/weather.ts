/**
 * Weather with multi-system effects (M2 task T27 · FR-SIM-05 · GDD IV "Weather").
 *
 * Weather is a *mechanic, not a backdrop*. `World.weather` has been a single content id that never
 * changed; T27 makes it **transition over time** and, crucially, **touch several systems at once** —
 * the requirement is the coupling, not the fiction. Each weather state carries a small effect vector:
 *
 *   - a **noise factor** (rain and storms quiet footsteps; wind carries sound further),
 *   - a **detection delta** on the T15 stealth roll (rain/fog/storm cut visibility → easier to hide;
 *     snow shows tracks and wind rattles → easier to spot),
 *   - **power** and **road** decay pressure (a storm knocks the grid down and blocks roads; snow ices
 *     the roads and strains the grid),
 *   - a **movement delta** (snow slows you) exposed for the route/movement layer to consult.
 *
 * So one weather change is felt in more than one place: a storm re-labels the sky *and* drains
 * `World.powerGrid` *and* degrades every region's `roads` *and* makes you harder to see. Transitions
 * are a sticky, plausible walk over the weather set (clear tends to cloud before it rains) drawn from
 * the named `weather` stream, so a seed reproduces the whole forecast. Effects only ever push
 * infrastructure *down* (it decays, never self-heals — GDD IV).
 *
 * Pure, deterministic, integer-only (ADR-0001). The stealth/noise modifiers are exposed as pure
 * helpers the combat and (future) noise systems read; the power/road pressure is applied here.
 */

import type { ContentId, GameState, RegionState } from "../state/types.js";
import { drawFloat, drawPick } from "../rng/streams.js";

// --- the weather set ------------------------------------------------------------------------

export const WEATHER_CLEAR: ContentId = "weather.clear";
export const WEATHER_CLOUDY: ContentId = "weather.cloudy";
export const WEATHER_RAIN: ContentId = "weather.rain";
export const WEATHER_STORM: ContentId = "weather.storm";
export const WEATHER_FOG: ContentId = "weather.fog";
export const WEATHER_SNOW: ContentId = "weather.snow";
export const WEATHER_WIND: ContentId = "weather.wind";

/** The multi-system effect vector for one weather state. Percent-style ints (ADR-0001). */
export interface WeatherEffect {
  /** Percent of emitted noise that carries (100 = normal; <100 quieter, >100 louder). */
  readonly noiseFactor: number;
  /** Percentage points added to the stealth-detection chance (negative = harder to spot). */
  readonly detectionDelta: number;
  /** Per-tick grid decay pressure. */
  readonly powerPressure: number;
  /** Per-tick road decay pressure. */
  readonly roadPressure: number;
  /** Extra movement cost (points), for the route layer. */
  readonly movementDelta: number;
}

/** Each weather's effect — the FR-SIM-05 multi-system coupling in one table. */
export const WEATHER_EFFECTS: { readonly [id: ContentId]: WeatherEffect } = {
  [WEATHER_CLEAR]: { noiseFactor: 100, detectionDelta: 0, powerPressure: 0, roadPressure: 0, movementDelta: 0 },
  [WEATHER_CLOUDY]: { noiseFactor: 100, detectionDelta: 0, powerPressure: 0, roadPressure: 0, movementDelta: 0 },
  [WEATHER_RAIN]: { noiseFactor: 70, detectionDelta: -10, powerPressure: 1, roadPressure: 0, movementDelta: 0 },
  [WEATHER_STORM]: { noiseFactor: 55, detectionDelta: -15, powerPressure: 3, roadPressure: 2, movementDelta: 1 },
  [WEATHER_FOG]: { noiseFactor: 100, detectionDelta: -20, powerPressure: 0, roadPressure: 0, movementDelta: 1 },
  [WEATHER_SNOW]: { noiseFactor: 90, detectionDelta: 5, powerPressure: 1, roadPressure: 1, movementDelta: 2 },
  [WEATHER_WIND]: { noiseFactor: 115, detectionDelta: 5, powerPressure: 0, roadPressure: 0, movementDelta: 0 },
};

/** Sticky, plausible successors for each weather (the state it may shift *to*). */
export const WEATHER_TRANSITIONS: { readonly [id: ContentId]: readonly ContentId[] } = {
  [WEATHER_CLEAR]: [WEATHER_CLOUDY, WEATHER_WIND],
  [WEATHER_CLOUDY]: [WEATHER_CLEAR, WEATHER_RAIN, WEATHER_FOG, WEATHER_SNOW],
  [WEATHER_RAIN]: [WEATHER_CLOUDY, WEATHER_STORM],
  [WEATHER_STORM]: [WEATHER_RAIN, WEATHER_CLOUDY],
  [WEATHER_FOG]: [WEATHER_CLOUDY, WEATHER_CLEAR],
  [WEATHER_SNOW]: [WEATHER_CLOUDY, WEATHER_CLEAR],
  [WEATHER_WIND]: [WEATHER_CLEAR, WEATHER_CLOUDY],
};

/** Chance to shift per in-game hour, and the per-tick cap — weather changes over hours, not turns. */
export const WEATHER_SHIFT_PER_HOUR = 0.02;
export const WEATHER_SHIFT_MAX = 0.5;

/** The effect vector for a weather id (falls back to clear for an unknown id). */
export function weatherEffect(id: ContentId): WeatherEffect {
  return WEATHER_EFFECTS[id] ?? WEATHER_EFFECTS[WEATHER_CLEAR]!;
}
/** Stealth-detection delta (percentage points) for a weather id — consumed by the T15 combat roll. */
export function weatherDetectionDelta(id: ContentId): number {
  return weatherEffect(id).detectionDelta;
}
/** Noise-carry factor (percent) for a weather id — for the noise model to consult. */
export function weatherNoiseFactor(id: ContentId): number {
  return weatherEffect(id).noiseFactor;
}

/**
 * The body of the `weather` world-sim layer (pipeline stage 8). Roll a sticky transition over the
 * weather set, then apply the (current) weather's power and road decay pressure. Infrastructure only
 * ever falls (GDD IV). Inert on a zero-hour tick. Deterministic; consumes only the `weather` stream.
 */
export function tickWeather(state: GameState, hours: number): GameState {
  const h = Math.max(0, Math.trunc(hours));
  if (h === 0) return state;

  const seed = state.meta.seed;
  let rng = state.rng;

  // 1. Sticky transition: mostly stays put; a roll under the (hours-scaled) shift chance moves it.
  let weather = state.world.weather;
  const roll = drawFloat(rng, seed, "weather");
  rng = roll.rng;
  if (roll.value < Math.min(WEATHER_SHIFT_MAX, h * WEATHER_SHIFT_PER_HOUR)) {
    const successors = WEATHER_TRANSITIONS[weather] ?? [WEATHER_CLEAR];
    const pick = drawPick(rng, seed, "weather", successors);
    rng = pick.rng;
    weather = pick.value;
  }

  // 2. Multi-system effects from the resulting weather.
  const eff = weatherEffect(weather);
  const powerGrid = Math.max(0, state.world.powerGrid - Math.trunc((eff.powerPressure * h) / 6));
  const world =
    weather === state.world.weather && powerGrid === state.world.powerGrid
      ? state.world
      : { ...state.world, weather, powerGrid };

  let regions = state.regions;
  const roadDrop = Math.trunc((eff.roadPressure * h) / 6);
  if (roadDrop > 0) {
    let changed = false;
    const next: Record<string, RegionState> = {};
    for (const [id, r] of Object.entries(state.regions)) {
      const roads = Math.max(0, r.roads - roadDrop);
      if (roads !== r.roads) {
        next[id] = { ...r, roads };
        changed = true;
      } else {
        next[id] = r;
      }
    }
    if (changed) regions = next;
  }

  if (world === state.world && regions === state.regions && rng === state.rng) return state;
  return { ...state, world, regions, rng };
}
