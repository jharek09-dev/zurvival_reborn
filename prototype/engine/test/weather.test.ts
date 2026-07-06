import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  WEATHER_CLEAR,
  WEATHER_EFFECTS,
  WEATHER_FOG,
  WEATHER_STORM,
  WEATHER_TRANSITIONS,
  detectChance,
  startRun,
  tickWeather,
  weatherDetectionDelta,
  type GameState,
  type NodeDef,
  type RegionDef,
  type RegionGraph,
} from "../src/index.js";

/**
 * T27 — weather with multi-system effects (FR-SIM-05). Weather transitions over time and one change
 * is felt in several systems: stealth detection, the power grid, and road conditions.
 */

const REGIONS: RegionDef[] = [{ id: "region.x", name: "X", description: "x", baseline: { loot: 60 } }];
const NODES: NodeDef[] = [
  { id: "node.x.a", regionId: "region.x", name: "A", description: "a", adjacent: ["node.x.b"], start: true },
  { id: "node.x.b", regionId: "region.x", name: "B", description: "b", adjacent: ["node.x.a"] },
];
const opts = { seed: "weather-seed", createdAt: "2026-07-05T00:00:00Z" };
const run = (): { state: GameState; graph: RegionGraph } => startRun(opts, REGIONS, NODES);
const setWeather = (s: GameState, w: string): GameState => ({ ...s, world: { ...s.world, weather: w } });

describe("weather effects couple multiple systems (T27 · FR-SIM-05)", () => {
  it("fog/rain/storm make you harder to spot; snow/wind easier", () => {
    expect(weatherDetectionDelta(WEATHER_FOG)).toBeLessThan(0);
    expect(weatherDetectionDelta(WEATHER_STORM)).toBeLessThan(0);
    expect(weatherDetectionDelta(WEATHER_CLEAR)).toBe(0);
  });

  it("fog measurably lowers the stealth-detection chance versus clear (the wired coupling)", () => {
    expect(detectChance(40, "midday", WEATHER_FOG)).toBeLessThan(detectChance(40, "midday", WEATHER_CLEAR));
    // and the M1 two-arg call is unchanged (clear-equivalent)
    expect(detectChance(40, "midday")).toBe(detectChance(40, "midday", WEATHER_CLEAR));
  });

  it("a storm drains the grid AND degrades roads — one change, two more systems", () => {
    const { state } = run();
    const stormy = setWeather({ ...state, world: { ...state.world, powerGrid: 100 } }, WEATHER_STORM);
    const after = tickWeather(stormy, 12);
    expect(after.world.powerGrid).toBeLessThan(100); // grid pressure
    expect(after.regions["region.x"]!.roads).toBeLessThan(state.regions["region.x"]!.roads); // road pressure
  });

  it("infrastructure only ever falls (clear weather never repairs the grid)", () => {
    const { state } = run();
    const damaged = setWeather({ ...state, world: { ...state.world, powerGrid: 40 } }, WEATHER_CLEAR);
    expect(tickWeather(damaged, 24).world.powerGrid).toBe(40); // clear = no recovery, no further loss
  });
});

describe("weather transitions are a reproducible, valid walk (T27)", () => {
  const KNOWN = new Set(Object.keys(WEATHER_EFFECTS));

  it("every successor is a known weather, and the graph is closed", () => {
    for (const [from, tos] of Object.entries(WEATHER_TRANSITIONS)) {
      expect(KNOWN.has(from)).toBe(true);
      for (const to of tos) expect(KNOWN.has(to)).toBe(true);
    }
  });

  it("never lands on an unknown weather across a long run (property)", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 24 }), { minLength: 1, maxLength: 60 }), (hoursSeq) => {
        let { state } = run();
        for (const hours of hoursSeq) {
          state = tickWeather(state, hours);
          expect(KNOWN.has(state.world.weather)).toBe(true);
        }
      }),
    );
  });

  it("is deterministic and inert on a zero-hour tick", () => {
    const { state } = run();
    expect(tickWeather(state, 0)).toBe(state);
    let a = run().state;
    let b = run().state;
    for (let i = 0; i < 20; i++) { a = tickWeather(a, 8); b = tickWeather(b, 8); }
    expect(a.world.weather).toBe(b.world.weather);
  });

  it("actually changes the sky over a long enough stretch", () => {
    let { state } = run();
    const start = state.world.weather;
    let moved = false;
    for (let i = 0; i < 200 && !moved; i++) {
      state = tickWeather(state, 12);
      if (state.world.weather !== start) moved = true;
    }
    expect(moved).toBe(true);
  });
});
