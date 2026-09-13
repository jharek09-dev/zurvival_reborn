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
 * **The anchor (T78).** Until T78 the two targets were absolute — `20 + threat·3/5 − activity·2/5`
 * and `density/2 + fire/2` — a fixed point that ignored the authored `RegionDef.baseline` entirely.
 * Measured on the shipped city over 30 idle days (`harness/measure/t78.ts`, seeds t78-a/b): every
 * district converged to threat 0–11 / density 0–22 whatever it was authored at — Downtown's 70/80
 * "richest and most dangerous ground in the city" read 10/20 by day 14, the authored threat spread of
 * 50 points was 9–11, and the difficulty modes were one body apart (217/217/218/218). So the targets
 * are now **deviations from the region's authored point**: the same coupling (threat breeds density
 * at 3/5, activity culls at 2/5, threat tracks density at 1/2) measured from the baseline instead of
 * from zero, which makes the authored dials the drift's fixed point (linearised loop gain 3/5 · 1/2
 * = 0.3 < 1, so it converges there and the jitter keeps it alive around it). Regional identity
 * survives contact with the simulation through day 14 (spread 49–51); by day 30 the ramp has pushed
 * Downtown and Mercy against the 100 clamp and the spread is 40–41 — the clamp, not the drift, is
 * what erodes it, and the ramp's LEVEL is T59/T60's (below).
 *
 * **What the anchor does NOT fix, measured.** The difficulty spread at day 30 is now ZERO bodies
 * (284/284/284/284, mean density 83.5 in all four modes; before: 217/217/218/218). The modes reach
 * the population only through the director's scaled escalate step, which the anchored, tide-lifted
 * pressure no longer triggers after day 1 (see `sim/director.ts`); repopulation still has no dial —
 * PL-M5-11 stays open, and now has a density worth biting on. Riot/Bloated stay dormant
 * (PL-M5-12: 4/6 → 4/8 and 4/6 → 5/6 over 30 days) even with Downtown and Mercy at density 100,
 * because both sit at carrying capacity from the seed and repopulation HOLDS there — the ≥70 gate
 * is now met and the INPUT is no longer the problem; the capacity is.
 *
 * **The day ramp (T78).** The anchor is not static: {@link dayRamp} raises a district's threat and
 * density point by `DAY_RAMP_PER_DAY` per in-game day up to `DAY_RAMP_CAP`, so week three is not
 * week one anywhere on the map. It lives HERE, on the anchor, and not as a floor inside the director's
 * `pressureRead`, for one reason: a floor on a *read* changes telemetry and beats and nothing else,
 * while a ramp on the anchor becomes density, which T75 turns into bodies — the review's whole point
 * was that consequences must not terminate in a number nobody acts on. The director's read sees the
 * ramp through `region.threat` for free. The director's `directorBias` (see `sim/director.ts`) leans
 * the same anchor by a bounded ±10 — how a beat outlives the drift step that follows it. T79's
 * neglect term is meant to stack on the same anchor, clamped — and its brief's cap of
 * `baseline.threat + 20` predates a ramp that alone adds 30, so T79 must re-derive its cap against
 * this anchor rather than the authored point (PL-M5-31).
 *
 * A region the transient graph does not know (no baseline; a fixture, or an off-screen advance without
 * the graph) keeps the pre-T78 absolute targets — the neutral substrate, explicitly, not a silent zero.
 *
 * A tiny per-region jitter from the named `region` RNG stream keeps two regions from moving in
 * lockstep and keeps the world visibly alive near equilibrium, while staying fully reproducible.
 * Drift is bound by construction: it can only ever move a value *toward* a clamped 0–100 target, so
 * it can never manufacture an impossible state — the invariant the T30 director leans on.
 *
 * Pure, deterministic, integer-only (ADR-0001). Loot is untouched here; the T17 contest owns it.
 */

import type { GameState, RegionState } from "../state/types.js";
import type { RegionDef, RegionGraph } from "../map/types.js";
import { drawInt } from "../rng/streams.js";
import { relax } from "./clocks.js";
import { directorBias } from "./director.js";

