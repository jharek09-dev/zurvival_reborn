import { describe, expect, it } from "vitest";
import {
  advanceWorld,
  applyAction,
  availableActions,
  startRun,
  samplePacing,
  summarizePacing,
  type GameState,
  type PacingSample,
  type RegionGraph,
  type NodeDef,
  type RegionDef,
} from "../src/index.js";

const REGIONS: RegionDef[] = [
  { id: "region.x", name: "X", description: "x", baseline: { zombieDensity: 25, threat: 15, loot: 80, survivorActivity: 0 } },
];
const NODES: NodeDef[] = [
  { id: "node.x.a", regionId: "region.x", name: "A", description: "a", adjacent: ["node.x.b"], start: true },
  { id: "node.x.b", regionId: "region.x", name: "B", description: "b", adjacent: ["node.x.a"] },
];
const opts = { seed: "pacing-seed", createdAt: "2026-07-05T00:00:00Z" };
const run = (): { state: GameState; graph: RegionGraph } => startRun(opts, REGIONS, NODES);
const disable = (s: GameState): GameState => ({ ...s, world: { ...s.world, flags: { ...s.world.flags, "director.disabled": true } } });

/**
 * Drive a seeded world timeline off-screen (each step advances the living world by 6 h with no player
 * action), capturing a pacing sample after each. Off-screen advance sidesteps the survival clock, so
 * the timeline isolates the world's own pacing — exactly what T32 exists to measure.
 */
function worldRun(start: GameState, graph: RegionGraph, steps: number): PacingSample[] {
  const samples: PacingSample[] = [samplePacing(start)];
  let s = start;
  for (let i = 0; i < steps; i++) {
    s = advanceWorld(s, 6, graph);
    samples.push(samplePacing(s));
  }
  return samples;
}

/** A short played run (rest until the survival clock ends it) — proves samples read a real pipeline run. */
function playedRun(start: GameState, graph: RegionGraph, turns: number): PacingSample[] {
  const samples: PacingSample[] = [samplePacing(start)];
  let s = start;
  for (let i = 0; i < turns; i++) {
    const rest = availableActions(s, graph).find((c) => c.id === "rest");
    if (!rest) break;
    s = applyAction(s, rest.action, graph).state;
    samples.push(samplePacing(s));
  }
  return samples;
}

describe("pacing samples read the proxies (T32 · PRD §4)", () => {
  it("captures pressure, threat, load, and director state as plain data", () => {
    const { state } = run();
    const s = samplePacing(state);
    expect(s.turn).toBe(state.meta.turn);
    expect(s.pressure).toBeGreaterThanOrEqual(0);
    expect(s.pressure).toBeLessThanOrEqual(100);
    expect(s.directorOn).toBe(true);
    expect(samplePacing(disable(state)).directorOn).toBe(false);
  });

  it("is deterministic — a seeded run yields identical samples", () => {
    const a = run();
    const b = run();
    expect(JSON.stringify(worldRun(a.state, a.graph, 30))).toBe(JSON.stringify(worldRun(b.state, b.graph, 30)));
    // a played pipeline run is deterministic too
    expect(JSON.stringify(playedRun(a.state, a.graph, 8))).toBe(JSON.stringify(playedRun(b.state, b.graph, 8)));
  });
});

describe("summarizePacing folds a run into pacing metrics (T32)", () => {
  it("reports bounded metrics and a coherent calm streak", () => {
    const { state, graph } = run();
    const sum = summarizePacing(worldRun(state, graph, 40));
    expect(sum.samples).toBe(41);
    expect(sum.meanPressure).toBeGreaterThanOrEqual(0);
    expect(sum.peakPressure).toBeLessThanOrEqual(100);
    expect(sum.longestCalmStreak).toBeLessThanOrEqual(sum.samples);
    expect(sum.highPressureTurns + sum.calmTurns).toBeLessThanOrEqual(sum.samples);
  });
});

describe("the T30 DoD via T32 — disabling the director changes pacing, never breaks bounds", () => {
  it("director-on and director-off runs produce different pacing metrics from the same seed", () => {
    const { state, graph } = run();
    // T60: this assertion used to read `meanPressure`, and it passed by a single point — the pre-T60
    // escalate beat fired on day one and nudged the region once. Measurement then showed the whole
    // absolute-pressure read is dead (`highPressureTurns` 0.0% of turns and `oscillations` 0.00 across
    // 120 played runs; see the `telemetry/pacing.ts` header), so an assertion resting on it was one
    // tuning change away from being a test of nothing. It now reads the BEAT, which is what "the
    // director is shaping pacing" always meant, and it reads it off a PLAYED run, because after T60 the
    // decision is a fact about the player: an off-screen timeline has no player and no turns, so every
    // beat in one is `hold` whether the director is on or off — true, and useless as a discriminator.
    const on = summarizePacing(playedRun(state, graph, 60));
    const off = summarizePacing(playedRun(disable(state), graph, 60));
    expect(on.samples).toBe(off.samples);
    // Off, the controller is provably inert: one beat, no switches, for the whole run.
    expect(off.holdTurns).toBe(off.samples);
    expect(off.escalateTurns).toBe(0);
    expect(off.reliefTurns).toBe(0);
    expect(off.beatSwitches).toBe(0);
    // On, it is provably not.
    expect(on.escalateTurns + on.reliefTurns).toBeGreaterThan(0);
    expect(on.beatSwitches).toBeGreaterThan(0);
    expect(on.holdTurns).toBeLessThan(on.samples);
    // The quiet clock is a live, moving read in a played run — not pinned at 0 (the naive-rule failure).
    expect(on.longestQuietStreak).toBeGreaterThanOrEqual(1);
    // ...and every captured sample stayed legal in both runs (no impossible state)
    for (const samples of [worldRun(state, graph, 60), worldRun(disable(state), graph, 60)]) {
      for (const s of samples) {
        expect(s.pressure).toBeGreaterThanOrEqual(0);
        expect(s.pressure).toBeLessThanOrEqual(100);
        expect(s.densityPeak).toBeLessThanOrEqual(100);
        expect(s.regionThreatPeak).toBeLessThanOrEqual(100);
      }
    }
  });
});
