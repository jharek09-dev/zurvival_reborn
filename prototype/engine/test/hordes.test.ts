import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  FIRE_NOISE,
  HORDE_AWARENESS,
  REPATH_NOISE,
  applyAction,
  availableActions,
  loudestAudible,
  seedStarterHordes,
  startRun,
  tickHordes,
  type GameState,
  type Horde,
  type NodeDef,
  type RegionDef,
  type RegionGraph,
} from "../src/index.js";

/**
 * T26 — migrating hordes that re-path to noise (FR-SIM-07, FR-CBT-08). A logged gunshot within a
 * horde's hearing redirects it; without a stimulus it migrates. It is routed by noise, never fought.
 */

// A five-node line: n0—n1—n2—n3—n4, start at n0.
const REGIONS: RegionDef[] = [{ id: "region.x", name: "X", description: "x", baseline: { loot: 50 } }];
const NODES: NodeDef[] = [0, 1, 2, 3, 4].map((i) => ({
  id: `node.x.${i}`,
  regionId: "region.x",
  name: `N${i}`,
  description: `n${i}`,
  adjacent: [i - 1, i + 1].filter((j) => j >= 0 && j <= 4).map((j) => `node.x.${j}`),
  ...(i === 0 ? { start: true } : {}),
}));
const opts = { seed: "horde-seed", createdAt: "2026-07-05T00:00:00Z" };
const run = (): { state: GameState; graph: RegionGraph } => startRun(opts, REGIONS, NODES);

const withHorde = (state: GameState, pos: string, patch: Partial<Horde> = {}): GameState => ({
  ...state,
  hordes: [{ id: "horde.1", size: 20, pos, dest: null, speed: 1, awareness: HORDE_AWARENESS, types: ["zombie.walker"], ...patch }],
});
const gunshotAt = (state: GameState, id: string): GameState => ({
  ...state,
  nodes: { ...state.nodes, [id]: { ...state.nodes[id]!, noise: FIRE_NOISE } },
});

describe("seeding (T26)", () => {
  it("places one starter horde away from the start node", () => {
    const { state } = run();
    expect(state.hordes).toHaveLength(1);
    expect(state.hordes[0]!.pos).not.toBe("node.x.0");
  });
  it("seeds nothing for an empty graph shape", () => {
    expect(seedStarterHordes({ regions: {}, nodes: {}, startNodeId: "" } as unknown as RegionGraph)).toStrictEqual([]);
  });
});

describe("loudestAudible — a horde hears within its awareness (T26)", () => {
  it("finds a gunshot within range and ignores ordinary sound", () => {
    const { state, graph } = run();
    const shot = gunshotAt(state, "node.x.2");
    expect(loudestAudible(shot, graph, "node.x.1", HORDE_AWARENESS)).toBe("node.x.2"); // 1 hop away
    // a search-level sound (below the re-path bar) never redirects a horde
    const faint = { ...state, nodes: { ...state.nodes, "node.x.2": { ...state.nodes["node.x.2"]!, noise: REPATH_NOISE - 1 } } };
    expect(loudestAudible(faint, graph, "node.x.1", HORDE_AWARENESS)).toBeNull();
  });
  it("does not hear a gunshot beyond its awareness", () => {
    const { state, graph } = run();
    const shot = gunshotAt(state, "node.x.4");
    expect(loudestAudible(shot, graph, "node.x.0", HORDE_AWARENESS)).toBeNull(); // 4 hops away
  });
});

describe("a gunshot re-paths a nearby horde — the DoD (T26 · FR-SIM-07)", () => {
  it("re-paths toward a gunshot within hearing, and steps toward it", () => {
    const { state, graph } = run();
    const s = gunshotAt(withHorde(state, "node.x.0"), "node.x.2");
    const after = tickHordes(s, 6, graph); // a rest's worth of hours
    expect(after.hordes[0]!.dest).toBe("node.x.2");
    expect(after.hordes[0]!.pos).toBe("node.x.1"); // one step toward the shot
  });

  it("does NOT chase a gunshot beyond hearing (it wanders instead)", () => {
    const { state, graph } = run();
    const s = gunshotAt(withHorde(state, "node.x.0"), "node.x.4"); // 4 hops, awareness 2
    const after = tickHordes(s, 6, graph);
    expect(after.hordes[0]!.dest).not.toBe("node.x.4");
  });

  it("re-paths in the whole target share of in-range cases (rate over seeds)", () => {
    let repathed = 0;
    const trials = 40;
    for (let k = 0; k < trials; k++) {
      const { state, graph } = startRun({ seed: `shot-${k}`, createdAt: opts.createdAt }, REGIONS, NODES);
      const s = gunshotAt(withHorde(state, "node.x.0"), "node.x.2"); // 2 hops, in range
      if (tickHordes(s, 4, graph).hordes[0]!.dest === "node.x.2") repathed++;
    }
    expect(repathed / trials).toBeGreaterThanOrEqual(0.9); // in-range gunshots reliably pull the horde
  });
});

describe("migration & discipline (T26)", () => {
  it("a horde with no stimulus wanders deterministically over the graph", () => {
    const { state, graph } = run();
    const s = withHorde(state, "node.x.2");
    const a = tickHordes(s, 8, graph);
    const b = tickHordes(s, 8, graph);
    expect(JSON.stringify(a.hordes)).toBe(JSON.stringify(b.hordes));
    expect(a.hordes[0]!.pos).not.toBe("node.x.2"); // it migrated from where it stood
  });

  it("is inert without a graph, with no hordes, or on a zero-hour tick", () => {
    const { state, graph } = run();
    const s = withHorde(state, "node.x.2");
    expect(tickHordes(s, 6, undefined)).toBe(s);
    expect(tickHordes(s, 0, graph)).toBe(s);
    expect(tickHordes({ ...state, hordes: [] }, 6, graph).hordes).toStrictEqual([]);
  });

  it("never lands a horde on a non-node (property over random play)", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 24 }), { minLength: 1, maxLength: 20 }), (hoursSeq) => {
        let { state, graph } = run();
        const ids = new Set(Object.keys(state.nodes));
        for (const hours of hoursSeq) {
          state = tickHordes(state, hours, graph);
          for (const h of state.hordes) expect(ids.has(h.pos)).toBe(true);
        }
      }),
    );
  });

  it("FR-CBT-08: a horde is never a combat target — it offers no fight action", () => {
    const { state, graph } = run();
    // stand the player where the horde is; there is still no 'fight the horde' choice.
    const here = state.hordes[0]!.pos;
    const s = { ...state, player: { ...state.player, location: here } };
    const ids = availableActions(s, graph).map((c) => c.id);
    expect(ids.some((i) => i.includes("horde"))).toBe(false);
  });
});
