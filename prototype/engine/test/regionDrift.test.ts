import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  advanceClock,
  advanceWorld,
  driftAnchor,
  driftRegion,
  driftRegions,
  dayRamp,
  equilibriumDensity,
  threatTarget,
  startRun,
  DAY_RAMP_PER_DAY,
  DAY_RAMP_CAP,
  DRIFT_JITTER,
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
  it("threat drifts across days with no player action at all — toward the authored point, once displaced", () => {
    // T78: a region already AT its authored point stays there (that is the anchor working), so the DoD
    // is proved on a displaced region: knock threat down and off-screen days bring it back up.
    const { state, graph } = run();
    const knocked: GameState = { ...state, regions: { "region.x": { ...state.regions["region.x"]!, threat: 5 } } };
    // advanceWorld submits NO action — pure off-screen time.
    let s = knocked;
    for (let day = 0; day < 3; day++) s = advanceWorld(s, 24, graph);
    expect(s.regions["region.x"]!.threat).toBeGreaterThan(5);
    expect(s.regions["region.x"]!.threat).toBeLessThanOrEqual(REGIONS[0]!.baseline!.threat! + DRIFT_JITTER);
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
    const equil = equilibriumDensity(s.regions["region.x"]!, driftAnchor(REGIONS[0]!.baseline, s.meta.day));
    expect(Math.abs(d - equil)).toBeLessThanOrEqual(4);
  });
});

describe("drift anchors on the authored baseline (T78 · closes the design review's III.2/III.3)", () => {
  const b = REGIONS[0]!.baseline!; // threat 30 / density 40 / activity 60
  const anchor = driftAnchor(b, 1);

  it("the authored point is the drift's fixed point: both targets equal the current dials there", () => {
    const r = region({ threat: b.threat!, zombieDensity: b.zombieDensity!, survivorActivity: b.survivorActivity! });
    expect(equilibriumDensity(r, anchor)).toBe(b.zombieDensity);
    expect(threatTarget(r, anchor)).toBe(b.threat);
    // …and the pre-T78 absolute targets were NOT (this is the bug): 20 + 18 − 24 = 14, and 40/2 = 20.
    expect(equilibriumDensity(r)).toBe(14);
    expect(threatTarget(r)).toBe(20);
    expect(driftRegion(r, 24, 0, anchor)).toBe(r); // nothing moves ⇒ same reference
  });

  it("the same coupling, measured from the anchor: threat above it breeds, activity above it culls, density above it raises threat", () => {
    expect(equilibriumDensity(region({ threat: b.threat! + 10, survivorActivity: b.survivorActivity! }), anchor)).toBe(b.zombieDensity! + 6);
    expect(equilibriumDensity(region({ threat: b.threat!, survivorActivity: b.survivorActivity! + 10 }), anchor)).toBe(b.zombieDensity! - 4);
    expect(threatTarget(region({ zombieDensity: b.zombieDensity! + 10 }), anchor)).toBe(b.threat! + 5);
    expect(threatTarget(region({ zombieDensity: b.zombieDensity!, fire: 40 }), anchor)).toBe(b.threat! + 20);
  });

  it("a displaced region converges back to its authored point off-screen (identity survives the simulation)", () => {
    const { state, graph } = run();
    for (const start of [{ threat: 90, zombieDensity: 95 }, { threat: 2, zombieDensity: 3 }]) {
      let s: GameState = { ...state, regions: { "region.x": { ...state.regions["region.x"]!, ...start } } };
      for (let i = 0; i < 30; i++) s = advanceWorld(s, 24, graph);
      const r = s.regions["region.x"]!;
      expect(Math.abs(r.threat - b.threat!)).toBeLessThanOrEqual(DRIFT_JITTER);
      expect(Math.abs(r.zombieDensity - b.zombieDensity!)).toBeLessThanOrEqual(DRIFT_JITTER + 1);
    }
  });

  it("without the graph (no baseline to anchor on) the pre-T78 absolute targets apply — declared, not inert", () => {
    const { state } = run();
    const s = advanceWorld(state, 24 * 10); // no graph
    const r = s.regions["region.x"]!;
    expect(r.threat).not.toBe(b.threat); // it drifted away from the authored point…
    expect(r.threat).toBeLessThan(b.threat!); // …downward, the old fixed point
    expect(driftRegions(state, 24)).not.toBe(state); // and the layer is not a no-op
  });

  it("a region the graph does not list falls back to the absolute targets while a listed one anchors", () => {
    const { state, graph } = run();
    const withStray: GameState = { ...state, regions: { ...state.regions, "region.stray": region({ threat: 30, zombieDensity: 40 }) } };
    const s = driftRegions(withStray, 24 * 5, graph);
    expect(s.regions["region.x"]!.threat).toBe(30); // anchored: stays put
    expect(s.regions["region.stray"]!.threat).toBeLessThan(30); // unanchored: sinks toward density/2
  });

  it("an unspecified baseline dial anchors at 0, exactly where the seed put it", () => {
    const a = driftAnchor({ threat: 50 }, 1);
    expect(a).toStrictEqual({ threat: 50, zombieDensity: 0, survivorActivity: 0 });
    expect(driftAnchor(undefined, 1)).toStrictEqual({ threat: 0, zombieDensity: 0, survivorActivity: 0 });
  });
});

