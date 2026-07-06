import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  applyAction,
  availableActions,
  clampNoise,
  decayAllNoise,
  depositNoiseAt,
  loadGame,
  noiseOf,
  saveGame,
  startRun,
  updateNodeNoise,
  NOISE_DECAY_PER_HOUR,
  NOISE_MOVE,
  NOISE_REST,
  NOISE_SEARCH,
  type GameState,
  type NodeDef,
  type RegionGraph,
  type RegionDef,
} from "../src/index.js";

/**
 * T14 — noise deposit model (FR-SIM-06). Loud actions deposit noise into node memory; time decays
 * it; the quiet path is legibly quieter. Pure/deterministic/integer throughout.
 */

// line graph a—b—c, start at a
const REGIONS: RegionDef[] = [{ id: "region.x", name: "X", description: "x" }];
const NODES: NodeDef[] = [
  { id: "node.x.a", regionId: "region.x", name: "Node A", description: "a plaza", adjacent: ["node.x.b"], start: true },
  { id: "node.x.b", regionId: "region.x", name: "Node B", description: "a store", adjacent: ["node.x.a", "node.x.c"] },
  { id: "node.x.c", regionId: "region.x", name: "Node C", description: "a clinic", adjacent: ["node.x.b"] },
];
const opts = { seed: "noise-seed", createdAt: "2026-07-05T00:00:00Z" };

function run(): { state: GameState; graph: RegionGraph } {
  return startRun(opts, REGIONS, NODES);
}
function take(state: GameState, graph: RegionGraph, choiceId: string): GameState {
  const choice = availableActions(state, graph).find((c) => c.id === choiceId);
  if (!choice) throw new Error(`choice "${choiceId}" not offered`);
  return applyAction(state, choice.action, graph).state;
}

// --- noiseOf: per-action volume -------------------------------------------------------------

describe("noiseOf (T14)", () => {
  it("ranks search louder than move, and rest/wait silent", () => {
    expect(noiseOf({ type: "rest", timeCost: 6 })).toBe(NOISE_REST);
    expect(noiseOf({ type: "wait" })).toBe(0);
    expect(noiseOf({ type: "move", timeCost: 2 })).toBe(NOISE_MOVE);
    expect(noiseOf({ type: "search", timeCost: 3 })).toBe(NOISE_SEARCH);
    expect(NOISE_SEARCH).toBeGreaterThan(NOISE_MOVE);
    expect(NOISE_MOVE).toBeGreaterThan(NOISE_REST);
  });

  it("honors an explicit params.noise override (the T15 firearm hook)", () => {
    expect(noiseOf({ type: "attack", params: { noise: 70 } })).toBe(70);
    expect(noiseOf({ type: "search", params: { noise: 3 } })).toBe(3); // override wins over the table
    expect(noiseOf({ type: "attack", params: { noise: 999 } })).toBe(100); // clamped
  });
});

// --- decay + deposit pure transforms --------------------------------------------------------

describe("decay & deposit (T14)", () => {
  it("decays every node by hours * rate, floored at 0, and keeps the same ref when silent", () => {
    const { state } = run();
    const noisy = depositNoiseAt(state.nodes, "node.x.a", 30);
    const after = decayAllNoise(noisy, 2);
    expect(after["node.x.a"]!.noise).toBe(30 - 2 * NOISE_DECAY_PER_HOUR);
    // an all-quiet map is returned unchanged (no needless allocation)
    expect(decayAllNoise(state.nodes, 5)).toBe(state.nodes);
    // decay can't go negative
    expect(decayAllNoise(depositNoiseAt(state.nodes, "node.x.a", 3), 10)["node.x.a"]!.noise).toBe(0);
  });

  it("deposits at a node (clamped) and no-ops an absent node or zero deposit", () => {
    const { state } = run();
    expect(depositNoiseAt(state.nodes, "node.x.a", 25)["node.x.a"]!.noise).toBe(25);
    expect(depositNoiseAt(state.nodes, "node.x.a", 0)).toBe(state.nodes);
    expect(depositNoiseAt(state.nodes, "node.x.nope", 25)).toBe(state.nodes);
    expect(depositNoiseAt(depositNoiseAt(state.nodes, "node.x.a", 90), "node.x.a", 50)["node.x.a"]!.noise).toBe(100);
  });

  it("clampNoise truncates and bounds", () => {
    expect(clampNoise(12.9)).toBe(12);
    expect(clampNoise(-4)).toBe(0);
    expect(clampNoise(140)).toBe(100);
  });
});

