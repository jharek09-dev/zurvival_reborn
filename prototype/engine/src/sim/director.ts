/**
 * The Apocalypse Director — pacing bias without impossible states (M2 task T30 · FR-SIM-10 · GDD IV).
 *
 * The director is the sixth and last world-sim layer to come alive. It is **not an author** — it never
 * writes fiction, spawns a horde, or forces an encounter. It is a **bounded bang-bang controller** on
 * the danger dials T24 laid down: each tick it reads a pressure signal and the player's distress, then
 * nudges the player's current region by **one clamped point**:
 *
 *   - pressure **below** the low band and the player *not* distressed → **escalate** (raise the
 *     region's zombie density + threat). This is the deliberate answer to the Part-1 finding that an
 *     unwatched region *de-escalates* (PL-M2-03): while you coast, the world festers. T24's relaxation
 *     stays the neutral substrate; the director is the directed bias on top of it.
 *   - pressure **above** the high band, or the player distressed (in a fight, bleeding, starving,
 *     feverish) → **relief** (ease the region's density). The apocalypse gives you room to breathe
 *     when it already has you on the ropes — the other half of *pacing*.
 *   - between the bands → **hold**.
 *
 * Two invariants make this safe. First, **legality**: every nudge is a clamped ±1 toward a value in
 * 0–100, so the director *cannot* manufacture an impossible state — the property T24's design promised
 * it would lean on. Second, **spacing**: escalation raises pressure out of the low band, which stops
 * the escalation, so pressure and relief are self-spaced rather than monotonic. Disable it with
 * `world.flags["director.disabled"]` and the nudges stop while the world still runs on the drift
 * substrate — the DoD's "disabling changes pacing metrics but never produces an impossible state."
 *
 * Pure, deterministic, integer-only (ADR-0001): no RNG, no clock. Off-screen `advanceWorld` runs it
 * too, so an abandoned district festers whether or not the player is watching.
 */

import type { GameState, RegionState } from "../state/types.js";
import { isSymptomatic } from "./infection.js";

// --- bands & steps (tunable) ----------------------------------------------------------------

/** Pressure below this (and no distress) ⇒ escalate; above the high band (or distress) ⇒ relief. */
export const DIRECTOR_LOW_BAND = 25;
export const DIRECTOR_HIGH_BAND = 70;
/** The clamped per-tick nudge the director applies to a region danger dial. */
export const DIRECTOR_STEP = 1;
/** A need at/above this reads as distress (the player is already under real pressure). */
export const DIRECTOR_NEED_DISTRESS = 70;

const clampPct = (n: number): number => Math.max(0, Math.min(100, Math.trunc(n)));

/** Whether the director is active (default on; `world.flags["director.disabled"]` turns it off). */
export function directorEnabled(state: GameState): boolean {
  return state.world.flags["director.disabled"] !== true;
}

/**
 * Is the player already under real pressure? In a fight, carrying an untreated wound, a critical need,
 * or a showing infection. When true the director eases off rather than piling on.
 */
export function playerDistressed(state: GameState): boolean {
  if (state.combat !== null) return true;
  const c = state.player.condition;
  if (c.wounds.some((w) => w.treated < 100)) return true;
  if (c.needs.hunger >= DIRECTOR_NEED_DISTRESS || c.needs.thirst >= DIRECTOR_NEED_DISTRESS || c.needs.fatigue >= DIRECTOR_NEED_DISTRESS) return true;
  // Any *showing* infection — symptomatic, advanced, or terminal (T49 added `advanced`; using the
  // module predicate keeps the distress curve monotonic, never dipping at the middle stage).
  if (isSymptomatic(state)) return true;
  return false;
}

/**
 * The pressure the director reads: the city-wide tide (T28 `globalThreat`) blended with the player's
 * current region threat, so it responds to both the global clock and the local situation. 0–100.
 */
export function pressureRead(state: GameState): number {
  const here = state.nodes[state.player.location];
  const regionThreat = here !== undefined ? state.regions[here.regionId]?.threat ?? 0 : 0;
  return clampPct(Math.trunc((state.world.globalThreat + regionThreat) / 2));
}

/** The pacing beat the director takes this tick, from pressure + distress. */
export type DirectorBeat = "escalate" | "relief" | "hold";
export function directorBeat(state: GameState): DirectorBeat {
  if (!directorEnabled(state)) return "hold";
  if (playerDistressed(state) || pressureRead(state) >= DIRECTOR_HIGH_BAND) return "relief";
  if (pressureRead(state) < DIRECTOR_LOW_BAND) return "escalate";
  return "hold";
}

/** Apply a beat's ±1 nudge to a region's danger dials, clamped 0–100. */
function nudge(region: RegionState, beat: DirectorBeat): RegionState {
  if (beat === "escalate") {
    const zombieDensity = clampPct(region.zombieDensity + DIRECTOR_STEP);
    const threat = clampPct(region.threat + DIRECTOR_STEP);
    if (zombieDensity === region.zombieDensity && threat === region.threat) return region;
    return { ...region, zombieDensity, threat };
  }
  if (beat === "relief") {
    const zombieDensity = clampPct(region.zombieDensity - DIRECTOR_STEP);
    if (zombieDensity === region.zombieDensity) return region;
    return { ...region, zombieDensity };
  }
  return region;
}

/**
 * The body of the `director` world-sim layer (pipeline stage 11). Reads the beat, then applies its
 * clamped ±1 nudge to the player's **current** region only — the district the run is actually in.
 * Inert on a zero-hour tick, when disabled, on a hold beat, or when the nudge would leave a dial
 * unchanged (already at a bound). Touches only `regions`. Pure and deterministic.
 */
export function tickDirector(state: GameState, hours: number): GameState {
  const h = Math.max(0, Math.trunc(hours));
  if (h === 0 || !directorEnabled(state)) return state;
  const here = state.nodes[state.player.location];
  if (here === undefined) return state;
  const regionId = here.regionId;
  const region = state.regions[regionId];
  if (region === undefined) return state;

  const beat = directorBeat(state);
  if (beat === "hold") return state;
  const next = nudge(region, beat);
  if (next === region) return state;
  return { ...state, regions: { ...state.regions, [regionId]: next } };
}
