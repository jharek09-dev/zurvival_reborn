import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  applyAction,
  auditTurn,
  availableActions,
  diffSystems,
  jsonEqual,
  startRun,
  TRACKED_SYSTEMS,
  type GameState,
  type NodeDef,
  type RegionDef,
} from "../src/index.js";

/**
 * T13 · FR-CORE-04 — every resolved turn changes >= 1 system, audited by telemetry.
 * Proves: (a) jsonEqual/diffSystems compare by value; (b) the pipeline reports the changed
 * systems on every turn; (c) `meta` (the clock) is excluded so the audit is non-vacuous;
 * (d) a resolved turn always moves a real system across random scripts (the invariant);
 * (e) the audit actually *catches* a clock-only no-op turn.
 */

const REGIONS: RegionDef[] = [{ id: "region.x", name: "X", description: "x" }];
const NODES: NodeDef[] = [
  { id: "node.x.a", regionId: "region.x", name: "Node A", description: "a plaza", adjacent: ["node.x.b"], start: true },
  { id: "node.x.b", regionId: "region.x", name: "Node B", description: "a store", adjacent: ["node.x.a", "node.x.c"] },
  { id: "node.x.c", regionId: "region.x", name: "Node C", description: "a clinic", adjacent: ["node.x.b"] },
];
const opts = { seed: "telemetry-seed", createdAt: "2026-07-05T00:00:00Z" };
const run = () => startRun(opts, REGIONS, NODES);

// --- jsonEqual (the honest, by-value comparator) ---------------------------------------------

describe("jsonEqual (T13)", () => {
  it("compares plain JSON structurally, ignoring key order and object identity", () => {
    expect(jsonEqual({ a: 1, b: [2, 3] }, { b: [2, 3], a: 1 })).toBe(true);
    expect(jsonEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(jsonEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(jsonEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false); // extra key
    expect(jsonEqual([1, 2], [1, 2, 3])).toBe(false); // length
    expect(jsonEqual(null, {})).toBe(false);
    expect(jsonEqual(0, false)).toBe(false); // no coercion across primitive types
  });

  it("a fresh identical object equals itself by value but is a different reference", () => {
    const a = { needs: { hunger: 0, thirst: 0, fatigue: 0 } };
    const b = { needs: { hunger: 0, thirst: 0, fatigue: 0 } };
    expect(a === b).toBe(false);
    expect(jsonEqual(a, b)).toBe(true); // reference-equality would be wrong here
  });
});

// --- diffSystems excludes meta ---------------------------------------------------------------

describe("diffSystems (T13)", () => {
  it("excludes meta: a change to only the clock/turn is not a system change", () => {
    const { state } = run();
    const clockOnly: GameState = { ...state, meta: { ...state.meta, turn: state.meta.turn + 1, hour: state.meta.hour + 2 } };
    expect(diffSystems(state, clockOnly)).toEqual([]);
  });

  it("reports the player system when only the player changed", () => {
    const { state } = run();
    const moved: GameState = {
      ...state,
      player: { ...state.player, location: "node.x.b" },
    };
    expect(diffSystems(state, moved)).toEqual(["player"]);
  });

  it("meta is not a tracked system", () => {
    expect((TRACKED_SYSTEMS as readonly string[]).includes("meta")).toBe(false);
  });
});

// --- the pipeline reports `changed` on every real action -------------------------------------

describe("pipeline change telemetry (T13 · FR-CORE-04)", () => {
  function take(state: GameState, graph: ReturnType<typeof run>["graph"], id: string) {
    const choice = availableActions(state, graph).find((c) => c.id === id)!;
    return applyAction(state, choice.action, graph);
  }

  it("move reports the player (location) and nodes (visit + fog) systems", () => {
    const { state, graph } = run();
    const res = take(state, graph, "move:node.x.b");
    expect(res.changed).toContain("player");
    expect(res.changed).toContain("nodes");
  });

  it("search reports the nodes system (and player needs drift)", () => {
    const { state, graph } = run();
    const res = take(state, graph, "search");
    expect(res.changed).toContain("nodes");
    expect(res.changed).toContain("player");
  });

  it("rest reports the player system (fatigue/needs)", () => {
    const { state, graph } = run();
    const res = take(state, graph, "rest");
    expect(res.changed).toContain("player");
  });

  it("an inert wait resolves no turn and reports no changed system", () => {
    const { state, graph } = run();
    const res = applyAction(state, { type: "wait" }, graph);
    expect(res.changed).toEqual([]);
    expect(res.state.meta.turn).toBe(state.meta.turn); // no turn resolved
  });
});

// --- the invariant across random scripts (property) ------------------------------------------

describe("FR-CORE-04 invariant over random play (T13)", () => {
  it("every resolved turn changes >= 1 tracked system", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 1, maxLength: 40 }), (picks) => {
        let { state, graph } = run();
        for (const pick of picks) {
          const choices = availableActions(state, graph);
          if (choices.length === 0) break;
          const choice = choices[pick % choices.length]!;
          const before = state;
          const res = applyAction(before, choice.action, graph);
          state = res.state;
          const audit = auditTurn(before, state);
          // a costed action resolves a turn; a resolved turn must move a real system
          if (audit.resolved) {
            expect(audit.ok).toBe(true);
            expect(res.changed.length).toBeGreaterThan(0);
            expect(res.changed).toEqual(audit.changedSystems);
          }
        }
      }),
    );
  });
});

// --- the audit is honest: it catches a no-consequence turn -----------------------------------

describe("audit catches a no-op turn (T13)", () => {
  it("a resolved turn that moved only the clock fails the audit", () => {
    const { state } = run();
    // hand-build the exact thing FR-CORE-04 forbids: the turn counter advanced, nothing else.
    const noOp: GameState = { ...state, meta: { ...state.meta, turn: state.meta.turn + 1, hour: state.meta.hour + 2 } };
    const audit = auditTurn(state, noOp);
    expect(audit.resolved).toBe(true);
    expect(audit.changedSystems).toEqual([]);
    expect(audit.ok).toBe(false); // the audit refuses to rubber-stamp it
  });

  it("a non-resolved turn (no counter advance) passes vacuously", () => {
    const { state } = run();
    const audit = auditTurn(state, state);
    expect(audit.resolved).toBe(false);
    expect(audit.ok).toBe(true);
  });
});
