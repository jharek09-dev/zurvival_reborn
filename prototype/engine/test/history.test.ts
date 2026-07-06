import { describe, expect, it } from "vitest";
import {
  applyAction,
  advanceWorld,
  availableActions,
  loadGame,
  saveGame,
  startRun,
  recordHistory,
  appendHistory,
  routeKey,
  WEATHER_STORM,
  type GameState,
  type HistoryEvent,
  type RegionGraph,
  type NodeDef,
  type RegionDef,
} from "../src/index.js";

const REGIONS: RegionDef[] = [{ id: "region.x", name: "X", description: "x", baseline: { loot: 60 } }];
const NODES: NodeDef[] = [
  { id: "node.x.a", regionId: "region.x", name: "A", description: "a", adjacent: ["node.x.b"], start: true },
  { id: "node.x.b", regionId: "region.x", name: "B", description: "b", adjacent: ["node.x.a", "node.x.c"] },
  { id: "node.x.c", regionId: "region.x", name: "C", description: "c", adjacent: ["node.x.b"] },
];
const opts = { seed: "hist-seed", createdAt: "2026-07-05T00:00:00Z" };
const run = (): { state: GameState; graph: RegionGraph } => startRun(opts, REGIONS, NODES);
const types = (evs: readonly HistoryEvent[]): string[] => evs.map((e) => e.type);

describe("recordHistory diffs notable events (T31 · FR-SIM-11)", () => {
  it("logs a weather change", () => {
    const { state } = run();
    const after = { ...state, world: { ...state.world, weather: WEATHER_STORM } };
    expect(types(recordHistory(state, after))).toContain("weather.change");
  });

  it("logs nightfall on the phase crossing into night", () => {
    const { state } = run();
    const evening = { ...state, meta: { ...state.meta, phase: "evening" as const } };
    const night = { ...state, meta: { ...state.meta, phase: "night" as const } };
    expect(types(recordHistory(evening, night))).toContain("nightfall");
    // no false positive when already night
    expect(types(recordHistory(night, night))).not.toContain("nightfall");
  });

  it("logs a horde stepping to a new node", () => {
    const { state } = run();
    const horde = { id: "horde.1", size: 30, pos: "node.x.a", dest: "node.x.c" as string | null, speed: 1, awareness: 50, types: [] };
    const before = { ...state, hordes: [horde] };
    const after = { ...state, hordes: [{ ...horde, pos: "node.x.b" }] };
    const evs = recordHistory(before, after);
    expect(types(evs)).toContain("horde.move");
    expect(evs.find((e) => e.type === "horde.move")!.subjects).toContain("horde.1");
  });

  it("logs a route crossing a condition boundary", () => {
    const { state } = run();
    const key = routeKey("node.x.a", "node.x.b");
    const before = { ...state, routes: { ...state.routes, [key]: { wear: 0 } } };
    const after = { ...state, routes: { ...state.routes, [key]: { wear: 60 } } };
    const evs = recordHistory(before, after);
    expect(types(evs)).toContain("route.change");
    expect(evs.find((e) => e.type === "route.change")!.data).toMatchObject({ from: "clear", to: "flooded" });
  });

  it("logs a cleared fight", () => {
    const { state } = run();
    const before = { ...state, combat: { node: "node.x.a", enemy: "enemy.walker", hp: 1, maxHp: 3, alerted: true } };
    const after = { ...state, combat: null };
    expect(types(recordHistory(before, after))).toContain("combat.cleared");
  });

  it("writes nothing for a quiet turn", () => {
    const { state } = run();
    expect(recordHistory(state, state)).toEqual([]);
  });
});

describe("the log is append-only (T31)", () => {
  it("appendHistory adds in order and never rewrites the past", () => {
    const { state } = run();
    const e1: HistoryEvent = { day: 1, hour: 6, turn: 1, type: "a", subjects: [], data: {} };
    const e2: HistoryEvent = { day: 1, hour: 8, turn: 2, type: "b", subjects: [], data: {} };
    const s1 = appendHistory(state, [e1]);
    const s2 = appendHistory(s1, [e2]);
    expect(s2.history).toEqual([e1, e2]);
    expect(s1.history[0]).toBe(e1); // the earlier entry object is untouched
    expect(appendHistory(state, [])).toBe(state);
  });

  it("history only ever grows across a real run, and round-trips", () => {
    const { state, graph } = run();
    let s = state;
    let len = s.history.length;
    for (let i = 0; i < 40; i++) {
      const choices = availableActions(s, graph);
      const pick = choices.find((c) => c.id.startsWith("move:")) ?? choices.find((c) => c.id === "search") ?? choices[0];
      if (!pick) break;
      s = applyAction(s, pick.action, graph).state;
      expect(s.history.length).toBeGreaterThanOrEqual(len); // append-only: never shrinks
      len = s.history.length;
    }
    expect(loadGame(saveGame(s))).toStrictEqual(s);
  });
});

describe("off-screen fast-forwards leave a trace (T31)", () => {
  it("advanceWorld under a storm records route/weather history off-screen", () => {
    const { state, graph } = run();
    const harsh = { ...state, world: { ...state.world, weather: WEATHER_STORM },
      regions: Object.fromEntries(Object.entries(state.regions).map(([id, r]) => [id, { ...r, roads: 20 }])) as GameState["regions"] };
    const after = advanceWorld(harsh, 72, graph);
    expect(after.history.length).toBeGreaterThan(state.history.length);
    // deterministic + save-lossless with history in tow
    expect(loadGame(saveGame(after))).toStrictEqual(after);
    expect(JSON.stringify(advanceWorld(harsh, 72, graph))).toBe(JSON.stringify(after));
  });
});