/** Clamp to a 0–100 integer — the discipline every sim quantity keeps. */
const clampPct = (n: number): number => Math.max(0, Math.min(100, Math.trunc(n)));

/** Density moves ~1 point per this many hours toward equilibrium; threat is a touch slower. */
export const DENSITY_HOURS_PER_STEP = 3;
export const THREAT_HOURS_PER_STEP = 4;
/** Per-tick jitter (points) applied to the density equilibrium so regions never lockstep. */
export const DRIFT_JITTER = 2;

/**
 * The day ramp (T78): every district's anchor climbs this many points of threat AND density per
 * in-game day after the first, up to `DAY_RAMP_CAP`. At 1/day and a 30-point cap, week two adds 13, a
 * month adds 30, and the measured dial lags the anchor by a day or two.
 *
 * **The radio consequence, measured (40 idle days, `signalStatus` per day).** `sim/radio.ts` silences
 * a civilian/ham signal at `REGION_SILENT_AT` 60 and walks a military one live→failing→dead across
 * `MILITARY_FAILING_AT` 45 and `REGION_FALL_AT` 65; `effectiveStatus` latches dead. Under the ramp the
 * Ironworks ham operator goes silent on day 7–8, Hillcrest's evac-stadium military signal fails on
 * day 7 and dies on day 27, the Rivermouth plea dies on day 27, and the EAS's own lifespan (content, not
 * the ramp) ends on day 13 —
 * so by day 27 every region-bound signal is dead air and only the numbers station and the anomaly
 * remain. That is the "war being lost on the radio" PL-M4-26 asked to be REACHABLE, and it is now
 * reachable on a schedule: whether day 27 is the right day is T59/T60's (PL-M5-32). The LEVEL is
 * theirs to tune; the SLOPE is this task's deliverable.
 */
export const DAY_RAMP_PER_DAY = 1;
export const DAY_RAMP_CAP = 30;

/**
 * Points the city has festered by `day` (1-based): 0 on day 1, `DAY_RAMP_PER_DAY` per day after, capped.
 * Total: a day that is not a finite number (a hand-edited save; `1e999` parses to Infinity) ramps as
 * far as the cap allows when it is +Infinity and not at all otherwise — never NaN, which would have
 * poisoned both anchors and then every region dial (the T77 `scentDraw` class of fault).
 */
export function dayRamp(day: number): number {
  if (day === Number.POSITIVE_INFINITY) return DAY_RAMP_CAP;
  if (!Number.isFinite(day)) return 0;
  const d = Math.max(0, Math.trunc(day) - 1);
  return Math.min(DAY_RAMP_CAP, d * DAY_RAMP_PER_DAY);
}

/** A baseline dial as a whole 0–100 number; anything that is not a finite number reads as 0 (where the seed put it). */
const dial = (n: number | undefined): number => (Number.isFinite(n) ? clampPct(n as number) : 0);

/** The authored point a region's drift measures from — its baseline, lifted by the day ramp. */
export interface DriftAnchor {
  readonly threat: number;
  readonly zombieDensity: number;
  readonly survivorActivity: number;
}

/**
 * Build a region's drift anchor from its content baseline at a given day, leaned by the director's
 * `bias` for that region (T78; a clamped whole number in ±`DIRECTOR_BIAS_MAX`, default 0). Mirrors
 * `seedRegionState`'s fallbacks (an unspecified dial anchors at 0, exactly where the seed put it).
 * Pure and total: every term is scrubbed, so the anchor is always three whole 0–100 numbers.
 */
export function driftAnchor(baseline: RegionDef["baseline"], day: number, bias = 0): DriftAnchor {
  const b = baseline ?? {};
  const lift = dayRamp(day) + (Number.isFinite(bias) ? Math.trunc(bias) : 0);
  return {
    threat: clampPct(dial(b.threat) + lift),
    zombieDensity: clampPct(dial(b.zombieDensity) + lift),
    survivorActivity: dial(b.survivorActivity),
  };
}

