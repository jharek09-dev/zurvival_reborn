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

describe("the regions layer hands drift the graph (T78 plumbing)", () => {
  it("with the graph, a region at its authored point stays put; without it, the absolute targets pull it away", () => {
    // Against the unfixed layer body (`driftRegions(state, ctx.hours)`) the graph never reached drift
    // and the region sank toward the absolute fixed point with the graph present too.
    const { state, graph } = run();
    // Disable repopulation so the only thing that can move the regions slice is drift.
    const s: GameState = { ...state, world: { ...state.world, flags: { ...state.world.flags, "repopulate.disabled": true } } };
    let anchored = s;
    let loose = s;
    for (let i = 0; i < 10; i++) {
      anchored = runLayer(anchored, "regions", { hours: 24, graph });
      loose = runLayer(loose, "regions", { hours: 24 });
    }
    expect(Math.abs(anchored.regions["region.x"]!.threat - 30)).toBeLessThanOrEqual(2);
    expect(loose.regions["region.x"]!.threat).toBeLessThan(25);
  });
});

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
  it("the timeOfDay layer moves only the world slice (the diurnal threat tide, T28)", () => {
    const { state, graph } = run();
    const after = runLayer(state, "timeOfDay", { hours: 5, graph });
    // dawn pulls globalThreat up from its 0 seed toward the phase target — world moves, nothing else
    expect(after.world.globalThreat).toBeGreaterThan(state.world.globalThreat);
    expect(after.regions).toBe(state.regions);
    expect(after.nodes).toBe(state.nodes);
    expect(after.player).toBe(state.player);
    expect(after.hordes).toBe(state.hordes);
  });

  it("the director layer moves only the world/regions danger dials, nothing else (T30)", () => {
    const { state, graph } = run();
    const after = runLayer(state, "director", { hours: 5, graph });
    // the director only ever nudges danger dials (regions/world); it never touches the player or map
    expect(after.player).toBe(state.player);
    expect(after.nodes).toBe(state.nodes);
    expect(after.hordes).toBe(state.hordes);
  });

  it("the live regions layer moves the regions slice and (T75) nodes, and nothing else", () => {
    const { state, graph } = run();
    const after = runLayer(state, "regions", { hours: 6, graph });
    expect(after.regions).not.toStrictEqual(state.regions); // rivals thinned loot

    // T75: repopulation lives in this layer, so `nodes` is now a legitimate output of it — this
    // assertion USED to be `expect(after.nodes).toBe(state.nodes)` and passed only because one density
    // roll happened to fail on this fixture at 6 hours. Assert the real boundary instead: the layer
    // writes regions + nodes + rng, and never the player, the world dials or the hordes.
    const long = runLayer(state, "regions", { hours: 30, graph });
    expect(long.nodes).not.toBe(state.nodes); // bodies arrived over a longer span
    for (const [id, node] of Object.entries(long.nodes)) {
      const before = state.nodes[id]!;
      // the only field repopulation may move is the roster triple; everything else is carried through
      expect({ ...node, walkers: 0, roster: [], zombieTypes: [] }).toStrictEqual({ ...before, walkers: 0, roster: [], zombieTypes: [] });
      expect(node.walkers).toBeGreaterThanOrEqual(before.walkers); // it never culls
    }

    // every other tracked slice is untouched, on both spans
    for (const out of [after, long]) {
      expect(out.player).toBe(state.player);
      expect(out.world).toBe(state.world);
      expect(out.hordes).toBe(state.hordes);
      expect(out.meta).toBe(state.meta);
    }
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
