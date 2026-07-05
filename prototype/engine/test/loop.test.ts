import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  advanceClock,
  applyAction,
  availableActions,
  loadGame,
  phaseOf,
  saveGame,
  sceneOf,
  startRun,
  IllegalActionError,
  MOVE_COST,
  REST_COST,
  REST_RECOVERY,
  SEARCH_COST,
  SEARCH_GAIN,
  type Action,
  type GameState,
  type RegionGraph,
  type NodeDef,
  type RegionDef,
} from "../src/index.js";

// --- fixture: line graph a—b—c, start at a ---------------------------------------------------

const REGIONS: RegionDef[] = [{ id: "region.x", name: "X", description: "x" }];
const NODES: NodeDef[] = [
  { id: "node.x.a", regionId: "region.x", name: "Node A", description: "a plaza", adjacent: ["node.x.b"], start: true },
  { id: "node.x.b", regionId: "region.x", name: "Node B", description: "a store", adjacent: ["node.x.a", "node.x.c"] },
  { id: "node.x.c", regionId: "region.x", name: "Node C", description: "a clinic", adjacent: ["node.x.b"] },
];
const opts = { seed: "loop-seed", createdAt: "2026-07-05T00:00:00Z" };

function run(): { state: GameState; graph: RegionGraph } {
  return startRun(opts, REGIONS, NODES);
}
/** Submit the offered choice with the given id; fail loudly if it isn't offered. */
function take(state: GameState, graph: RegionGraph, choiceId: string) {
  const choice = availableActions(state, graph).find((c) => c.id === choiceId);
  if (!choice) throw new Error(`choice "${choiceId}" not offered`);
  return applyAction(state, choice.action, graph);
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

// --- clock (FR-CORE-03) ----------------------------------------------------------------------

describe("clock (T12 · FR-CORE-03)", () => {
  it("maps hours to phases at the boundaries", () => {
    const cases: Array<[number, string]> = [
      [5, "dawn"], [7, "dawn"], [8, "morning"], [11, "morning"], [12, "midday"], [16, "midday"],
      [17, "evening"], [20, "evening"], [21, "night"], [23, "night"], [0, "night"], [4, "night"],
    ];
    for (const [h, p] of cases) expect(phaseOf(h)).toBe(p);
  });

  it("advances hours, rolls the day at midnight, and ticks the turn", () => {
    const m = { version: 1, seed: "s", createdAt: "t", day: 1, hour: 23, phase: "night" as const, turn: 4 };
    const next = advanceClock(m, 3);
    expect(next).toMatchObject({ day: 2, hour: 2, phase: "night", turn: 5 });
  });

  it("never moves time backward (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 23 }), fc.integer({ min: -5, max: 12 }), (hour, hrs) => {
        const m = { version: 1, seed: "s", createdAt: "t", day: 1, hour, phase: "dawn" as const, turn: 0 };
        const next = advanceClock(m, hrs);
        const before = m.day * 24 + m.hour;
        const after = next.day * 24 + next.hour;
        expect(after).toBeGreaterThanOrEqual(before);
        expect(next.turn).toBe(1);
      }),
    );
  });
});

// --- initial scene (FR-CORE-05) --------------------------------------------------------------

describe("initial scene answers the Four Questions (T12 · FR-CORE-05)", () => {
  it("offers move-to-known-neighbor, search, and rest from the start node", () => {
    const { state, graph } = run();
    const scene = sceneOf(state, graph);
    expect(scene.location).toBe("node.x.a"); // where
    expect(scene.narration.length).toBeGreaterThan(0); // what's happening
    const ids = scene.choices.map((c) => c.id).sort(); // what can I do
    expect(ids).toEqual(["move:node.x.b", "rest", "search"]);
    for (const c of scene.choices) expect(c.timeCost).toBeGreaterThan(0);
  });

  it("does not offer travel to an undiscovered node", () => {
    const { state, graph } = run();
    // c is two hops from a and starts fogged, so no move:node.x.c is offered.
    expect(availableActions(state, graph).some((c) => c.id === "move:node.x.c")).toBe(false);
  });
});

// --- move (FR-CORE-01/03, FR-MAP-02/03) ------------------------------------------------------

