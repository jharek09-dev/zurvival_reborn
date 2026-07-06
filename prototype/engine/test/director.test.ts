import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  advanceWorld,
  startRun,
  tickDirector,
  directorBeat,
  directorEnabled,
  playerDistressed,
  pressureRead,
  DIRECTOR_HIGH_BAND,
  type GameState,
  type RegionGraph,
  type NodeDef,
  type RegionDef,
} from "../src/index.js";

const REGIONS: RegionDef[] = [
  { id: "region.x", name: "X", description: "x", baseline: { zombieDensity: 20, threat: 10, survivorActivity: 0, loot: 60 } },
];
const NODES: NodeDef[] = [
  { id: "node.x.a", regionId: "region.x", name: "A", description: "a", adjacent: ["node.x.b"], start: true },
  { id: "node.x.b", regionId: "region.x", name: "B", description: "b", adjacent: ["node.x.a"] },
];
const opts = { seed: "director-seed", createdAt: "2026-07-05T00:00:00Z" };
const run = (): { state: GameState; graph: RegionGraph } => startRun(opts, REGIONS, NODES);

const disable = (s: GameState): GameState => ({ ...s, world: { ...s.world, flags: { ...s.world.flags, "director.disabled": true } } });
const withThreat = (s: GameState, globalThreat: number): GameState => ({ ...s, world: { ...s.world, globalThreat } });
const density = (s: GameState): number => s.regions["region.x"]!.zombieDensity;

describe("director beat from pressure + distress (T30 · FR-SIM-10)", () => {
  it("escalates a calm, undistressed run", () => {
    const { state } = run();
    expect(pressureRead(state)).toBeLessThan(25);
    expect(playerDistressed(state)).toBe(false);
    expect(directorBeat(state)).toBe("escalate");
  });

  it("gives relief when pressure is high", () => {
    const { state } = run();
    const hot = withThreat({ ...state, regions: { "region.x": { ...state.regions["region.x"]!, threat: 90 } } }, 90);
    expect(pressureRead(hot)).toBeGreaterThanOrEqual(DIRECTOR_HIGH_BAND);
    expect(directorBeat(hot)).toBe("relief");
  });

  it("gives relief when the player is distressed even if pressure is low", () => {
    const { state } = run();
    const hurt: GameState = {
      ...state,
      player: { ...state.player, condition: { ...state.player.condition,
        wounds: [{ type: "wound.bite", site: "arm", severity: 40, treated: 10, inflictedDay: 1 }] } },
    };
    expect(playerDistressed(hurt)).toBe(true);
    expect(directorBeat(hurt)).toBe("relief");
  });

  it("holds — and never touches state — when disabled", () => {
    const { state } = run();
    const off = disable(state);
    expect(directorEnabled(off)).toBe(false);
    expect(directorBeat(off)).toBe("hold");
    expect(tickDirector(off, 6)).toBe(off);
  });
});

describe("director nudges are bounded and region-only (T30)", () => {
  it("escalate raises the current region's density + threat by one, clamped", () => {
    const { state } = run();
    const after = tickDirector(state, 6);
    expect(after.regions["region.x"]!.zombieDensity).toBe(density(state) + 1);
    expect(after.regions["region.x"]!.threat).toBe(state.regions["region.x"]!.threat + 1);
    // nothing but regions moved
    expect(after.player).toBe(state.player);
    expect(after.nodes).toBe(state.nodes);
    expect(after.world).toBe(state.world);
    expect(after.hordes).toBe(state.hordes);
  });

  it("is inert on a zero-hour tick", () => {
    const { state } = run();
    expect(tickDirector(state, 0)).toBe(state);
  });

  it("never produces an out-of-bounds dial, any pressure/hours (property — the DoD)", () => {
    const { state } = run();
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 48 }), (gt, dens, hours) => {
        const s = withThreat({ ...state, regions: { "region.x": { ...state.regions["region.x"]!, zombieDensity: dens } } }, gt);
        const out = tickDirector(s, hours).regions["region.x"]!;
        expect(out.zombieDensity).toBeGreaterThanOrEqual(0);
        expect(out.zombieDensity).toBeLessThanOrEqual(100);
        expect(out.threat).toBeGreaterThanOrEqual(0);
        expect(out.threat).toBeLessThanOrEqual(100);
      }),
    );
  });
});

describe("the director counters off-screen de-escalation (T30 · addresses PL-M2-03)", () => {
  it("an idle district stays denser with the director on than off, and both stay legal", () => {
    // fix the phase to midday (calm tide) so escalation is the dominant signal, then idle for days
    const { state, graph } = run();
    const base = { ...state, meta: { ...state.meta, phase: "midday" as const }, world: { ...state.world, globalThreat: 10 } };
    const on = advanceWorld(base, 24 * 8, graph);        // 8 idle days, director on
    const off = advanceWorld(disable(base), 24 * 8, graph); // 8 idle days, director off
    expect(density(on)).toBeGreaterThan(density(off)); // the world festers when unwatched
    for (const s of [on, off]) {
      expect(density(s)).toBeGreaterThanOrEqual(0);
      expect(density(s)).toBeLessThanOrEqual(100);
    }
  });
});
