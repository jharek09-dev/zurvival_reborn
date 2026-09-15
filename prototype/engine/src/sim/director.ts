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

import type { GameState, HistoryEvent, RegionState, Wound } from "../state/types.js";
import { isSymptomatic } from "./infection.js";
import { profileOf, scaleInt } from "./difficulty.js";
import { woundBurden, woundRemainder } from "./wounds.js";
import { bankHours, stepToward, wholeHours } from "./clocks.js";
import { PHASE_THREAT_TARGET } from "./timeOfDay.js";
import type { Phase } from "../state/types.js";

// --- bands & steps (tunable) ----------------------------------------------------------------

/**
 * The T30 pressure bands, **both now historical**, kept because five tasks of recorded baselines
 * compare against them and `telemetry/pacing.ts`'s `bandOf` still reports them.
 *
 * `DIRECTOR_LOW_BAND` was "pressure below this (and no distress) ⇒ escalate". Nothing reads it now:
 * T60 replaced that trigger with {@link coasting}, and `grep` finds this constant only in `bandOf`,
 * in prose, and in the re-export. `DIRECTOR_HIGH_BAND` is still read by {@link directorBeat} as a
 * relief trigger, but measurement says it is unreachable — peak pressure lands in the low 40s to low
 * 50s against a band of 70 — so the reachable relief trigger is {@link DIRECTOR_LEAN_HIGH}. Neither
 * constant should be treated as live tuning; see the `telemetry/pacing.ts` header for the numbers.
 */
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

// --- coasting: GDD IV's second-named input, read at last (M5 task T60) -----------------------

/**
 * The Living-History beats that count as **a real threat happening to this survivor** — the input
 * GDD Part IV names second in the director's own list (*"it tracks recent tension, **time since the
 * last real threat**, resource desperation, emotional highs and lows, and repetition"*).
 *
 * ### Why an explicit set rather than a prefix rule
 *
 * Because the log is mostly not about the player. Measured over 6,301 turns across five policies
 * (`measure/t60.ts --beats`), a run writes ~127 history beats and **60.3 of them are `horde.move`** —
 * off-screen masses stepping between nodes, 47% of the whole log. `npc.died` adds another 15.1, for
 * survivors the player has never met. A prefix rule over `horde.` or a "something was written this
 * turn" rule reads the map moving as the player being threatened: with the naive rule the streak is 0
 * on 100% of turns and the whole signal is dead. With this set it is **mean 4.91 turns, max 43, and
 * >= {@link DIRECTOR_COASTING_TURNS} on 45.7% of turns** — a live, oscillating read.
 *
 * (Every figure in this block is what `--beats` prints TODAY. An audit caught the first cut quoting
 * numbers taken before {@link threatening} started excusing relief and neutral scenes — measured, in
 * the same task, and then never re-derived after the correction landed. A comment that cites a tool is
 * making a promise about what the tool says.)
 *
 * T87's audit concluded that *any suffix rule has that failure somewhere*; a prefix rule has the
 * mirror of it, and this is where it bites. So the membership is written out, and
 * `test/pacing60.test.ts` asserts both halves: that the commonest of these really do fire in played
 * runs, and that the four commonest beats the log produces (`horde.move`, `npc.died`, `route.change`,
 * `weather.change`) are **not** members.
 *
 * ### The set is closed; the beat-TYPE namespace is not
 *
 * A first cut of this comment ended "a content set cannot quietly join this list", and an audit
 * disproved it in one file. `logHistory` (`sim/events.ts`) appends a beat whose `type` is whatever the
 * content says, and the schema constrains that string to `minLength: 1` — so a choice effect of
 * `{"kind":"logHistory","event":"combat.cleared"}` forges a threat, pins the quiet clock at 0, and
 * suppresses the escalate beat for as long as the scene keeps firing. The asymmetry is at least in the
 * safe direction: a forged `encounter.begin` carries no tone, and {@link threatening} fails closed, so
 * content can counterfeit a threat but never a false calm. `prototype/harness/test/content.test.ts`
 * now asserts that no authored `logHistory` event collides with this set, which is the guard the
 * sentence promised.
 */
