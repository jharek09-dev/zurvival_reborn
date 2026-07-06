import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  WORLD_SIM_LAYERS,
  advanceWorld,
  getLayer,
  runLayer,
  tickWorld,
  startRun,
  saveGame,
  loadGame,
  type GameState,
  type NodeDef,
  type RegionDef,
  type RegionGraph,
} from "../src/index.js";

/**
 * T23 — six independently-tickable world-sim layers (FR-SIM-01). The world must be advanceable with
 * NO player action, deterministically and save-losslessly. At T23 only the `regions` layer is live
 * (the T17 contest); the other five are structured no-ops that T24–T27 fill in.
 */

const REGIONS: RegionDef[] = [
  { id: "region.x", name: "X", description: "x", baseline: { loot: 90, survivorActivity: 60, threat: 30, zombieDensity: 40 } },
];
const NODES: NodeDef[] = [
  { id: "node.x.a", regionId: "region.x", name: "A", description: "a", adjacent: ["node.x.b"], start: true },
  { id: "node.x.b", regionId: "region.x", name: "B", description: "b", adjacent: ["node.x.a"] },
];
const opts = { seed: "world-seed", createdAt: "2026-07-05T00:00:00Z" };
const run = (): { state: GameState; graph: RegionGraph } => startRun(opts, REGIONS, NODES);

describe("the six layers, in canonical execution order (T23 · FR-SIM-01)", () => {
  it("registers exactly the six layers, in pipeline-stage order", () => {
    expect(WORLD_SIM_LAYERS.map((l) => l.id)).toStrictEqual([
      "zombies",
      "regions",
      "weather",
      "timeOfDay",
      "hordes",
      "director",
    ]);
  });

  it("getLayer resolves every id and rejects an unknown one", () => {
    for (const l of WORLD_SIM_LAYERS) expect(getLayer(l.id)).toBe(l);
    // @ts-expect-error — unknown id is a programming error, guarded at runtime
    expect(() => getLayer("nope")).toThrow();
  });
});

describe("layers are independently tickable (T23 · FR-SIM-01)", () => {
  it("each no-op layer leaves the whole state untouched (reference-identical)", () => {
    const { state, graph } = run();
    for (const id of ["timeOfDay", "director"] as const) {
      expect(runLayer(state, id, { hours: 5, graph })).toBe(state);
    }
  });

  it("the live regions layer moves only the regions slice, nothing else", () => {
    const { state, graph } = run();
    const after = runLayer(state, "regions", { hours: 6, graph });
    expect(after.regions).not.toStrictEqual(state.regions); // rivals thinned loot
    // every other tracked slice is untouched
    expect(after.player).toBe(state.player);
    expect(after.nodes).toBe(state.nodes);
    expect(after.world).toBe(state.world);
    expect(after.hordes).toBe(state.hordes);
  });
});

describe("advanceWorld — the world moves with no player action (T23 · FR-SIM-01)", () => {
  it("advances the world off-screen (regions drift with nothing submitted)", () => {
    const { state, graph } = run();
    const before = state.regions["region.x"]!.loot;
    const after = advanceWorld(state, 12, graph);
    expect(after.regions["region.x"]!.loot).toBeLessThan(before);
    expect(after.meta).toBe(state.meta); // it moves the world, not the clock/turn
  });

  it("is inert for a zero-hour advance", () => {
    const { state, graph } = run();
    expect(advanceWorld(state, 0, graph)).toBe(state);
  });

  it("is deterministic: same state + hours + seed ⇒ byte-identical", () => {
    const a = run();
    const b = run();
    expect(JSON.stringify(advanceWorld(a.state, 24, a.graph))).toBe(
      JSON.stringify(advanceWorld(b.state, 24, b.graph)),
    );
  });

  it("is save-lossless: a state carried through advanceWorld round-trips", () => {
    const { state, graph } = run();
    const advanced = advanceWorld(state, 30, graph);
    expect(loadGame(saveGame(advanced))).toStrictEqual(advanced);
  });

  it("never mutates its input", () => {
    const { state, graph } = run();
    const snapshot = JSON.stringify(state);
    advanceWorld(state, 40, graph);
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it("determinism holds for arbitrary hours (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 240 }), (hours) => {
        const a = run();
        const b = run();
        expect(JSON.stringify(advanceWorld(a.state, hours, a.graph))).toBe(
          JSON.stringify(advanceWorld(b.state, hours, b.graph)),
        );
      }),
    );
  });
});

describe("tickWorld folds all layers in canonical order (T23)", () => {
  it("equals running the layers by hand, in order", () => {
    const { state, graph } = run();
    const ctx = { hours: 8, graph };
    let byHand: GameState = state;
    for (const l of WORLD_SIM_LAYERS) byHand = l.tick(byHand, ctx);
    expect(tickWorld(state, ctx)).toStrictEqual(byHand);
  });
});
