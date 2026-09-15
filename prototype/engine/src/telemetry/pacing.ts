/**
 * Pacing / pressure telemetry baseline (M2 task T32 · PRD §4 · DESIGN §11).
 *
 * M2 makes the world move; M5 will have to *balance* how it moves. This module lays the instrumentation
 * that later balance pass measures against — the pacing/pressure proxies PRD §4 names — without adding
 * any weight to a shipping run. It is deliberately **client-driven**: nothing in the pipeline captures a
 * sample; a client (or a test harness) calls {@link samplePacing} on the states it already has, so the
 * instrumentation is **off by default** and cannot perturb determinism. Because every sample is a pure
 * read of a deterministic state, a seeded run yields byte-identical samples every time.
 *
 * The proxies split into a **pressure read** (how hard the apocalypse is leaning on the player right
 * now — the T30 director's own signal, plus its raw ingredients) and a **load read** (walkers, hordes,
 * blocked routes, distress). {@link summarizePacing} folds a run's samples into the pacing **metrics**
 * the T30 Definition of Done leans on — mean/peak pressure, high-pressure and relief/calm turn counts,
 * pressure oscillations, the longest calm streak.
 *
 * ### What T60 measured, and why this module now reports a second thing
 *
 * The absolute-pressure half of that read is **dead, and had been since it was written**: over 120
 * played runs across five policies (`measure/t60.ts --pacing`), `highPressureTurns` was **0.0% of
 * turns and `oscillations` 0.00 in every policy**, because peak pressure lands at 41.6–50.4 by policy
 * against a high band of 70 and can hardly do otherwise — `driftRegions` holds the region dial at or
 * within a point of its anchor on 63% of turns (exactly on it on 40%), so the only mover with real
 * travel is the city tide, and blending a ~33-point tide swing with a near-pinned dial halves it to
 * ~16 inside a 45-point band. That last step is arithmetic offered as an explanation, not a reading —
 * nothing measures the tide's swing directly. No retune of the bands fixes any of it; they are
 * measuring a quantity the simulation does not produce. Those fields are kept — five tasks of recorded baselines compare against
 * them, and a metric that reads 0 for a known reason is worth more than a metric quietly deleted — but
 * nothing should be concluded from them.
 *
 * What replaced them is the **beat census**: `holdTurns` / `escalateTurns` / `reliefTurns`,
 * `beatSwitches`, `coastingTurns`, and the signed tide lean. Those report the controller rather than
 * the world, which is what the DoD sentence *"disabling the director changes pacing metrics"* was
 * always asking for: with the director off, every turn is `hold` and `beatSwitches` is 0, exactly and
 * by construction. `test/pacing60.test.ts` asserts that pair.
 *
 * Pure, deterministic, dependency-free (ADR-0001): no RNG, no clock, no capture side effects.
 */

import type { GameState, Phase } from "../state/types.js";
import {
  pressureRead, playerDistressed, directorEnabled, DIRECTOR_LOW_BAND, DIRECTOR_HIGH_BAND,
  directorBeat, turnsSinceThreat, coasting, tideLean, type DirectorBeat,
} from "../sim/director.js";
import { isBlocked } from "../sim/routes.js";

/** One turn's pacing snapshot — the PRD §4 proxies, all integers / booleans / plain strings. */
export interface PacingSample {
  readonly turn: number;
  readonly day: number;
  readonly hour: number;
  readonly phase: Phase;
  readonly weather: string;
  /** The director's pressure read (blended global tide + local region threat), 0–100. */
  readonly pressure: number;
  /** City-wide danger tide (T28), 0–100. */
  readonly globalThreat: number;
  /** Mean / peak region threat and zombie density across all regions, 0–100. */
  readonly regionThreatMean: number;
  readonly regionThreatPeak: number;
  readonly densityMean: number;
  readonly densityPeak: number;
  /** Total loitering walkers and total horde headcount on the map. */
  readonly walkersTotal: number;
  readonly hordeHeadcount: number;
  readonly hordeCount: number;
  /** Routes currently impassable. */
  readonly routesBlocked: number;
  /** Is a fight underway; is the player under real pressure; is the director active. */
  readonly inCombat: boolean;
  readonly distressed: boolean;
  readonly directorOn: boolean;
  /**
   * **What the director decided this turn** (T60). The four fields above this one describe the world;
   * these four describe the controller, which is a different thing and, before T60, was measured by
   * nothing. `beat` is the decision; the other three are the inputs it is made of.
   */
  readonly beat: DirectorBeat;
  /** Turns since the last beat that threatened this survivor — GDD IV's second-named input. */
  readonly quietTurns: number;
  /** Is the player coasting (quietTurns at/above the threshold)? */
  readonly coasting: boolean;
  /** Signed distance of the city tide from its phase target: how far the night is ahead of schedule. */
  readonly tideLean: number;
}

const meanInt = (xs: readonly number[]): number => (xs.length === 0 ? 0 : Math.trunc(xs.reduce((a, b) => a + b, 0) / xs.length));
const peak = (xs: readonly number[]): number => (xs.length === 0 ? 0 : Math.max(...xs));

