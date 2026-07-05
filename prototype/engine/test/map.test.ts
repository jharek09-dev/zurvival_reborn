import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  MapError,
  areAdjacent,
  buildRegionGraph,
  discoverAround,
  discoveredNodeIds,
  isDiscovered,
  isVisited,
  neighborsOf,
  seedNodeState,
  seedRegionState,
  startRun,
  type NodeDef,
  type RegionDef,
} from "../src/index.js";

// --- plain-JSON / integer discipline helpers (mirrors state.test.ts) -------------------------

function assertPlainJson(value: unknown, path = "$"): void {
  if (value === null) return;
  const t = typeof value;
  if (t === "string" || t === "boolean") return;
  if (t === "number") {
    if (!Number.isFinite(value)) throw new Error(`${path}: non-finite number`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertPlainJson(v, `${path}[${i}]`));
    return;
  }
  if (t === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      throw new Error(`${path}: non-plain object (${proto?.constructor?.name})`);
    }
    for (const [k, v] of Object.entries(value as object)) {
      if (v === undefined) throw new Error(`${path}.${k}: undefined`);
      assertPlainJson(v, `${path}.${k}`);
    }
    return;
  }
  throw new Error(`${path}: forbidden type ${t}`);
}

function assertIntegerLeaves(value: unknown, path = "$"): void {
  if (typeof value === "number") {
    if (!Number.isInteger(value)) throw new Error(`${path}: non-integer ${value}`);
    return;
  }
  if (Array.isArray(value)) value.forEach((v, i) => assertIntegerLeaves(v, `${path}[${i}]`));
  else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) assertIntegerLeaves(v, `${path}.${k}`);
  }
}

// --- small valid fixture: a—b—c line, start at a ---------------------------------------------

const REGIONS: RegionDef[] = [
  { id: "region.x", name: "X", description: "x", baseline: { threat: 10, loot: 50 } },
];
const NODES: NodeDef[] = [
  { id: "node.x.a", regionId: "region.x", name: "A", description: "a", adjacent: ["node.x.b"], start: true },
  { id: "node.x.b", regionId: "region.x", name: "B", description: "b", adjacent: ["node.x.a", "node.x.c"] },
  { id: "node.x.c", regionId: "region.x", name: "C", description: "c", adjacent: ["node.x.b"], claimable: true },
];

const opts = { seed: "map-seed", createdAt: "2026-07-05T00:00:00Z" };

describe("buildRegionGraph — integrity (T11 · FR-MAP-01)", () => {
  it("builds an indexed graph and resolves the single start node", () => {
    const g = buildRegionGraph(REGIONS, NODES);
    expect(g.startNodeId).toBe("node.x.a");
    expect(Object.keys(g.nodes).sort()).toEqual(["node.x.a", "node.x.b", "node.x.c"]);
    expect(Object.keys(g.regions)).toEqual(["region.x"]);
  });

  it("is order-independent", () => {
    const a = buildRegionGraph(REGIONS, NODES);
    const b = buildRegionGraph(REGIONS, [...NODES].reverse());
    expect(b.startNodeId).toBe(a.startNodeId);
    expect(Object.keys(b.nodes).sort()).toEqual(Object.keys(a.nodes).sort());
  });

  it("rejects an empty node set", () => {
    expect(() => buildRegionGraph(REGIONS, [])).toThrow(MapError);
  });

  it("rejects a node in an unknown region", () => {
    const bad: NodeDef[] = [{ id: "node.x.a", regionId: "region.ghost", name: "A", description: "a", adjacent: [], start: true }];
    expect(() => buildRegionGraph(REGIONS, bad)).toThrow(/unknown region/);
  });

  it("rejects a route to an unknown node", () => {
    const bad: NodeDef[] = [{ id: "node.x.a", regionId: "region.x", name: "A", description: "a", adjacent: ["node.x.void"], start: true }];
    expect(() => buildRegionGraph(REGIONS, bad)).toThrow(/unknown node/);
  });

  it("rejects an asymmetric route", () => {
    const bad: NodeDef[] = [
      { id: "node.x.a", regionId: "region.x", name: "A", description: "a", adjacent: ["node.x.b"], start: true },
      { id: "node.x.b", regionId: "region.x", name: "B", description: "b", adjacent: [] },
    ];
    expect(() => buildRegionGraph(REGIONS, bad)).toThrow(/asymmetric/);
  });

  it("rejects a self-loop", () => {
    const bad: NodeDef[] = [{ id: "node.x.a", regionId: "region.x", name: "A", description: "a", adjacent: ["node.x.a"], start: true }];
    expect(() => buildRegionGraph(REGIONS, bad)).toThrow(/adjacent to itself/);
  });

  it("rejects zero and multiple start nodes", () => {
    const none = NODES.map((n) => ({ ...n, start: false }));
    expect(() => buildRegionGraph(REGIONS, none)).toThrow(/no start node/);
    const many = NODES.map((n) => ({ ...n, start: true }));
    expect(() => buildRegionGraph(REGIONS, many)).toThrow(/multiple start/);
  });

  it("rejects a duplicate node id", () => {
    const dup = [...NODES, NODES[0]!];
    expect(() => buildRegionGraph(REGIONS, dup)).toThrow(/duplicate node/);
  });

  it("rejects a disconnected graph", () => {
    const island: NodeDef[] = [
      ...NODES,
      { id: "node.x.island", regionId: "region.x", name: "I", description: "i", adjacent: [] },
    ];
    expect(() => buildRegionGraph(REGIONS, island)).toThrow(/disconnected/);
  });
});