export const DIRECTOR_THREAT_BEATS: ReadonlySet<string> = new Set([
  "combat.cleared",     // a fight resolved — the loudest thing that happens to a survivor
  "horde.overrun",      // a mass walked over them
  "encounter.begin",    // a scene engaged them (12.5 a run: the liveliest channel in the game)
  "infection.staged",   // the fever took a step
  "siege.breached",
  "siege.repelled",
  "siege.held",
  "stand.spent",
]);

/**
 * Turns since the last real threat, read off the append-only log — **derived, never stored** (the T79
 * precedent that has kept five tasks' worth of new axes out of the save).
 *
 * Scans backwards and stops at the first hit. Measured, that is **mean 15.1 entries, p95 78, max 281**
 * — and on **8.5% of turns there is no threat beat in the log at all**, where the scan is the whole
 * history (the worst measured turn read 281 of 299 entries). The first cut of this comment claimed the
 * cost was "the length of the current quiet streak … not the length of the run"; an audit measured
 * every factor in that product wrong and the "not the length of the run" half false one turn in twelve.
 * It is not a performance problem at shipping run lengths — runs end around turn 50 with ~127-beat
 * logs, so the absolute cost is tens of microseconds a turn, and `history` has no cap only because
 * nothing yet needs one — but the bound is O(history), and anything that lengthens runs should re-read
 * this. A run with no threat beat at all reads as the whole run so far, which is correct: nothing has
 * happened yet.
 *
 * Total about a hand-edited save: `Number.isSafeInteger`, not `Number.isFinite`. `loadGame` does not
 * validate `meta.turn`, so a hand-edited `"turn": 1e308` is a perfectly FINITE number — and an audit
 * showed it end to end: every tick reads as coasting for the rest of the run and `directorBias` pins at
 * its cap, which is precisely the "escalate forever" the first cut of this sentence called impossible.
 * A safe-integer clock also makes the subtraction total for free: two safe integers cannot differ by
 * more than 2^53, so no clamp is needed on the result and none is pretended (the first fix added one, a
 * mutation sweep showed it could never engage, and a guard that cannot engage is the thing this file
 * has criticised elsewhere). Either stamp out of range reads as 0 turns since — i.e. NOT coasting.
 */
/**
 * Whether one logged beat is **a threat to this survivor**, which is {@link DIRECTOR_THREAT_BEATS}
 * membership plus one correction the first measurement of this controller forced.
 *
 * ### The sensor and the actuator were the same wire
 *
 * `encounter.begin` is both the beat that says "something happened to you" AND the channel the
 * escalate beat acts through ({@link DIRECTOR_TONE_LEAN}). Wired naively, the loop blinds itself the
 * instant it acts: firing a scene resets the coasting clock, so "coasting" can only ever mean "the
 * encounter system is idle" — the one state in which the encounter pool cannot be leaned. On exactly
 * that wiring — which no longer exists, so this figure is **not re-derivable from the harness** — the
 * escalate beat reached the weighted ambient pick **6 times in 120 runs** (0.8% of 767 picks), against
 * 8.8% of turns spent in the beat. What IS re-derivable is the state after the correction:
 * `measure/t60.ts --lean` puts the escalate beat at 23.8% of turns and 330 of the 1,831 ambient tables
 * a run consults.
 *
 * The correction is not a tuning one. A scene only counts as a threat if it WAS one, which is what the
 * tone field already says: `birdsong` is not the world coming for you, and a director that treats
 * being consoled as an event it must now stop escalating about is reading its own output as its input.
 */
export function threatening(e: HistoryEvent): boolean {
  if (!DIRECTOR_THREAT_BEATS.has(e.type)) return false;
  if (e.type !== "encounter.begin") return true;
  const tone = (e.data as { tone?: unknown } | null)?.tone;
  // Fail CLOSED, and the difference is not cosmetic. The excusing condition is written as an explicit
  // membership test rather than as `tone !== "tension"`, because `data` comes off a save and can be
  // anything: under the negated form a hand-edited `tone: "x"` — or `42`, or `"TENSION"` — reads as
  // "not a threat" on EVERY beat, the quiet clock never starts, and the run escalates forever. A beat
  // is excused only when it says, in the exact vocabulary, that it was not a threat; absent (a pre-T60
  // save, or a pool that authors no tone) and unrecognised both keep the pre-T60 reading, which is that
  // every scene is a threat. `test/pacing60.test.ts` caught this on the first run of the first draft.
  return tone !== "relief" && tone !== "neutral";
}

