/**
 * Off-screen regional drift — regions evolve whether or not the player is there (M2 task T24 ·
 * FR-SIM-03 · GDD IV/VII). In M1 a region only changed when the player searched in it (the T17 loot
 * contest); its threat and zombie density sat frozen. T24 makes the two headline dials move on the
 * region's *own* clock: leave Downtown to fester and it gets worse; abandon a quiet block and it
 * settles. This is the first system to ride the T23 world-sim substrate — the `regions` layer runs
 * this drift, then the existing contest, every tick.
 *
 * The model is a coupled relaxation toward carrying capacity, integer-only and clamped 0–100:
 *
 *   - **Zombie density** relaxes toward an equilibrium set by the region's own condition — `threat`
 *     breeds the dead, `survivorActivity` culls them — so an untouched region trends to its natural
 *     level rather than holding its seed value forever.
 *   - **Threat** tracks that density and any active `fire`, and bleeds off as the horde disperses, so
 *     a spike decays over days and never resolves in a single turn.
 *
 * A tiny per-region jitter from the named `region` RNG stream keeps two regions from moving in
 * lockstep and keeps the world visibly alive near equilibrium, while staying fully reproducible.
 * Drift is bound by construction: it can only ever move a value *toward* a clamped 0–100 target, so
 * it can never manufacture an impossible state — the invariant the T30 director will lean on.
 *
 * Pure, deterministic, integer-only (ADR-0001). Loot is untouched here; the T17 contest owns it.
 */

import type { GameState, RegionState } from "../state/types.js";
import { drawInt } from "../rng/streams.js";

/** Clamp to a 0–100 integer — the discipline every sim quantity keeps. */
const clampPct = (n: number): number => Math.max(0, Math.min(100, Math.trunc(n)));

/** Density moves ~1 point per this many hours toward equilibrium; threat is a touch slower. */
export const DENSITY_HOURS_PER_STEP = 3;
export const THREAT_HOURS_PER_STEP = 4;
/** Per-tick jitter (points) applied to the density equilibrium so regions never lockstep. */
export const DRIFT_JITTER = 2;

/**
 * The zombie density a region trends toward, given its condition: a floor of ambient dead, raised by
 * `threat` (breeding) and lowered by `survivorActivity` (culling). Clamped 0–100.
 */
export function equilibriumDensity(region: RegionState): number {
  return clampPct(20 + Math.trunc((region.threat * 3) / 5) - Math.trunc((region.survivorActivity * 2) / 5));
}

/**
 * The threat level a region trends toward: driven by its current zombie density and any active fire,
 * so threat is a *consequence* of the world's state, never a free-floating dial. Clamped 0–100.
 */
export function threatTarget(region: RegionState): number {
  return clampPct(Math.trunc(region.zombieDensity / 2) + Math.trunc(region.fire / 2));
}

/** Move `current` toward `target` by at most `maxStep`, but always at least one point when there is a gap. */
function stepToward(current: number, target: number, maxStep: number): number {
  const gap = target - current;
  if (gap === 0) return current;
  const mag = Math.min(Math.abs(gap), Math.max(1, maxStep));
  return current + Math.sign(gap) * mag;
}

/**
 * Drift one region by `hours`, given a jitter draw for its density equilibrium. Density relaxes first
 * (it feeds threat), then threat relaxes toward the new density. Returns the same reference when
 * nothing moved. Pure.
 */
export function driftRegion(region: RegionState, hours: number, jitter: number): RegionState {
  const h = Math.max(0, Math.trunc(hours));
  if (h === 0) return region;

  const densTarget = clampPct(equilibriumDensity(region) + jitter);
  const zombieDensity = stepToward(region.zombieDensity, densTarget, Math.trunc(h / DENSITY_HOURS_PER_STEP));
  const withDensity = zombieDensity === region.zombieDensity ? region : { ...region, zombieDensity };

  const threat = stepToward(withDensity.threat, threatTarget(withDensity), Math.trunc(h / THREAT_HOURS_PER_STEP));
  if (threat === withDensity.threat) return withDensity;
  return { ...withDensity, threat };
}

/**
 * The drift half of the `regions` layer: every region's threat and density relax toward their
 * coupled targets as the tick's hours pass, each nudged by its own `region`-stream jitter. Draws one
 * jitter per region in stable key order so a seed reproduces the whole map. Returns the same state
 * reference on a zero-hour tick, keeping the empty-turn contract. Pure.
 */
export function driftRegions(state: GameState, hours: number): GameState {
  const h = Math.max(0, Math.trunc(hours));
  if (h === 0) return state;

  let rng = state.rng;
  let changed = false;
  const regions: Record<string, RegionState> = {};
  for (const [id, region] of Object.entries(state.regions)) {
    const draw = drawInt(rng, state.meta.seed, "region", -DRIFT_JITTER, DRIFT_JITTER);
    rng = draw.rng;
    const next = driftRegion(region, h, draw.value);
    if (next !== region) changed = true;
    regions[id] = next;
  }
  if (!changed && rng === state.rng) return state;
  return { ...state, regions, rng };
}
