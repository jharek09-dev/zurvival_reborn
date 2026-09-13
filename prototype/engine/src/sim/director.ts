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
 *   - pressure **above** the high band, or the player distressed (in a fight, freshly or heavily
 *     wounded, starving, feverish) → **relief** (ease the region's density). The apocalypse gives you
 *     room to breathe when it already has you on the ropes — the other half of *pacing*.
 *   - between the bands → **hold**.
 *
 * Two invariants make this safe. First, **legality**: every nudge is a clamped ±1 toward a value in
 * 0–100, so the director *cannot* manufacture an impossible state — the property T24's design promised
 * it would lean on. Second, **spacing**: escalation raises pressure out of the low band, which stops
 * the escalation, so pressure and relief are self-spaced rather than monotonic. Disable it with
 * `world.flags["director.disabled"]` and the nudges stop while the world still runs on the drift
 * substrate — the DoD's "disabling changes pacing metrics but never produces an impossible state."
 *
 * **What T78 corrected, measured (`harness/measure/t78.ts --director`).** Before it, `playerDistressed`
 * was true for ANY wound with `treated < 100`, and wounds never close with time — so after the first
 * fight the director sat in `relief` on **100% of the remaining turns** of every measured run (86% of
 * all turns under a fighting policy, 70% under a careful one) and pushed density down a point a turn:
 * the comeback rope was the only beat it ever played, and the game got easier the worse you were doing.
 * Now the wound clause is a real burden threshold ({@link DIRECTOR_WOUND_DISTRESS} — one untreated
 * bite) or a wound opened within the last {@link DIRECTOR_FRESH_WOUND_HOURS}; a laceration you have
 * dressed down to a scab is not a crisis. And relief is **rationed**: at most
 * {@link DIRECTOR_RELIEF_PER_DAY} beats per in-game day, so relief can dent a district's density but
 * never slide it. The rationing is read by {@link directorBeat} itself, so a capped-out tick reports
 * `hold`, never a relief that did not happen.
 *
 * **Which of the two did the measured work: the RATION.** The bots in the runner carry a wound burden
 * of 128–268 (wounds never close and dressings are scarce), so the weight clause never releases them
 * and the shock clause fires on 3–5% of turns (2.8 / 5.0); distressed turns moved only 86%→85% (fight) and
 * 70%→64% (careful). Relief fell 86%→25% and 70%→29% of turns through the ration alone. The
 * narrowing is what stops a *dressed* player from being relieved forever — a case the crude bots
 * cannot reach — and is proved at the unit level, not on the census. Mean end day did not move
 * (3.75→3.63 / 3.88→3.63; thirst and infection still end every run): this pass changes what the
 * world does, not yet how long a run lasts.
 *
 * The other half of the correction lives in `sim/regionDrift.ts`: the drift targets now measure from
 * the region's authored baseline (lifted by a day ramp) instead of from zero, so `pressureRead` is no
 * longer pinned at 21–23 below the low band with `escalate` as the only output (calm turns 80%→11%).
 * Measured limit, stated plainly: on the shipped city **every escalate beat is a day-1 beat** — the
 * low band is reached only while `globalThreat` climbs from 0 on the first day (24 of 24 escalates
 * under both policies, 4 of 4 in the idle probe, none after day 1 in 889 measured turns). After day
 * 1 the director is a relief/hold device, and for an UNDISTRESSED player it is idle: the on/off idle
 * probe is identical (home density 63/63 either way). Whether a district pacified 15+ points below
 * its anchor would re-open the escalate beat is unmeasured; `DIRECTOR_LOW_BAND` against anchored
 * pressure is T60's to retune (PL-M5-33).
 *
 * **The bias (T78, found by measuring the first cut).** With the drift anchored, a ±1 nudge on the
 * dial itself is undone by the next drift step — the substrate pulled every beat straight back to the
 * authored point, and `measure/t78.ts --onoff` could not tell a run with the director ON from one with
 * it OFF (first cut, dial nudge only — a tree that no longer exists, so these two figures are not
 * re-derivable: mean pressure 35.44 vs 35.47, end density 61.1 vs 62.6). On the shipped tree the
 * same probe reads ON 34.02 / 55.9 vs OFF 35.47 / 62.6 under a fighting policy (mean lean −4.1) — the
 * T30 DoD holds again, *under distress*; see the idle limit above. A pacing controller whose removal
 * changes nothing is dead wiring, the class of fault this whole pass exists to remove. So a beat now
 * also moves the region's **`directorBias`** — a bounded (±{@link DIRECTOR_BIAS_MAX}) integer offset
 * on that region's drift anchor, which is what this header has always described: "T24's relaxation
 * stays the neutral substrate; the director is the directed bias on top of it." The dial nudge is
 * kept (the beat is felt this turn); the bias is what makes it last. It decays one point toward zero
 * per {@link DIRECTOR_BIAS_DECAY_HOURS} in every region (banked, T74 idle-HOLD rule at zero), so a
 * rough week leaves no permanent scar and a coasted week no permanent fester — T79 owns neglect.
 *
 * Pure, deterministic, integer-only (ADR-0001): no RNG, no clock. Off-screen `advanceWorld` runs it
 * too, so an abandoned district festers whether or not the player is watching. One beat per TICK,
 * whatever the tick's hours (an 8-hour sleep is one beat; four 2-hour turns are four) — the T74 pass
 * left this as a per-turn rate on purpose, and the daily relief ration is what bounds it.
 */

import type { GameState, RegionState, Wound } from "../state/types.js";
import { isSymptomatic } from "./infection.js";
import { profileOf, scaleInt } from "./difficulty.js";
import { woundBurden, woundRemainder } from "./wounds.js";
import { bankHours, stepToward, wholeHours } from "./clocks.js";

// --- bands & steps (tunable) ----------------------------------------------------------------

/** Pressure below this (and no distress) ⇒ escalate; above the high band (or distress) ⇒ relief. */
export const DIRECTOR_LOW_BAND = 25;
export const DIRECTOR_HIGH_BAND = 70;
/** The clamped per-tick nudge the director applies to a region danger dial. */
export const DIRECTOR_STEP = 1;
/** A need at/above this reads as distress (the player is already under real pressure). */
export const DIRECTOR_NEED_DISTRESS = 70;
/**
 * Untreated wound burden (`woundBurden`, summed severity minus treatment) at/above which the body reads
 * as distress. 40 is one untreated bite (`wound.bite` severity 40, the T77 `SCENT_FULL_AT`): a fresh
 * bite IS a crisis; a dressed laceration at remainder 10 is not (T78).
 */
export const DIRECTOR_WOUND_DISTRESS = 40;
/** An open wound younger than this many in-game hours reads as distress whatever its size — the shock of it (T78). */
export const DIRECTOR_FRESH_WOUND_HOURS = 6;
/** The daily ration of relief beats: at most this many `relief` nudges per in-game day (T78). */
export const DIRECTOR_RELIEF_PER_DAY = 4;
/**
 * The bound on a region's `directorBias` — how far, in points of threat AND density, the director may
 * hold a district's drift anchor above or below its authored point (T78). At 10 a fully rationed
 * relief run (4 beats/day) reaches the floor in three days; the day ramp (+1/day) matches the decay
 * (1/day) point for point, so the offset is a lean on the curve, never a second curve.
 */
export const DIRECTOR_BIAS_MAX = 10;
/** A region's bias decays one point toward zero per this many in-game hours, banked (T78). */
export const DIRECTOR_BIAS_DECAY_HOURS = 24;

const clampPct = (n: number): number => Math.max(0, Math.min(100, Math.trunc(n)));

/** Whether the director is active (default on; `world.flags["director.disabled"]` turns it off). */
export function directorEnabled(state: GameState): boolean {
  return state.world.flags["director.disabled"] !== true;
}

/**
 * How many in-game hours ago a wound was opened, given the clock now. A wound stamped only by day (a
 * pre-T78 save, or a fixture) counts from 00:00 of that day, so it can only OVER-estimate its age —
 * a legacy wound is never mistaken for a fresh one. Never negative.
 */
export function woundAgeHours(wound: Wound, day: number, hour: number): number {
  // Total (the T77 `scentDraw` lesson): a hand-edited stamp that is not a finite number — `1e999` off a
  // save parses to Infinity — reads as "opened at the start of time", i.e. OLD, never as fresh. An hour
  // outside 0–23 is clamped into the day it claims. A CLOCK that is not finite (`meta.day` / `meta.hour`
  // off the same kind of save; `loadGame` does not validate them) also reads every wound as old — the
  // shock clause must fail CLOSED, never fire forever.
  if (!Number.isFinite(day) || !Number.isFinite(hour)) return Number.MAX_SAFE_INTEGER;
  const stampDay = Number.isFinite(wound.inflictedDay) ? Math.trunc(wound.inflictedDay) : 1;
  const stampHour = Number.isFinite(wound.inflictedHour) ? Math.max(0, Math.min(23, Math.trunc(wound.inflictedHour as number))) : 0;
  const opened = (stampDay - 1) * 24 + stampHour;
  const now = (Math.trunc(day) - 1) * 24 + Math.trunc(hour);
  return Math.max(0, now - opened);
}

/**
 * Is the player already under real pressure? In a fight, carrying a heavy or fresh open wound, a
 * critical need, or a showing infection. When true the director eases off rather than piling on.
 */
export function playerDistressed(state: GameState): boolean {
  if (state.combat !== null) return true;
  const c = state.player.condition;
  // T78: a wound is distress by WEIGHT (one untreated bite's worth of open burden) or by SHOCK (opened
  // in the last few hours) — not by the mere existence of a scab. The old `treated < 100` clause, with
  // wounds that never close on their own, was true for the rest of every run after the first fight.
  if (woundBurden(c) >= DIRECTOR_WOUND_DISTRESS) return true;
  if (c.wounds.some((w) => woundRemainder(w) > 0 && woundAgeHours(w, state.meta.day, state.meta.hour) < DIRECTOR_FRESH_WOUND_HOURS)) return true;
  if (c.needs.hunger >= DIRECTOR_NEED_DISTRESS || c.needs.thirst >= DIRECTOR_NEED_DISTRESS || c.needs.fatigue >= DIRECTOR_NEED_DISTRESS) return true;
  // Any *showing* infection — symptomatic, advanced, or terminal (T49 added `advanced`; using the
  // module predicate keeps the distress curve monotonic, never dipping at the middle stage).
  if (isSymptomatic(state)) return true;
  return false;
}

/**
 * The pressure the director reads: the city-wide tide (T28 `globalThreat`) blended with the player's
 * current region threat, so it responds to both the global clock and the local situation. 0–100.
 * Deliberately a pure READ of the world (T78 put the day ramp on the drift anchor, where it becomes
 * bodies, rather than as a floor here, where it would only have moved this number).
 */
export function pressureRead(state: GameState): number {
  const here = state.nodes[state.player.location];
  const regionThreat = here !== undefined ? state.regions[here.regionId]?.threat ?? 0 : 0;
  return clampPct(Math.trunc((state.world.globalThreat + regionThreat) / 2));
}

/** Relief beats already spent today (0 when the ration's day stamp is not today, or absent). */
export function reliefSpent(state: GameState): number {
  // `wholeHours` is the shared scrub for saved integer counters: a hand-edited NaN / negative / fraction
  // reads as 0 (a bare `Math.max(0, Math.trunc(NaN))` is NaN, which would read as "under the cap" AND
  // then be written back as `null`). The day is compared and STAMPED through the same scrub, so a
  // non-finite clock can neither dodge the ration (NaN never equals itself) nor be written into `world`.
  return state.world.directorReliefDay !== undefined && wholeHours(state.world.directorReliefDay) === rationDay(state)
    ? wholeHours(state.world.directorReliefBeats)
    : 0;
}

/** The day the ration is keyed on: `meta.day` as a whole non-negative number (a non-finite clock reads as day 0). */
const rationDay = (state: GameState): number => wholeHours(state.meta.day);

/**
 * A region's director bias as a clamped whole number in ±`DIRECTOR_BIAS_MAX` — the scrub every reader
 * of the optional field goes through (absent, NaN, a fraction or an out-of-range hand edit read as the
 * nearest legal value, and 0 when there is no number at all). Pure.
 */
export function directorBias(region: RegionState): number {
  const b = region.directorBias;
  if (!Number.isFinite(b)) return 0;
  return Math.max(-DIRECTOR_BIAS_MAX, Math.min(DIRECTOR_BIAS_MAX, Math.trunc(b as number)));
}

/**
 * Decay one region's bias toward zero by the cycles that come due in `hours` (banked at
 * `DIRECTOR_BIAS_DECAY_HOURS`). The T74 idle rule: a region at zero bias HOLDS — its clock neither
 * accrues nor resets, and the region comes back by the same reference. Pure.
 */
export function decayBias(region: RegionState, hours: number): RegionState {
  const bias = directorBias(region);
  if (bias === 0) {
    // Nothing to decay. Drop a stale carry only if the field is actually present, so a clean region
    // stays reference-equal (the empty-turn contract) and a hand-edited carry cannot persist as NaN.
    if (region.directorBiasHours === undefined && region.directorBias === undefined) return region;
    const { directorBias: _b, directorBiasHours: _h, ...rest } = region;
    return rest;
  }
  const { steps, rest } = bankHours(region.directorBiasHours, hours, DIRECTOR_BIAS_DECAY_HOURS);
  const next = stepToward(bias, 0, steps);
  if (next === region.directorBias && rest === (region.directorBiasHours ?? 0)) return region;
  if (next === 0) {
    const { directorBias: _b, directorBiasHours: _h, ...clean } = region;
    return clean;
  }
  return { ...region, directorBias: next, directorBiasHours: rest };
}

/** The pacing beat the director takes this tick, from pressure + distress, honouring the daily relief ration. */
export type DirectorBeat = "escalate" | "relief" | "hold";
export function directorBeat(state: GameState): DirectorBeat {
  if (!directorEnabled(state)) return "hold";
  if (playerDistressed(state) || pressureRead(state) >= DIRECTOR_HIGH_BAND) {
    // T78: the ration. A capped-out day reads `hold` — the beat the telemetry sees is the beat taken.
    return reliefSpent(state) >= DIRECTOR_RELIEF_PER_DAY ? "hold" : "relief";
  }
  if (pressureRead(state) < DIRECTOR_LOW_BAND) return "escalate";
  return "hold";
}

/**
 * Apply a beat's nudge to a region's danger dials, clamped 0–100. The **escalate** step is the difficulty
 * pacing dial (T56, default `DIRECTOR_STEP`); **relief** is deliberately unscaled — a harder mode escalates
 * a coasting run harder, it does not yank away the comeback rope the GDD's failure-spiral prevention
 * promises (GDD XVI rule 4). `escalateStep` defaults to `DIRECTOR_STEP`, so the sole caller stays identical.
 */
function nudge(region: RegionState, beat: DirectorBeat, escalateStep = DIRECTOR_STEP): RegionState {
  // T78: every beat that lands also leans the region's drift anchor the same way (`directorBias`),
  // clamped to ±DIRECTOR_BIAS_MAX, so the substrate carries the beat forward instead of erasing it.
  // A beat that moves NEITHER the dials nor the bias (both already at their bounds) is a no-op.
  const bias = directorBias(region);
  if (beat === "escalate") {
    const zombieDensity = clampPct(region.zombieDensity + escalateStep);
    const threat = clampPct(region.threat + escalateStep);
    const lean = Math.min(DIRECTOR_BIAS_MAX, bias + escalateStep);
    if (zombieDensity === region.zombieDensity && threat === region.threat && lean === bias) return region;
    return withBias({ ...region, zombieDensity, threat }, lean);
  }
  if (beat === "relief") {
    const zombieDensity = clampPct(region.zombieDensity - DIRECTOR_STEP);
    const lean = Math.max(-DIRECTOR_BIAS_MAX, bias - DIRECTOR_STEP);
    if (zombieDensity === region.zombieDensity && lean === bias) return region;
    return withBias({ ...region, zombieDensity }, lean);
  }
  return region;
}

/** Write a bias coherently: a zero bias is ABSENT (with its clock), never a stored 0. */
function withBias(region: RegionState, bias: number): RegionState {
  if (bias === 0) {
    const { directorBias: _b, directorBiasHours: _h, ...clean } = region;
    return clean;
  }
  return { ...region, directorBias: bias, directorBiasHours: wholeHours(region.directorBiasHours) };
}

/**
 * The body of the `director` world-sim layer (pipeline stage 11). Reads the beat, then applies its
 * clamped ±1 nudge to the player's **current** region only — the district the run is actually in.
 * Inert on a zero-hour tick, when disabled, on a hold beat, or when the nudge would leave a dial
 * unchanged (already at a bound). Touches only `regions`, plus (T78) the relief ration on `world`
 * when a relief nudge actually lands — a relief that changed nothing (density already 0) spends no
 * ration. Pure and deterministic.
 */
export function tickDirector(state: GameState, hours: number): GameState {
  const h = Math.max(0, Math.trunc(hours));
  if (h === 0) return state;

  // T78: every region's bias decays on the tick's hours first — the district you left keeps healing
  // (or settling) whether or not you are there to watch, and whether or not the director is ENABLED:
  // disabling the director stops the beats, not the clock, so a lean acquired before the flag was set
  // still fades (a frozen lean would be a permanent scar, the thing the decay exists to rule out).
  // Only regions that actually change are rewritten.
  let regions = state.regions;
  let decayed = false;
  for (const [id, region] of Object.entries(state.regions)) {
    const next = decayBias(region, h);
    if (next === region) continue;
    if (!decayed) regions = { ...state.regions };
    decayed = true;
    (regions as Record<string, RegionState>)[id] = next;
  }
  const settled: GameState = decayed ? { ...state, regions } : state;
  if (!directorEnabled(settled)) return settled;

  const here = settled.nodes[settled.player.location];
  if (here === undefined) return settled;
  const regionId = here.regionId;
  const region = settled.regions[regionId];
  if (region === undefined) return settled;

  // The beat is read from the ORIGINAL state: decay changes no dial, no clock, and nothing the beat
  // reads (`directorBeat` reads pressure, distress and the ration — never the bias).
  const beat = directorBeat(state);
  if (beat === "hold") return settled;
  // Pacing dial (T56): scale the escalate nudge by difficulty. Survivor / unset ⇒ 1 ⇒ scaleInt returns
  // DIRECTOR_STEP unchanged (byte-identical); harder modes escalate a coasting run faster. On Story the
  // step truncates to 0 (`directorAggression` 0.5), so Story's director NEVER escalates and never leans
  // a district upward — relief only, as `difficulty.ts` declares ("a gentle mode's director never
  // escalates, only relieves"). The lean rides the same step on purpose: the dial's promise is kept.
  // (T78 corrects the earlier "Story barely" here — it was never barely, it was never.)
  const escalateStep = scaleInt(DIRECTOR_STEP, profileOf(settled).directorAggression);
  const next = nudge(region, beat, escalateStep);
  if (next === region) return settled;
  const nudged = { ...settled.regions, [regionId]: next };
  if (beat !== "relief") return { ...settled, regions: nudged };
  // Spend one beat of today's relief ration (the day stamp rolls the count over at midnight).
  const world = { ...settled.world, directorReliefDay: rationDay(settled), directorReliefBeats: reliefSpent(settled) + 1 };
  return { ...settled, regions: nudged, world };
}