export function turnsSinceThreat(state: GameState): number {
  const now = state.meta.turn;
  if (!Number.isSafeInteger(Math.trunc(now))) return 0;
  for (let i = state.history.length - 1; i >= 0; i -= 1) {
    const e = state.history[i]!;
    if (!threatening(e)) continue;
    if (!Number.isSafeInteger(Math.trunc(e.turn))) return 0;
    return Math.max(0, Math.trunc(now) - Math.trunc(e.turn));
  }
  return Math.max(0, Math.trunc(now));
}



/** Quiet turns at/above which the player reads as COASTING and the director tightens (T60). */
export const DIRECTOR_COASTING_TURNS = 3;

/** Is the player coasting — nothing has happened to them for {@link DIRECTOR_COASTING_TURNS} turns? */
export function coasting(state: GameState): boolean {
  return turnsSinceThreat(state) >= DIRECTOR_COASTING_TURNS;
}

// --- the tide's lean: the reachable half of the high band (M5 task T60) ----------------------

/**
 * How far the city-wide tide sits **above what this hour is pulling it toward** — the signal that
 * replaces an absolute high band the game never reaches.
 *
 * ### The arithmetic of a dead band, measured
 *
 * `DIRECTOR_HIGH_BAND` is 70 and {@link pressureRead} blends the tide with the player's region threat.
 * Measured over 120 runs across five policies (`measure/t60.ts --pacing`): **peak pressure 41.6-50.4
 * by policy, so `highPressureTurns` is 0.0% and `oscillations` is 0.00 in every policy.** The
 * relief-by-pressure branch has never fired in this game; every relief beat ever taken came from
 * {@link playerDistressed} or, since T60, from the lean below.
 *
 * The cause is not the number, it is what the number is read off. `driftRegions` pulls each district
 * onto its anchor, and it largely succeeds: the player's region sits EXACTLY on its anchor on **40% of
 * turns and within a point of it on 63%**. (The first cut of this comment said 90%, repeated it in two
 * other files, and an audit could not reproduce it under any reading — the corrected figure is what
 * `--pacing` prints, and it is still the point: a dial held within a point of its authored value is
 * not a dial that can carry a 45-point band.) So the only thing in the pressure read with real travel
 * is the tide — and averaging a ~33-point tide swing with a near-pinned dial halves it to ~16, inside
 * a 45-point band. **A 16-point signal cannot cross a 45-point band**, and no retuning of 25/70 changes
 * that; a band on a relaxed dial measures the relaxation.
 *
 * The lean does move: measured **-30 to +13, mean -4.5**, because the tide chases a phase target that
 * jumps 25-40 points between phases and closes the gap at 3 points an hour. It is negative on the climb
 * into dusk and night and positive through the morning after — so a pacing controller reading it plays
 * a **diurnal** beat, which is the cycle of tension GDD Part III asks for and the shape a zombie city
 * should have anyway.
 *
 * Pure state read: no graph, no baseline, no new field. `meta.phase` and `world.globalThreat` are both
 * already in the save.
 */
export function tideLean(state: GameState): number {
  // `hasOwnProperty`, not a bare index. `PHASE_THREAT_TARGET` is a plain object literal, so a
  // prototype key off a hand-edited save — `"constructor"`, `"toString"`, `"__proto__"`,
  // `"valueOf"`, `"hasOwnProperty"` — resolves to a truthy INHERITED member, sails past a
  // `=== undefined` fallback, and returns NaN, which then reaches `PacingSample.tideLean` and both
  // summary fields. `sim/difficulty.ts`'s `profileOf` fixed this exact bug and wrote down the reason;
  // the first cut of this function reintroduced it four files away. An audit caught it, and the only
  // thing standing between it and a NaN was `loadGame`'s phase whitelist — i.e. luck, at one remove.
  const phase = state.meta.phase as string;
  if (!Object.prototype.hasOwnProperty.call(PHASE_THREAT_TARGET, phase)) return 0;
  const target = PHASE_THREAT_TARGET[phase as Phase];
  const tide = state.world.globalThreat;
  if (!Number.isFinite(tide) || !Number.isFinite(target)) return 0;
  return Math.trunc(tide) - target;
}