describe("adjacency queries", () => {
  const g = buildRegionGraph(REGIONS, NODES);
  it("neighborsOf returns a copy, not the content array", () => {
    const n = neighborsOf(g, "node.x.b");
    expect([...n].sort()).toEqual(["node.x.a", "node.x.c"]);
    expect(n).not.toBe(g.nodes["node.x.b"]!.adjacent);
    expect(neighborsOf(g, "node.x.missing")).toEqual([]);
  });
  it("areAdjacent reflects the edges", () => {
    expect(areAdjacent(g, "node.x.a", "node.x.b")).toBe(true);
    expect(areAdjacent(g, "node.x.a", "node.x.c")).toBe(false);
  });
});

describe("seedRegionState / seedNodeState", () => {
  it("seeds region baselines with defaults and passable roads", () => {
    const regions = seedRegionState(REGIONS);
    expect(regions["region.x"]).toMatchObject({ threat: 10, loot: 50, zombieDensity: 0, fire: 0, roads: 100 });
    assertIntegerLeaves(regions);
  });

  it("clamps out-of-range baselines to 0..100 integers", () => {
    const regions = seedRegionState([{ id: "region.y", name: "Y", description: "y", baseline: { threat: 250, loot: -9 } }]);
    expect(regions["region.y"]!.threat).toBe(100);
    expect(regions["region.y"]!.loot).toBe(0);
  });

  it("seeds every node fog-hidden, memory zeroed, never visited", () => {
    const nodes = seedNodeState(NODES);
    for (const id of Object.keys(nodes)) {
      const n = nodes[id]!;
      expect(n.discovered).toBe(false);
      expect(n.lastVisit).toBeNull();
      expect(n).toMatchObject({ searchPct: 0, damage: 0, corpses: 0, blood: 0, noise: 0, traps: [], occupants: [], discoveries: [], playerNotes: [] });
    }
  });
});

describe("discoverAround — fog reveal (T11 · FR-MAP-02)", () => {
  const g = buildRegionGraph(REGIONS, NODES);
  it("reveals a node and its neighbors only", () => {
    const nodes = discoverAround(seedNodeState(NODES), g, "node.x.a");
    expect(discoveredNodeIds(nodes)).toEqual(["node.x.a", "node.x.b"]); // c is two steps away
    expect(nodes["node.x.c"]!.discovered).toBe(false);
  });
  it("is immutable and idempotent", () => {
    const seeded = seedNodeState(NODES);
    const once = discoverAround(seeded, g, "node.x.a");
    const twice = discoverAround(once, g, "node.x.a");
    expect(seeded["node.x.a"]!.discovered).toBe(false); // original untouched
    expect(twice).toBe(once); // no change ⇒ same reference
  });
});

describe("startRun — bootstrap a playable run (T11)", () => {
  it("places the player on the start node, visited today, fog revealed around it", () => {
    const { state, graph } = startRun(opts, REGIONS, NODES);
    expect(state.player.location).toBe("node.x.a");
    expect(graph.startNodeId).toBe("node.x.a");
    expect(isVisited(state.nodes["node.x.a"]!)).toBe(true);
    expect(state.nodes["node.x.a"]!.lastVisit).toBe(state.meta.day);
    expect(isVisited(state.nodes["node.x.b"]!)).toBe(false);
    expect(isDiscovered(state.nodes["node.x.a"]!)).toBe(true);
    expect(isDiscovered(state.nodes["node.x.b"]!)).toBe(true);
    expect(isDiscovered(state.nodes["node.x.c"]!)).toBe(false);
    expect(state.regions["region.x"]).toBeDefined();
  });

  it("produces plain-JSON, integer-only, round-trippable state", () => {
    const { state } = startRun(opts, REGIONS, NODES);
    assertPlainJson(state);
    assertIntegerLeaves(state);
    expect(JSON.parse(JSON.stringify(state))).toStrictEqual(state);
  });

  it("is deterministic — identical inputs give deep-equal state", () => {
    const a = startRun(opts, REGIONS, NODES).state;
    const b = startRun(opts, REGIONS, NODES).state;
    expect(a).toStrictEqual(b);
  });
});

// --- property: on any connected line graph, startRun reveals exactly start + its neighbors ----

describe("fog invariant (property)", () => {
  it("after startRun, discovered = start ∪ neighbors(start)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 8 }), (n) => {
        // Build a line node.p.0 — node.p.1 — ... — node.p.(n-1), start at 0.
        const nodes: NodeDef[] = Array.from({ length: n }, (_, i) => ({
          id: `node.p.n${i}`,
          regionId: "region.p",
          name: `N${i}`,
          description: "n",
          adjacent: [i > 0 ? `node.p.n${i - 1}` : "", i < n - 1 ? `node.p.n${i + 1}` : ""].filter(Boolean),
          start: i === 0,
        }));
        const regions: RegionDef[] = [{ id: "region.p", name: "P", description: "p" }];
        const { state } = startRun(opts, regions, nodes);
        const expected = n === 1 ? ["node.p.n0"] : ["node.p.n0", "node.p.n1"];
        expect(discoveredNodeIds(state.nodes)).toEqual(expected);
      }),
    );
  });
});
