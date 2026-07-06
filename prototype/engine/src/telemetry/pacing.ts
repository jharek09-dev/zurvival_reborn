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
 * pressure oscillations, the longest calm streak — so "disabling the director changes pacing metrics"
 * is a thing a test can actually assert.
 *
 * Pure, deterministic, dependency-free (ADR-0001): no RNG, no clock, no capture side effects.
 */

import type { GameState, Phase } from "../state/types.js";
import { pressureRead, playerDistressed, directorEnabled, DIRECTOR_LOW_BAND, DIRECTOR_HIGH_BAND } from "../sim/director.js";
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
  };
}