/**
 * The lean at/above which the world reads as **hotter than this hour ought to be**, and the director
 * eases off. Set from the measured distribution: `>= 8` covers 8.1% of turns, against the absolute
 * high band's 0.0%. Below it the lean is ordinary weather, not a crest. **A pure tuning magnitude**:
 * a mutation sweep moved it to 9 and nothing failed, which is correct — its only justification is that
 * share, and a unit test pinning 8 over 9 would be pinning taste. Declared, as T59 declared
 * `LOOT_POINTS_PER_ITEM`.
 *
 * **It is a daylight signal, and that is a consequence rather than a decision.** `PHASE_THREAT_TARGET`
 * is asymmetric — night's target is 55 and the tide closes a gap at 3 points an hour, so it tops out
 * around 49 and the lean at night is non-positive by construction. Measured by phase, `>= 8` fires on
 * 30.8% of dawn turns and 13.8% of morning turns and on **zero of 1,698 turns** of late afternoon,
 * dusk, night and early morning. So this branch eases off when the sun is up and never when it is
 * down, and it is the sole cause of a relief beat on 1.9% of turns against `playerDistressed`'s 57.5%.
 * Declared rather than fixed: making it symmetric means retuning `PHASE_THREAT_TARGET`, which is T28's
 * diurnal curve and a bigger change than a pacing pass should make. See PL-M5-84.
 */
export const DIRECTOR_LEAN_HIGH = 8;

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

/**
 * **Is the district the player is standing in already at the top?** The escalate beat's legality clamp
 * (T60), and the T30 invariant "the director cannot manufacture an impossible state" made checkable.
 *
 * Asks the REGION, not {@link pressureRead}'s blend: a district at threat 100 and density 100 under a
 * cold tide blends to 50, which is why the first cut escalated a maxed-out district ten times running.
 * Both dials, because either one at the ceiling means the nudge has nowhere to put its point — and the
 * nudge would then be a no-op that still spends a beat and still leans the drift anchor.
 *
 * Total: a missing node or region, or a non-finite dial off a hand-edited save, reads as CRESTED —
 * fail-closed, i.e. the director declines to escalate something it cannot measure.
 */