/** Read the pacing proxies off one state. Pure; no capture, no mutation. */
export function samplePacing(state: GameState): PacingSample {
  const regions = Object.values(state.regions);
  const threats = regions.map((r) => r.threat);
  const densities = regions.map((r) => r.zombieDensity);
  const walkersTotal = Object.values(state.nodes).reduce((a, n) => a + n.walkers, 0);
  const routesBlocked = Object.values(state.routes).filter((r) => isBlocked(r.wear)).length;
  return {
    turn: state.meta.turn,
    day: state.meta.day,
    hour: state.meta.hour,
    phase: state.meta.phase,
    weather: state.world.weather,
    pressure: pressureRead(state),
    globalThreat: state.world.globalThreat,
    regionThreatMean: meanInt(threats),
    regionThreatPeak: peak(threats),
    densityMean: meanInt(densities),
    densityPeak: peak(densities),
    walkersTotal,
    hordeHeadcount: state.hordes.reduce((a, h) => a + h.size, 0),
    hordeCount: state.hordes.length,
    routesBlocked,
    inCombat: state.combat !== null,
    distressed: playerDistressed(state),
    directorOn: directorEnabled(state),
    beat: directorBeat(state),
    quietTurns: turnsSinceThreat(state),
    coasting: coasting(state),
    tideLean: tideLean(state),
  };
}

/** The pacing metrics a run's samples fold into — the balance baseline + the T30 DoD's yardstick. */
export interface PacingSummary {
  readonly samples: number;
  readonly meanPressure: number;
  readonly peakPressure: number;
  /** Turns spent above the high band, and at/below the low band (relief / calm). */
  readonly highPressureTurns: number;
  readonly calmTurns: number;
  /** How often pressure crossed between the calm and high bands — the spacing of pressure and relief. */
  readonly oscillations: number;
  /** Longest run of consecutive calm (low-band) turns. */
  readonly longestCalmStreak: number;
  /**
   * **The beat census** (T60) — turns spent in each director decision, and how often the decision
   * changed. This is the half of the pacing read that the T30 DoD sentence *"disabling the director
   * changes pacing metrics"* actually needs: with the director off every turn is `hold` and
   * `beatSwitches` is 0, which no amount of watching `pressure` could ever tell you.
   */
  readonly holdTurns: number;
  readonly escalateTurns: number;
  readonly reliefTurns: number;
  /** How often the beat changed from one turn to the next — pacing *as the controller drives it*. */
  readonly beatSwitches: number;
  /** Turns spent coasting, and the longest unbroken quiet streak, in turns. */
  readonly coastingTurns: number;
  readonly longestQuietStreak: number;
  /** Mean and peak signed tide lean (see {@link PacingSample.tideLean}); mean truncated toward zero. */
  readonly meanTideLean: number;
  readonly peakTideLean: number;
}

/** The pressure band a sample sits in — the unit of "pacing" oscillation. */
type Band = "calm" | "mid" | "high";
function bandOf(pressure: number): Band {
  if (pressure >= DIRECTOR_HIGH_BAND) return "high";
  if (pressure < DIRECTOR_LOW_BAND) return "calm";
  return "mid";
}

/** Fold a run's samples into pacing metrics. Pure; deterministic over deterministic samples. */
export function summarizePacing(samples: readonly PacingSample[]): PacingSummary {
  const n = samples.length;
  const pressures = samples.map((s) => s.pressure);
  let high = 0;
  let calm = 0;
  let oscillations = 0;
  let streak = 0;
  let longest = 0;
  let lastExtreme: Band | null = null; // last non-mid band seen, for crossing counts
  const beats: { [b in DirectorBeat]: number } = { hold: 0, escalate: 0, relief: 0 };
  let beatSwitches = 0;
  let lastBeat: DirectorBeat | null = null;
  let coastingTurns = 0;
  let longestQuiet = 0;
  const leans: number[] = [];
  for (const smp of samples) {
    beats[smp.beat] += 1;
    if (lastBeat !== null && smp.beat !== lastBeat) beatSwitches += 1;
    lastBeat = smp.beat;
    if (smp.coasting) coastingTurns += 1;
    if (smp.quietTurns > longestQuiet) longestQuiet = smp.quietTurns;
    leans.push(smp.tideLean);
  }
  for (const p of pressures) {
    const b = bandOf(p);
    if (b === "high") high++;
    if (b === "calm") {
      calm++;
      streak++;
      if (streak > longest) longest = streak;
    } else {
      streak = 0;
    }
    if (b !== "mid") {
      if (lastExtreme !== null && b !== lastExtreme) oscillations++;
      lastExtreme = b;
    }
  }
  return {
    samples: n,
    meanPressure: meanInt(pressures),
    peakPressure: peak(pressures),
    highPressureTurns: high,
    calmTurns: calm,
    oscillations,
    longestCalmStreak: longest,
    holdTurns: beats.hold,
    escalateTurns: beats.escalate,
    reliefTurns: beats.relief,
    beatSwitches,
    coastingTurns,
    longestQuietStreak: longestQuiet,
    // Signed, so the mean must truncate toward zero rather than floor — a lean of -1 averaged with +1
    // is 0, not -1. `meanInt` truncates, which is that.
    meanTideLean: meanInt(leans),
    peakTideLean: leans.length === 0 ? 0 : Math.max(...leans),
  };
}