// --- stage 6 integration through applyAction ------------------------------------------------

describe("noise through the pipeline (T14)", () => {
  it("a search deposits noise where the player stands", () => {
    const { state, graph } = run();
    const after = take(state, graph, "search");
    expect(after.nodes["node.x.a"]!.noise).toBe(NOISE_SEARCH);
  });

  it("a move deposits at the destination, not the origin", () => {
    const { state, graph } = run();
    const after = take(state, graph, "move:node.x.b");
    // origin decayed (was 0) stays 0; destination carries the move's noise
    expect(after.nodes["node.x.a"]!.noise).toBe(0);
    expect(after.nodes["node.x.b"]!.noise).toBe(NOISE_MOVE);
  });

  it("resting is silent and lets a prior sound decay", () => {
    const { state, graph } = run();
    const noisy = take(state, graph, "search"); // a: 25
    const rested = take(noisy, graph, "rest"); // 6h pass, no new sound
    expect(rested.nodes["node.x.a"]!.noise).toBe(Math.max(0, NOISE_SEARCH - 6 * NOISE_DECAY_PER_HOUR));
  });

  it("keeps the M0 empty-turn contract: a silent zero-cost wait changes nothing", () => {
    const { state, graph } = run();
    expect(updateNodeNoise(state, { type: "wait" })).toBe(state);
    const { state: after } = applyAction(state, { type: "wait" }, graph);
    expect(after).toStrictEqual(state);
  });

  it("noise is integer and survives save/load", () => {
    const { state, graph } = run();
    const after = take(state, graph, "search");
    expect(Number.isInteger(after.nodes["node.x.a"]!.noise)).toBe(true);
    expect(loadGame(saveGame(after))).toStrictEqual(after);
  });
});

// --- the DoD property: the quiet path is legibly quieter ------------------------------------

describe("the quiet path is legibly quieter (T14 DoD · FR-SIM-06)", () => {
  const totalNoise = (s: GameState): number =>
    Object.values(s.nodes).reduce((sum, n) => sum + n.noise, 0);

  it("one search leaves sound behind; one rest leaves silence", () => {
    const { state, graph } = run();
    const searched = take(state, graph, "search");
    const rested = take(state, graph, "rest");
    expect(searched.nodes["node.x.a"]!.noise).toBe(NOISE_SEARCH);
    expect(rested.nodes["node.x.a"]!.noise).toBe(0);
  });

  it("a loud stretch leaves materially more sound than a quiet one of the same length", () => {
    // Two searches (the start node is not yet exhausted at searchPct < 100) vs two rests.
    let loud = run().state;
    const lg = run().graph;
    for (let i = 0; i < 2; i++) loud = take(loud, lg, "search");

    let quiet = run().state;
    const qg = run().graph;
    for (let i = 0; i < 2; i++) quiet = take(quiet, qg, "rest");

    expect(totalNoise(quiet)).toBe(0);
    expect(totalNoise(loud)).toBeGreaterThan(totalNoise(quiet));
    expect(totalNoise(loud)).toBeGreaterThanOrEqual(NOISE_SEARCH); // decay hasn't erased it
  });

  it("property: total node noise is never negative and never exceeds 100 per node", () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom("search", "rest", "move:node.x.b"), { minLength: 0, maxLength: 20 }), (script) => {
        let s = run().state;
        const g = run().graph;
        for (const id of script) {
          const c = availableActions(s, g).find((x) => x.id === id);
          if (!c) continue;
          s = applyAction(s, c.action, g).state;
          for (const n of Object.values(s.nodes)) {
            expect(n.noise).toBeGreaterThanOrEqual(0);
            expect(n.noise).toBeLessThanOrEqual(100);
            expect(Number.isInteger(n.noise)).toBe(true);
          }
        }
      }),
    );
  });
});
