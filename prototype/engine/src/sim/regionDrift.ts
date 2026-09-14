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
 * the same anchor by a bounded ±10 — how a beat outlives the drift step that follows it.
 *
 * **Neglect (T79).** The third term on the same anchor, and the one that makes the map territory:
 * {@link neglectLift} adds a point of threat AND density per in-game day a region has gone without
 * the player standing in it, after a {@link NEGLECT_GRACE_DAYS}-day grace and up to
 * {@link NEGLECT_CAP}. The day ramp says *the city* gets worse; neglect says *the districts you walk
 * away from* get worse faster than the one you hold — which is what DESIGN §5 and GDD IV have said
 * since M1 and what the code did backwards (the design review measured Rivermouth 35 → 7 and
 * Downtown 70 → 11 over 400 absent turns; T78 removed the *negative* slope, and this makes the slope
 * depend on where the player actually is).
 *
 * Two details the brief did not have, both forced by T78 (PL-M5-31):
 *
 *   1. **The cap is a deviation, not a ceiling.** The brief asked for threat "capped at
 *      `baseline.threat + 20`". Against the T78 anchor that is a ceiling BELOW the floor: the day ramp
 *      alone puts every district at `baseline + 30` by day 31, so an absolute cap of `baseline + 20`
 *      would have *clamped the ramp back down* from day 22 — undoing the task before it — and would
 *      have pinned Downtown (authored 70) at 90 while the ramp had already earned 100. So the cap
 *      bounds THIS TERM's own contribution to the anchor, and the anchor's total lift is
 *      `ramp + neglect + bias` under the usual 0–100 clamp.
 *   2. **Neglect must lift the density point too, or it is inert.** Under the anchored model
 *      `equilibriumDensity` reads the *deviation* `threat − anchor.threat`, so a neglect term on the
 *      threat anchor alone raises the threat dial and leaves the density equilibrium exactly where it
 *      was — no extra bodies, T75 never sees it, and the consequence terminates in a number nobody
 *      acts on. Measured by rebuilding with the threat-only variant and re-running `measure/t79.ts`:
 *      the threat column is identical to the shipped one (day-40 city mean 84.67) while the day-40 body
 *      count is 284 against the pre-T79 tree's 283 — one body in forty days. It rides both points,
 *      exactly as the ramp does.
 *
 * Neglect is DERIVED, never stored: {@link regionNeglectDays} reads the `lastVisit` day the nodes
 * already remember (GDD VII — "nodes remember"), so there is no new save field, no migration rung and
 * nothing that can desync from where the player has actually been. The region the player is standing
 * in reads 0 days by definition — `lastVisit` is stamped on arrival and not refreshed while you stay,
 * so a player who camps for a week would otherwise be "neglecting" the ground under their feet.
 * A region no node of which was ever entered is neglected from the run's first day, not from the day
 * it is discovered: what is never held is never tended.
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
import { projectAlarm, PROJECT_ALARM_CAP } from "./project.js";

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

/**
 * Neglect (T79): how long a region may go untended before it starts to fester, how fast it festers,
 * and how far that can carry it. The grace is the brief's (`daysSinceLastVisit > 2`); the rate matches
 * the day ramp so an abandoned district climbs at exactly twice the pace of a held one — a slope the
 * player can read off two visits rather than a table.
 *
 * `NEGLECT_CAP` is the re-derivation PL-M5-31 asked for, and it bounds THIS TERM's lift on the anchor
 * rather than capping the dial (see the module header). Swept on the shipped city over 40 idle days
 * (`measure/t79.ts --cap`, seed t79-a — each row is a rebuild with that cap), reading the day-40 city:
 *
 *   | cap | mean threat | at the 100 clamp        | bodies |
 *   |-----|-------------|-------------------------|--------|
 *   |   0 |       79.67 | 1 (Mercy)               |    283 |
 *   |   5 |       82.17 | 1                       |    291 |
 *   |  10 |       84.67 | 1                       |    298 |
 *   |  15 |       87.17 | 2 (+ the Ironworks)     |    304 |
 *   |  20 |       88.83 | 2                       |    304 |
 *   |  30 |       92.17 | 2                       |    315 |
 *
 * 15 is where the Ironworks (authored 55, + the ramp's 30) is pinned at 100 by day 40 and stops being
 * a district with a character; 10 leaves the day-40 saturation exactly where the day ramp alone put it,
 * buys 15 bodies over the un-neglected city, and equals `DIRECTOR_BIAS_MAX` — so the two *local* terms
 * that lean an anchor carry the same authority and neither can drown the other. The term is worth a
 * point a day for ten days: a district is fully festered on day 13 of absence (grace 2 + cap 10), which
 * is inside the window a run actually spans. The city's overall climb stays the day ramp's to own, and
 * its LEVEL is still T59/T60's (PL-M5-32).
 */
export const NEGLECT_GRACE_DAYS = 2;
export const NEGLECT_PER_DAY = 1;
export const NEGLECT_CAP = 10;