describe("the day ramp — the city festers over weeks (T78)", () => {
  it("is 0 on day 1, DAY_RAMP_PER_DAY per day after, capped at DAY_RAMP_CAP — literals on purpose", () => {
    expect(DAY_RAMP_PER_DAY).toBe(1);
    expect(DAY_RAMP_CAP).toBe(30);
    expect(dayRamp(1)).toBe(0);
    expect(dayRamp(2)).toBe(1);
    expect(dayRamp(14)).toBe(13);
    expect(dayRamp(31)).toBe(30);
    expect(dayRamp(400)).toBe(30);
    expect(dayRamp(0)).toBe(0);
    expect(dayRamp(-5)).toBe(0);
    expect(dayRamp(2.9)).toBe(1);
  });

  it("lifts both anchors by the ramp, clamped to 100", () => {
    const b = REGIONS[0]!.baseline!;
    expect(driftAnchor(b, 14)).toStrictEqual({ threat: b.threat! + 13, zombieDensity: b.zombieDensity! + 13, survivorActivity: b.survivorActivity! });
    expect(driftAnchor({ threat: 90, zombieDensity: 95 }, 40)).toStrictEqual({ threat: 100, zombieDensity: 100, survivorActivity: 0 });
  });

  it("day 30 is not day 2: the same idle region reads higher threat and density as the clock advances", () => {
    // Against the pre-T78 tree the day was never read: idle(2) is mid-decay (20/26) and idle(30) has
    // sunk to the absolute fixed point (1/1), so `late` is LOWER than `early` and the assertion fails.
    const { state, graph } = run();
    const idle = (days: number): GameState => {
      let s = state;
      for (let d = 1; d <= days; d++) s = { ...advanceWorld(s, 24, graph), meta: advanceClock(s.meta, 24) };
      return s;
    };
    const early = idle(2).regions["region.x"]!;
    const late = idle(30).regions["region.x"]!;
    expect(late.threat).toBeGreaterThan(early.threat + 20);
    expect(late.zombieDensity).toBeGreaterThan(early.zombieDensity + 20);
    expect(late.threat).toBeLessThanOrEqual(100);
  });

  it("is total: a non-finite day (a `1e999` hand edit parses to Infinity) never yields a NaN anchor, and NaN never reaches a region dial", () => {
    // Against the unfixed code dayRamp(NaN) was NaN, the anchor was {NaN, NaN, 0}, and one drift tick
    // wrote NaN into `threat` and `zombieDensity` — saved as `null`, the save-losslessness hole.
    expect(dayRamp(Number.NaN)).toBe(0);
    expect(dayRamp(Number.POSITIVE_INFINITY)).toBe(DAY_RAMP_CAP);
    expect(dayRamp(Number.NEGATIVE_INFINITY)).toBe(0);
    expect(driftAnchor({ threat: 30, zombieDensity: 40 }, Number.NaN)).toStrictEqual({ threat: 30, zombieDensity: 40, survivorActivity: 0 });
    expect(driftAnchor({ threat: Number.NaN, zombieDensity: 40 }, 1)).toStrictEqual({ threat: 0, zombieDensity: 40, survivorActivity: 0 });
    expect(driftAnchor({ threat: 30, zombieDensity: 40 }, 1, Number.NaN)).toStrictEqual({ threat: 30, zombieDensity: 40, survivorActivity: 0 });
    const { state, graph } = run();
    const poisoned: GameState = { ...state, meta: { ...state.meta, day: Number.NaN } };
    const after = driftRegions(poisoned, 24, graph);
    expect(Number.isFinite(after.regions["region.x"]!.threat)).toBe(true);
    expect(Number.isFinite(after.regions["region.x"]!.zombieDensity)).toBe(true);
  });

  it("the ramp is read from meta.day, not from hours: an advance that does not move the clock does not ramp", () => {
    const { state, graph } = run();
    let s = state;
    for (let i = 0; i < 30; i++) s = advanceWorld(s, 24, graph); // meta untouched (advanceWorld's contract)
    expect(s.regions["region.x"]!.threat).toBeLessThanOrEqual(REGIONS[0]!.baseline!.threat! + DRIFT_JITTER);
  });
});
