import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  applyAction,
  availableActions,
  detectChance,
  startRun,
  tickTimeOfDay,
  phaseConcealment,
  phaseSearchNoise,
  phaseThreatTarget,
  PHASE_THREAT_TARGET,
  type GameState,
  type Phase,
  type RegionGraph,
  type NodeDef,
  type RegionDef,
} from "../src/index.js";

const REGIONS: RegionDef[] = [
  { id: "region.x", name: "X", description: "x", baseline: { loot: 60, zombieDensity: 30, threat: 20 } },
];
const NODES: NodeDef[] = [
  { id: "node.x.a", regionId: "region.x", name: "A", description: "a plaza", adjacent: ["node.x.b"], start: true },
  { id: "node.x.b", regionId: "region.x", name: "B", description: "a store", adjacent: ["node.x.a"] },
];
const opts = { seed: "tod-seed", createdAt: "2026-07-05T00:00:00Z" };
const run = (): { state: GameState; graph: RegionGraph } => startRun(opts, REGIONS, NODES);
const at = (s: GameState, phase: Phase): GameState => ({ ...s, meta: { ...s.meta, phase } });
const ALL: readonly Phase[] = ["dawn", "morning", "midday", "evening", "night"];

describe("phase danger vectors (T28 · FR-SIM-04)", () => {
  it("night conceals a stealth mover most; midday least", () => {
    expect(phaseConcealment("night")).toBeGreaterThan(phaseConcealment("midday"));
    expect(phaseConcealment("night")).toBeGreaterThanOrEqual(phaseConcealment("evening"));
    expect(phaseConcealment("midday")).toBe(0);
  });

  it("keeps detectChance's phase behaviour: a night slip is harder to spot than midday", () => {
    // T28 is a behaviour-preserving refactor of the T15 phase term.
    expect(detectChance(50, "night")).toBeLessThan(detectChance(50, "midday"));
  });

  it("night rummaging is louder than daytime", () => {
    expect(phaseSearchNoise("night")).toBeGreaterThan(phaseSearchNoise("midday"));
    expect(phaseSearchNoise("midday")).toBe(0);
  });

  it("the threat tide targets higher danger after dark than at midday", () => {
    expect(phaseThreatTarget("night")).toBeGreaterThan(phaseThreatTarget("midday"));
    expect(Math.max(...ALL.map(phaseThreatTarget))).toBe(PHASE_THREAT_TARGET.night);
  });
});

describe("the timeOfDay tide (T28)", () => {
  it("pulls globalThreat up at night and down at midday, bounded 0–100", () => {
    const { state } = run();
    const night = at({ ...state, world: { ...state.world, globalThreat: 10 } }, "night");
    const up = tickTimeOfDay(night, 12);
    expect(up.world.globalThreat).toBeGreaterThan(10);
    expect(up.world.globalThreat).toBeLessThanOrEqual(100);

    const midday = at({ ...state, world: { ...state.world, globalThreat: 80 } }, "midday");
    const down = tickTimeOfDay(midday, 12);
    expect(down.world.globalThreat).toBeLessThan(80);
    expect(down.world.globalThreat).toBeGreaterThanOrEqual(0);
  });

  it("is inert on a zero-hour tick and when already at target", () => {
    const { state } = run();
    expect(tickTimeOfDay(state, 0)).toBe(state);
    const atTarget = at({ ...state, world: { ...state.world, globalThreat: phaseThreatTarget("night") } }, "night");
    expect(tickTimeOfDay(atTarget, 24)).toBe(atTarget);
  });

  it("moves only the world slice", () => {
    const { state } = run();
    const after = tickTimeOfDay(at(state, "night"), 9);
    expect(after.world.globalThreat).not.toBe(state.world.globalThreat);
    expect(after.regions).toBe(state.regions);
    expect(after.nodes).toBe(state.nodes);
    expect(after.player).toBe(state.player);
  });

  it("never leaves 0–100 for any phase and any hours (property)", () => {
    const { state } = run();
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL),
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 240 }),
        (phase, gt, hours) => {
          const s = at({ ...state, world: { ...state.world, globalThreat: gt } }, phase);
          const g = tickTimeOfDay(s, hours).world.globalThreat;
          expect(g).toBeGreaterThanOrEqual(0);
          expect(g).toBeLessThanOrEqual(100);
        },
      ),
    );
  });
});

describe("harder searches at night reach the search action (T28)", () => {
  it("a night search carries a louder noise override than a daytime search", () => {
    const { state, graph } = run();
    const dayA = availableActions(at(state, "midday"), graph).find((c) => c.id === "search")!;
    const nightA = availableActions(at(state, "night"), graph).find((c) => c.id === "search")!;
    const dayNoise = (dayA.action.params?.["noise"] as number | undefined) ?? 25; // T14 default NOISE_SEARCH
    const nightNoise = nightA.action.params?.["noise"] as number;
    expect(nightNoise).toBeGreaterThan(dayNoise);
  });

  it("night raises the searched node's deposited noise vs midday over a real turn", () => {
    const { state, graph } = run();
    const searchAt = (phase: Phase): number => {
      const s = at(state, phase);
      const choice = availableActions(s, graph).find((c) => c.id === "search")!;
      const after = applyAction(s, choice.action, graph).state;
      return after.nodes[s.player.location]!.noise;
    };
    expect(searchAt("night")).toBeGreaterThan(searchAt("midday"));
  });
});