/**
 * The points a region has festered for going untended for `daysSinceVisit` days: 0 through the grace,
 * then `NEGLECT_PER_DAY` per day, capped at `NEGLECT_CAP`. Total, in the {@link dayRamp} mould: a
 * negative gap (a hand-edited `lastVisit` in the future) and a NaN clock read as 0, `+Infinity` reads
 * as the cap — never NaN, which would poison the anchor and then every dial downstream.
 */
export function neglectLift(daysSinceVisit: number): number {
  if (daysSinceVisit === Number.POSITIVE_INFINITY) return NEGLECT_CAP;
  if (!Number.isFinite(daysSinceVisit)) return 0;
  const days = Math.trunc(daysSinceVisit) - NEGLECT_GRACE_DAYS;
  if (days <= 0) return 0;
  return Math.min(NEGLECT_CAP, days * NEGLECT_PER_DAY);
}

/** The day a run begins, and so the day a never-entered region is treated as last tended. */
const RUN_START_DAY = 1;

/**
 * Days since the player last stood in each region of `state.regions`, derived from the nodes' own
 * `lastVisit` memory. The region the player is in reads 0 (see the module header); a region with no
 * visited node reads from the run's first day. Pure; no scrubbing of the clock here — every result
 * flows through {@link neglectLift}, which is total.
 */
export function regionNeglectDays(state: GameState): Record<string, number> {
  const here = state.nodes[state.player.location]?.regionId;
  const lastVisit: Record<string, number> = {};
  for (const node of Object.values(state.nodes)) {
    if (node.lastVisit === null || !Number.isFinite(node.lastVisit)) continue;
    const day = Math.trunc(node.lastVisit);
    const seen = lastVisit[node.regionId];
    if (seen === undefined || day > seen) lastVisit[node.regionId] = day;
  }
  const out: Record<string, number> = {};
  for (const id of Object.keys(state.regions)) {
    out[id] = id === here ? 0 : state.meta.day - (lastVisit[id] ?? RUN_START_DAY);
  }
  return out;
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
 * `bias` for that region (T78; a clamped whole number in ±`DIRECTOR_BIAS_MAX`, default 0), raised
 * by `neglect` points of festering (T79; 0–`NEGLECT_CAP`, default 0 — an anchor asked for without one
 * is the anchor of a region tended today) and by `alarm`, the noise the run's own terminal project has
 * made (T87; 0–`PROJECT_ALARM_CAP`, default 0). Mirrors
 * `seedRegionState`'s fallbacks (an unspecified dial anchors at 0, exactly where the seed put it).
 * Pure and total: every term is scrubbed, so the anchor is always three whole 0–100 numbers.
 */
export function driftAnchor(baseline: RegionDef["baseline"], day: number, bias = 0, neglect = 0, alarm = 0): DriftAnchor {
  const b = baseline ?? {};
  // The neglect term is bounded HERE as well as at its source, so no caller can smuggle an unbounded
  // lift onto the anchor through this argument (the ramp and the bias are bounded the same way).
  const fester = Number.isFinite(neglect) ? Math.max(0, Math.min(NEGLECT_CAP, Math.trunc(neglect))) : 0;
  // T87: the standing half of "every completed stage raises something". Bounded HERE as well as at its
  // source for the same reason the other two terms are — no caller can smuggle an unbounded lift onto
  // the anchor through this argument. An anchor asked for without one (every pre-T87 caller, and every
  // run that has finished no stage) supplies 0 and is byte-identical to T79's.
  const alarmed = Number.isFinite(alarm) ? Math.max(0, Math.min(PROJECT_ALARM_CAP, Math.trunc(alarm))) : 0;
  const lift = dayRamp(day) + fester + alarmed + (Number.isFinite(bias) ? Math.trunc(bias) : 0);
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
 * measured from its authored anchor when the graph is present — an anchor now also raised by how long
 * the player has left that region alone (T79). Neglect is derived once per tick for the whole map, so
 * the per-region cost is a lookup and the draw order is untouched. Draws one jitter per region in stable
 * key order so a seed reproduces the whole map. Returns the same state reference on a zero-hour tick,
 * keeping the empty-turn contract. Pure.
 */
export function driftRegions(state: GameState, hours: number, graph?: RegionGraph): GameState {
  const h = Math.max(0, Math.trunc(hours));
  if (h === 0) return state;

  let rng = state.rng;
  let changed = false;
  const neglect = regionNeglectDays(state);
  // T87: derived once per tick for the whole map, like neglect — it is a property of the RUN, not of a
  // region, so every region's anchor gets the same lift and the per-region cost is nothing. Read off
  // `story.endingFlags`, so it is correct on a state ticked without a graph.
  const alarm = projectAlarm(state);
  const regions: Record<string, RegionState> = {};
  for (const [id, region] of Object.entries(state.regions)) {
    const draw = drawInt(rng, state.meta.seed, "region", -DRIFT_JITTER, DRIFT_JITTER);
    rng = draw.rng;
    const def = graph?.regions[id];
    const next = driftRegion(
      region,
      h,
      draw.value,
      def === undefined
        ? undefined
        : driftAnchor(def.baseline, state.meta.day, directorBias(region), neglectLift(neglect[id] ?? 0), alarm),
    );
    if (next !== region) changed = true;
    regions[id] = next;
  }
  if (!changed && rng === state.rng) return state;
  return { ...state, regions, rng };
}