/**
 * The zombie density a region trends toward, given its condition: `threat` above the anchor breeds the
 * dead (3/5), `survivorActivity` above it culls them (2/5). With no anchor, the pre-T78 absolute form:
 * a floor of 20 ambient dead, raised by threat and lowered by activity. Clamped 0–100.
 */
export function equilibriumDensity(region: RegionState, anchor?: DriftAnchor): number {
  if (anchor === undefined) {
    return clampPct(20 + Math.trunc((region.threat * 3) / 5) - Math.trunc((region.survivorActivity * 2) / 5));
  }
  return clampPct(
    anchor.zombieDensity +
      Math.trunc(((region.threat - anchor.threat) * 3) / 5) -
      Math.trunc(((region.survivorActivity - anchor.survivorActivity) * 2) / 5),
  );
}

/**
 * The threat level a region trends toward: the anchor, moved by how far density sits from ITS anchor
 * (1/2) and by any active fire — so threat is a *consequence* of the world's state, never a
 * free-floating dial. With no anchor, the pre-T78 absolute `density/2 + fire/2`. Clamped 0–100.
 */
export function threatTarget(region: RegionState, anchor?: DriftAnchor): number {
  if (anchor === undefined) {
    return clampPct(Math.trunc(region.zombieDensity / 2) + Math.trunc(region.fire / 2));
  }
  return clampPct(anchor.threat + Math.trunc((region.zombieDensity - anchor.zombieDensity) / 2) + Math.trunc(region.fire / 2));
}

/**
 * Drift one region by `hours`, given a jitter draw for its density equilibrium and (for a region the
 * graph knows) its anchor. Density relaxes first (it feeds threat), then threat relaxes toward the new
 * density. Returns the same reference when nothing moved. Pure.
 */
export function driftRegion(region: RegionState, hours: number, jitter: number, anchor?: DriftAnchor): RegionState {
  const h = Math.max(0, Math.trunc(hours));
  if (h === 0) return region;

  // Each dial banks its own remainder hours (T74): before, `trunc(h / 3)` on a 2-hour turn was 0 steps
  // and the `Math.max(1, ...)` inside the old stepToward then moved it a full point anyway — so both
  // periods were dead knobs and every region crept at exactly 1 point per turn. Now the period governs.
  const densTarget = clampPct(equilibriumDensity(region, anchor) + jitter);
  const dens = relax(region.zombieDensity, densTarget, region.densityHours, h, DENSITY_HOURS_PER_STEP);
  const withDensity =
    dens.value === region.zombieDensity && dens.rest === (region.densityHours ?? 0)
      ? region
      : { ...region, zombieDensity: dens.value, densityHours: dens.rest };

  const thr = relax(withDensity.threat, threatTarget(withDensity, anchor), withDensity.threatHours, h, THREAT_HOURS_PER_STEP);
  if (thr.value === withDensity.threat && thr.rest === (withDensity.threatHours ?? 0)) return withDensity;
  return { ...withDensity, threat: thr.value, threatHours: thr.rest };
}

/**
 * The drift half of the `regions` layer: every region's threat and density relax toward their
 * coupled targets as the tick's hours pass, each nudged by its own `region`-stream jitter and (T78)
 * measured from its authored anchor when the graph is present. Draws one jitter per region in stable
 * key order so a seed reproduces the whole map. Returns the same state reference on a zero-hour tick,
 * keeping the empty-turn contract. Pure.
 */
export function driftRegions(state: GameState, hours: number, graph?: RegionGraph): GameState {
  const h = Math.max(0, Math.trunc(hours));
  if (h === 0) return state;

  let rng = state.rng;
  let changed = false;
  const regions: Record<string, RegionState> = {};
  for (const [id, region] of Object.entries(state.regions)) {
    const draw = drawInt(rng, state.meta.seed, "region", -DRIFT_JITTER, DRIFT_JITTER);
    rng = draw.rng;
    const def = graph?.regions[id];
    const next = driftRegion(region, h, draw.value, def === undefined ? undefined : driftAnchor(def.baseline, state.meta.day, directorBias(region)));
    if (next !== region) changed = true;
    regions[id] = next;
  }
  if (!changed && rng === state.rng) return state;
  return { ...state, regions, rng };
}