export function crested(state: GameState): boolean {
  const here = state.nodes[state.player.location];
  const region = here === undefined ? undefined : state.regions[here.regionId];
  if (region === undefined) return true;
  const { threat, zombieDensity } = region;
  if (!Number.isFinite(threat) || !Number.isFinite(zombieDensity)) return true;
  return threat >= 100 || zombieDensity >= 100;
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

/**
 * The pacing beat the director takes this tick — **from the two inputs GDD Part IV names, plus the
 * ration** (M5 task T60).
 *
 * ### What changed, and why the old form could not be tuned
 *
 * T60's brief was *"tune the Director's escalate/relief bands against pacing telemetry"*. Measured
 * first (`measure/t60.ts`, 120 runs across five policies), both bands turned out to be unreachable
 * rather than mistuned:
 *
 *   - the **high** band (70) is never crossed — peak pressure 41.6-50.4 by policy,
 *     `highPressureTurns` **0.0%**, `oscillations` **0.00**. See {@link tideLean} for the arithmetic.
 *   - the **low** band (25) is crossed only while `globalThreat` climbs from 0 on day one: **every
 *     escalate beat in a run was a day-1 beat** (72/72, 116/116, 106/106 by policy). PL-M5-33 said so
 *     after T78 and it was still true after T59.
 *
 * So the beats were: relief when distressed, and hold. And the consequence, measured end to end, was
 * that **turning the entire Apocalypse Director off changed a run by 0.1 turns** (50.0 -> 49.9, day
 * 4.16 -> 4.13, encounters 11.74 -> 11.78, combats 3.51 -> 3.39). T30's Definition of Done says
 * disabling the director changes the pacing metrics; on a region-density probe under distress it did
 * (T78 restored that), and on everything a player could feel it did not.
 *
 * **Those four figures are the PRE-T60 tree and cannot be re-derived from the harness**, which runs the
 * tree it is in — an audit rightly flagged the first cut for stating them in the present tense. What
 * `measure/t60.ts --onoff` prints today is 51.5 turns on against 51.8 off. That is still only a third
 * of a turn, and deliberately so: the director's job is the SHAPE of a run, not its length, and the
 * shape shows in `--lean` (a) — the escalate beat asks for 46.7% tension against a hold turn's 23.2%
 * — and in the death mix, which reorders between the two.
 *
 * The two reads below are the fix, and neither is a new number in an old place:
 *
 *   - **escalate on {@link coasting}** — *"time since the last real threat"*, GDD IV's own second-named
 *     input, read off the Living History and live at 45.7% of turns. "Tightening when the player is
 *     coasting" is a fact about the PLAYER; the low band was a fact about a dial the drift pins.
 *   - **relief on {@link tideLean}** at/above {@link DIRECTOR_LEAN_HIGH}, which restores a reachable
 *     high side (8.1% of turns against the absolute band's 0.0%).
 *
 * ### The legality clamp is on the DISTRICT, not on the blend
 *
 * A first cut of this function wrote `coasting(state) && pressureRead(state) < DIRECTOR_HIGH_BAND` and
 * a comment saying that kept the T30 invariant. Both halves were wrong, and an audit showed it twice
 * over. The clause is **dead code**: the branch above already returns on `pressureRead >=
 * DIRECTOR_HIGH_BAND`, so it can never be false — deleting it passed the entire suite. And it was the
 * wrong quantity anyway: `pressureRead` is `(globalThreat + regionThreat) / 2`, a blend, so a district
 * at threat 100 and density 100 with a cold tide reads 50 and was escalated ten times in a row, its
 * `directorBias` driven to the +10 cap. The clamp now asks the district itself, which is what "cannot
 * manufacture an impossible state" was always about.
 *
 * `DIRECTOR_LOW_BAND` is no longer read by this function at all — see its own doc.
 */
export type DirectorBeat = "escalate" | "relief" | "hold";

/**
 * **What the director WANTS this turn**, before the relief ration is applied — the beat as a read of
 * the player's situation, with nothing about bookkeeping in it.
 *
 * Split out of {@link directorBeat} by T60's audit, which found the two questions silently disagreeing
 * across the pipeline. `tickDirector` runs at stage 11 and SPENDS the ration; the encounter pool reads
 * the beat at stage 13, by which point `reliefSpent` is one higher — so on the day's last rationed
 * relief the nudge landed and the pool was then handed the identity lean. Measured, the ration is
 * exhausted often enough that `directorBeat` reported `hold` to the pool on **39.9% of turns**, and
 * the tone lean is the only authority this controller has that a player can feel.
 *
 * So the ration governs the NUDGE (a bounded, persisted lean on a district's drift anchor, which is
 * what T78 rationed and why), and the tone lean — cheap, unpersisted, one turn's offer — follows the
 * want. Telemetry records both, because the gap between them is a real thing about a run.
 */
export function directorIntent(state: GameState): DirectorBeat {
  if (!directorEnabled(state)) return "hold";
  if (playerDistressed(state) || tideLean(state) >= DIRECTOR_LEAN_HIGH || pressureRead(state) >= DIRECTOR_HIGH_BAND) return "relief";
  // T60: the player is coasting — and the district they are standing in still has somewhere to go.
  if (coasting(state) && !crested(state)) return "escalate";
  return "hold";
}

export function directorBeat(state: GameState): DirectorBeat {
  const want = directorIntent(state);
  // T78: the ration. A capped-out day reads `hold` — the beat the NUDGE takes is the beat reported.
  if (want === "relief" && reliefSpent(state) >= DIRECTOR_RELIEF_PER_DAY) return "hold";
  return want;
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
