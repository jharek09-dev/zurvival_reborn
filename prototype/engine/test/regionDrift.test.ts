import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  advanceWorld,
  driftRegion,
  driftRegions,
  equilibriumDensity,
  threatTarget,
  startRun,
  type GameState,
  type NodeDef,
  type RegionDef,
  type RegionState,
  type RegionGraph,
} from "../src/index.js";

/**
 * T24 — off-screen regional drift (FR-SIM-03). Threat and zombie density evolve on the region's own
 * clock, whether or not the player is present. Loot is not this task's job (the T17 contest owns it).
 */

const region = (o: Partial<RegionState>): RegionState => ({
  threat: 0, zombieDensity: 0, loot: 0, survivorActivity: 0, power: 0, water: 0, fire: 0, roads: 100, storyFlags: {},
  ...o,
});

const REGIONS: RegionDef[] = [
  { id: "region.x", name: "X", description: "x", baseline: { threat: 30, zombieDensity: 40, survivorActivity: 60, loot: 90 } },
];
const NODES: NodeDef[] = [
  { id: "node.x.a", regionId: "region.x", name: "A", description: "a", adjacent: ["node.x.b"], start: true },
  { id: "node.x.b", regionId: "region.x", name: "B", description: "b", adjacent: ["node.x.a"] },
];
const opts = { seed: "drift-seed", createdAt: "2026-07-05T00:00:00Z" };
const run = (): { state: GameState; graph: RegionGraph } => startRun(opts, REGIONS, NODES);

describe("equilibrium targets are a consequence of world state (T24)", () => {
  it("threat breeds density; survivor activity culls it", () => {
    const breeding = region({ threat: 90, survivorActivity: 0 });
    const culled = region({ threat: 90, survivorActivity: 90 });
    expect(equilibriumDensity(breeding)).toBeGreaterThan(equilibriumDensity(culled));
  });

  it("threat tracks density and active fire", () => {
    expect(threatTarget(region({ zombieDensity: 80 }))).toBeGreaterThan(threatTarget(region({ zombieDensity: 10 })));
    expect(threatTarget(region({ zombieDensity: 40, fire: 60 }))).toBeGreaterThan(threatTarget(region({ zombieDensity: 40 })));
  });
});

describe("driftRegion relaxes toward equilibrium, bounded (T24)", () => {
  it("density falls toward equilibrium when over capacity", () => {
    const r = region({ threat: 30, zombieDensity: 90, survivorActivity: 60 });
    const after = driftRegion(r, 24, 0);
    expect(after.zombieDensity).toBeLessThan(r.zombieDensity);
    expect(after.zombieDensity).toBeGreaterThanOrEqual(equilibriumDensity(r));
  });

  it("density rises toward equilibrium when under capacity", () => {
    const r = region({ threat: 80, zombieDensity: 5, survivorActivity: 0 });
    const after = driftRegion(r, 24, 0);
    expect(after.zombieDensity).toBeGreaterThan(r.zombieDensity);
  });

  it("a zero-hour drift is inert (same reference)", () => {
    const r = region({ threat: 30, zombieDensity: 40 });
    expect(driftRegion(r, 0, 1)).toBe(r);
  });

  it("never leaves 0–100 for any state, hours, or jitter (property)", () => {
    fc.assert(
      fc.property(
        fc.record({
          threat: fc.integer({ min: 0, max: 100 }),
          zombieDensity: fc.integer({ min: 0, max: 100 }),
          survivorActivity: fc.integer({ min: 0, max: 100 }),
          fire: fc.integer({ min: 0, max: 100 }),
        }),
        fc.integer({ min: 0, max: 500 }),
        fc.integer({ min: -2, max: 2 }),
        (fields, hours, jitter) => {
          const after = driftRegion(region(fields), hours, jitter);
          for (const v of [after.threat, after.zombieDensity]) {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(100);
            expect(Number.isInteger(v)).toBe(true);
          }
        },
      ),
    );
  });
});

describe("a region measurably changes with the player absent — the DoD (T24 · FR-SIM-03)", () => {
  it("threat drifts across days with no player action at all", () => {
    const { state, graph } = run();
    const before = state.regions["region.x"]!.threat;
    // advanceWorld submits NO action — pure off-screen time.
    let s = state;
    for (let day = 0; day < 3; day++) s = advanceWorld(s, 24, graph);
    expect(s.regions["region.x"]!.threat).not.toBe(before);
  });

  it("drift is deterministic and consumes the region RNG stream reproducibly", () => {
    const a = run();
    const b = run();
    expect(JSON.stringify(advanceWorld(a.state, 72, a.graph))).toBe(
      JSON.stringify(advanceWorld(b.state, 72, b.graph)),
    );
    const once = driftRegions(a.state, 12);
    expect(once.rng).not.toStrictEqual(a.state.rng); // a draw was consumed
  });

  it("hovers near equilibrium once converged (jitter keeps it alive, bounded)", () => {
    const { state, graph } = run();
    let s = state;
    for (let i = 0; i < 40; i++) s = advanceWorld(s, 12, graph);
    const d = s.regions["region.x"]!.zombieDensity;
    const equil = equilibriumDensity(s.regions["region.x"]!);
    expect(Math.abs(d - equil)).toBeLessThanOrEqual(4);
  });
});
