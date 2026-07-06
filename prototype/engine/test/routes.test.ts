import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  applyAction,
  availableActions,
  advanceWorld,
  loadGame,
  saveGame,
  startRun,
  tickRoutes,
  routeKey,
  routeWear,
  routeCondition,
  conditionOf,
  extraCostOf,
  isBlocked,
  targetWear,
  ROUTE_BLOCKED_AT,
  WEATHER_STORM,
  WEATHER_CLEAR,
  MOVE_COST,
  type GameState,
  type RegionGraph,
  type NodeDef,
  type RegionDef,
} from "../src/index.js";

const REGIONS: RegionDef[] = [{ id: "region.x", name: "X", description: "x", baseline: { loot: 60 } }];
const NODES: NodeDef[] = [
  { id: "node.x.a", regionId: "region.x", name: "A", description: "a plaza", adjacent: ["node.x.b"], start: true },
  { id: "node.x.b", regionId: "region.x", name: "B", description: "a store", adjacent: ["node.x.a", "node.x.c"] },
  { id: "node.x.c", regionId: "region.x", name: "C", description: "a clinic", adjacent: ["node.x.b"] },
];
const opts = { seed: "route-seed", createdAt: "2026-07-05T00:00:00Z" };
const run = (): { state: GameState; graph: RegionGraph } => startRun(opts, REGIONS, NODES);

/** Force a punishing world: storm sky + broken roads, so route wear climbs. */
function harshWorld(s: GameState): GameState {
  const regions = Object.fromEntries(
    Object.entries(s.regions).map(([id, r]) => [id, { ...r, roads: 20 }]),
  ) as GameState["regions"];
  return { ...s, world: { ...s.world, weather: WEATHER_STORM }, regions };
}

describe("route keys + condition mapping (T29 · FR-MAP-04)", () => {
  it("routeKey is undirected", () => {
    expect(routeKey("a", "b")).toBe(routeKey("b", "a"));
  });
  it("wear maps to escalating conditions and costs", () => {
    expect(conditionOf(0)).toBe("clear");
    expect(conditionOf(30)).toBe("costly");
    expect(conditionOf(60)).toBe("flooded");
    expect(conditionOf(90)).toBe("blocked");
    expect(extraCostOf(0)).toBe(0);
    expect(extraCostOf(30)).toBe(1);
    expect(extraCostOf(60)).toBe(2);
    expect(isBlocked(ROUTE_BLOCKED_AT)).toBe(true);
  });
});

describe("routes seed clear and keep the M1 move (T29)", () => {
  it("every edge is a clear, free route at run start", () => {
    const { state } = run();
    expect(Object.keys(state.routes).length).toBeGreaterThan(0);
    for (const r of Object.values(state.routes)) expect(r.wear).toBe(0);
    expect(routeCondition(state, "node.x.a", "node.x.b")).toBe("clear");
  });
  it("a move over a clear route costs exactly MOVE_COST", () => {
    const { state, graph } = run();
    const mv = availableActions(state, graph).find((c) => c.id === "move:node.x.b")!;
    expect(mv.timeCost).toBe(MOVE_COST);
    const after = applyAction(state, mv.action, graph).state;
    expect(after.meta.hour).toBe(state.meta.hour + MOVE_COST);
  });
});

describe("routes worsen under weather/roads and recover (T29)", () => {
  it("targetWear is 0 in a clear world and high in a harsh one", () => {
    const { state } = run();
    expect(targetWear(state, "node.x.a", "node.x.b")).toBe(0);
    expect(targetWear(harshWorld(state), "node.x.a", "node.x.b")).toBeGreaterThan(0);
  });

  it("wear climbs toward the harsh target over time, then recedes when it clears", () => {
    const { state } = run();
    let s = harshWorld(state);
    for (let i = 0; i < 20; i++) s = tickRoutes(s, 6);
    const worn = routeWear(s, "node.x.a", "node.x.b");
    expect(worn).toBeGreaterThan(0);
    // clear the sky + restore roads; wear should recede
    const cleared0 = { ...s, world: { ...s.world, weather: WEATHER_CLEAR },
      regions: Object.fromEntries(Object.entries(s.regions).map(([id, r]) => [id, { ...r, roads: 100 }])) as GameState["regions"] };
    let cleared = cleared0;
    for (let i = 0; i < 5; i++) cleared = tickRoutes(cleared, 6);
    expect(routeWear(cleared, "node.x.a", "node.x.b")).toBeLessThan(worn);
  });

  it("rises faster than it recovers (hysteresis)", () => {
    const { state } = run();
    const risen = tickRoutes(harshWorld(state), 6);
    const gained = routeWear(risen, "node.x.a", "node.x.b");
    // put the risen route in a clear world and tick one step back down
    const clearWorld = { ...risen, world: { ...risen.world, weather: WEATHER_CLEAR },
      regions: Object.fromEntries(Object.entries(risen.regions).map(([id, r]) => [id, { ...r, roads: 100 }])) as GameState["regions"] };
    const recovered = tickRoutes(clearWorld, 6);
    const lost = gained - routeWear(recovered, "node.x.a", "node.x.b");
    expect(gained).toBeGreaterThan(lost);
  });

  it("is inert on a zero-hour tick and clamps 0–100 (property)", () => {
    const { state } = run();
    expect(tickRoutes(state, 0)).toBe(state);
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 240 }), (hours) => {
        let s = harshWorld(state);
        for (let i = 0; i < 6; i++) s = tickRoutes(s, hours);
        for (const r of Object.values(s.routes)) {
          expect(r.wear).toBeGreaterThanOrEqual(0);
          expect(r.wear).toBeLessThanOrEqual(100);
        }
      }),
    );
  });
});

describe("route conditions reach the offered moves (T29)", () => {
  it("a costly route raises the move's hours; a blocked route is not offered", () => {
    const { state, graph } = run();
    // hand-set the a—b route to costly, then flooded, then blocked and read the offered move
    const key = routeKey("node.x.a", "node.x.b");
    const withWear = (w: number): GameState => ({ ...state, routes: { ...state.routes, [key]: { wear: w } } });

    const costly = availableActions(withWear(30), graph).find((c) => c.id === "move:node.x.b");
    expect(costly?.timeCost).toBe(MOVE_COST + 1);

    const flooded = availableActions(withWear(60), graph).find((c) => c.id === "move:node.x.b");
    expect(flooded?.timeCost).toBe(MOVE_COST + 2);

    const blocked = availableActions(withWear(90), graph).some((c) => c.id === "move:node.x.b");
    expect(blocked).toBe(false);
    // search + rest are still offered, so the player is never stranded
    expect(availableActions(withWear(90), graph).some((c) => c.id === "search" || c.id === "rest")).toBe(true);
  });
});

describe("routes drift off-screen and round-trip (T29)", () => {
  it("advanceWorld carries route drift and stays save-lossless", () => {
    const { state, graph } = run();
    const advanced = advanceWorld(harshWorld(state), 48, graph);
    expect(loadGame(saveGame(advanced))).toStrictEqual(advanced);
  });
});