describe("move", () => {
  it("relocates the player, visits + reveals around the destination, spends time", () => {
    const { state, graph } = run();
    const { state: after, scene } = take(state, graph, "move:node.x.b");
    expect(after.player.location).toBe("node.x.b");
    expect(after.nodes["node.x.b"]!.lastVisit).toBe(after.meta.day);
    expect(after.nodes["node.x.c"]!.discovered).toBe(true); // c revealed by standing at b
    expect(after.meta.turn).toBe(state.meta.turn + 1);
    expect(after.meta.hour).toBe(state.meta.hour + MOVE_COST);
    expect(scene.location).toBe("node.x.b");
    // now at b, travel to c becomes available
    expect(availableActions(after, graph).some((c) => c.id === "move:node.x.c")).toBe(true);
  });
});

// --- search (FR-SIM-02) ----------------------------------------------------------------------

describe("search", () => {
  it("advances node searchPct and spends time; exhausts after repeats", () => {
    const { state, graph } = run();
    const t1 = take(state, graph, "search").state;
    expect(t1.nodes["node.x.a"]!.searchPct).toBe(SEARCH_GAIN);
    expect(t1.meta.hour).toBe(state.meta.hour + SEARCH_COST);
    const t2 = take(t1, graph, "search").state;
    const t3 = take(t2, graph, "search").state;
    expect(t3.nodes["node.x.a"]!.searchPct).toBe(100);
    // fully searched ⇒ search no longer offered
    expect(availableActions(t3, graph).some((c) => c.id === "search")).toBe(false);
  });
});

// --- rest ------------------------------------------------------------------------------------

describe("rest", () => {
  it("recovers fatigue and spends time", () => {
    const { state, graph } = run();
    // tire the player out first (two searches raise fatigue by SEARCH_COST each)
    const tired = take(take(state, graph, "search").state, graph, "search").state;
    const fatigueBefore = tired.player.condition.needs.fatigue;
    expect(fatigueBefore).toBeGreaterThan(0);
    const { state: rested } = take(tired, graph, "rest");
    expect(rested.player.condition.needs.fatigue).toBe(Math.max(0, fatigueBefore - REST_RECOVERY));
    expect(rested.meta.hour).toBe((tired.meta.hour + REST_COST) % 24);
  });
});

// --- validation (FR-CORE-01) -----------------------------------------------------------------

describe("action validation (T12 · FR-CORE-01)", () => {
  it("rejects an action the current node did not offer", () => {
    const { state, graph } = run();
    const illegal: Action = { type: "move", choiceId: "move:node.x.c", params: { to: "node.x.c" } };
    expect(() => applyAction(state, illegal, graph)).toThrow(IllegalActionError);
  });

  it("rejects a bogus choice id", () => {
    const { state, graph } = run();
    expect(() => applyAction(state, { type: "search", choiceId: "nope" }, graph)).toThrow(IllegalActionError);
  });
});

// --- invariants: time always advances, determinism, integers, safe-to-stop -------------------

describe("loop invariants (T12)", () => {
  it("every core action advances time and the turn counter (FR-CORE-03)", () => {
    const { state, graph } = run();
    for (const id of ["move:node.x.b", "search", "rest"]) {
      const fresh = run();
      const before = fresh.state;
      const after = take(before, fresh.graph, id).state;
      expect(after.meta.turn).toBe(before.meta.turn + 1);
      expect(after.meta.day * 24 + after.meta.hour).toBeGreaterThan(before.meta.day * 24 + before.meta.hour);
    }
    void state;
    void graph;
  });

  it("is deterministic and integer-only", () => {
    const a = take(run().state, run().graph, "move:node.x.b").state;
    const b = take(run().state, run().graph, "move:node.x.b").state;
    expect(a).toStrictEqual(b);
    assertIntegerLeaves(a);
  });

  it("is safe-to-stop: state round-trips through save/load after every turn (FR-CORE-07)", () => {
    let { state } = run();
    const graph = run().graph;
    for (const id of ["search", "move:node.x.b", "move:node.x.c", "rest"]) {
      state = take(state, graph, id).state;
      expect(loadGame(saveGame(state))).toStrictEqual(state);
    }
    expect(state.player.location).toBe("node.x.c");
  });

  it("a wait with a graph is inert (no offered choice, no state change)", () => {
    const { state, graph } = run();
    const { state: after } = applyAction(state, { type: "wait" }, graph);
    expect(after).toStrictEqual(state);
  });
});
