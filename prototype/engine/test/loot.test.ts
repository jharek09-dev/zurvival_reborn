import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  applyAction,
  availableActions,
  contestRegion,
  loadGame,
  lootTableFor,
  resolveSearchLoot,
  saveGame,
  searchYieldCap,
  startRun,
  updateRegionContest,
  type GameState,
  type NodeDef,
  type RegionGraph,
  type RegionDef,
} from "../src/index.js";

/**
 * T17 — finite, contested, depleting loot economy (FR-ECO-01/02/03). Loot is a stock that only ever
 * goes down: searching debits the region, rivals thin it over time, and a run can never pull more
 * than the region held.
 */

const REGIONS: RegionDef[] = [
  { id: "region.x", name: "X", description: "x", baseline: { loot: 80, survivorActivity: 40 } },
];
const NODES: NodeDef[] = [
  { id: "node.x.a", regionId: "region.x", name: "A", description: "a store", adjacent: ["node.x.b"], start: true, kind: "store" },
  { id: "node.x.b", regionId: "region.x", name: "B", description: "a clinic", adjacent: ["node.x.a"], kind: "medical" },
];
const opts = { seed: "loot-seed", createdAt: "2026-07-05T00:00:00Z" };
const run = (): { state: GameState; graph: RegionGraph } => startRun(opts, REGIONS, NODES);
function take(state: GameState, graph: RegionGraph, id: string): GameState {
  const c = availableActions(state, graph).find((x) => x.id === id);
  if (!c) throw new Error(`no choice ${id}`);
  return applyAction(state, c.action, graph).state;
}
const itemCount = (s: GameState): number => s.player.inventory.reduce((n, e) => n + e.quantity, 0);

// --- plausibility table (FR-ECO-02) ---------------------------------------------------------

describe("loot tables by location kind (T17 · FR-ECO-02)", () => {
  it("routes a node kind to a plausible pool and falls back to generic", () => {
    expect(lootTableFor("medical")).toContain("item.bandage");
    expect(lootTableFor("police")).toContain("item.ammo");
    expect(lootTableFor("store")).toContain("item.canned-food");
    expect(lootTableFor(undefined)).toEqual(lootTableFor("generic"));
    expect(lootTableFor("nonsense")).toEqual(lootTableFor("generic"));
  });
});

// --- yield is partial and diminishing (FR-ECO-03) -------------------------------------------

describe("search yield is partial and diminishing (T17 · FR-ECO-03)", () => {
  it("caps fall as the region thins and as a node is picked over", () => {
    expect(searchYieldCap(80, 0)).toBeGreaterThan(searchYieldCap(20, 0)); // thinner region ⇒ less
    expect(searchYieldCap(80, 0)).toBeGreaterThan(searchYieldCap(80, 68)); // picked-over ⇒ less
    expect(searchYieldCap(0, 0)).toBe(0); // nothing left
    expect(searchYieldCap(80, 0)).toBeLessThanOrEqual(80); // never more than remains
  });
});

// --- searching takes from the world, and the world runs out (FR-ECO-01) ---------------------

describe("searching depletes a finite region (T17 · FR-ECO-01)", () => {
  it("a search debits region loot and drops a plausible item into the pack", () => {
    const { state, graph } = run();
    const start = state.regions["region.x"]!.loot;
    const after = take(state, graph, "search");
    expect(after.regions["region.x"]!.loot).toBeLessThan(start); // took from the world
    expect(itemCount(after)).toBeGreaterThan(itemCount(state)); // put it in the pack
    for (const e of after.player.inventory) expect(lootTableFor("store")).toContain(e.type); // plausible
  });

  it("a depleted region yields items no more (only time and noise)", () => {
    const { state } = run();
    const dry: GameState = { ...state, regions: { "region.x": { ...state.regions["region.x"]!, loot: 0 } } };
    const after = resolveSearchLoot(dry, "node.x.a", "store");
    expect(after).toBe(dry); // unchanged ref: nothing to take
  });

  it("over a whole run, region loot only ever falls and never goes negative", () => {
    let { state, graph } = run();
    let last = state.regions["region.x"]!.loot;
    const script = ["search", "search", "search", "move:node.x.b", "search", "search", "rest", "search"];
    for (const id of script) {
      const c = availableActions(state, graph).find((x) => x.id === id);
      if (!c) continue;
      state = applyAction(state, c.action, graph).state;
      const loot = state.regions["region.x"]!.loot;
      expect(loot).toBeLessThanOrEqual(last); // monotonic down
      expect(loot).toBeGreaterThanOrEqual(0);
      last = loot;
    }
  });
});

// --- the world contests the stock over time (FR-ECO-01) -------------------------------------

describe("rivals contest the stock (T17 · FR-ECO-01)", () => {
  it("a region loses loot to rivals as time passes, even with no searching", () => {
    const { state, graph } = run();
    let s = state;
    const start = s.regions["region.x"]!.loot;
    for (let i = 0; i < 4; i++) s = take(s, graph, "rest"); // rest only — never search
    expect(s.regions["region.x"]!.loot).toBeLessThan(start); // rivals drew it down
    expect(itemCount(s)).toBe(itemCount(state)); // and the player took nothing (kit unchanged)
  });

  it("contestRegion / updateRegionContest are inert at zero hours and clamp at zero", () => {
    const region = { threat: 0, zombieDensity: 0, loot: 1, survivorActivity: 100, power: 0, water: 0, fire: 0, roads: 100, storyFlags: {} };
    expect(contestRegion(region, 0)).toBe(region);
    expect(contestRegion({ ...region, loot: 0 }, 10).loot).toBe(0);
    const { state } = run();
    expect(updateRegionContest(state, 0)).toBe(state);
  });
});

// --- determinism + save round-trip ----------------------------------------------------------

describe("loot is deterministic and save-lossless (T17)", () => {
  it("the same seed loots identically", () => {
    const a = take(run().state, run().graph, "search");
    const b = take(run().state, run().graph, "search");
    expect(a).toStrictEqual(b);
  });

  it("inventory + region loot survive save/load", () => {
    let { state, graph } = run();
    state = take(take(state, graph, "search"), graph, "search");
    expect(loadGame(saveGame(state))).toStrictEqual(state);
  });

  it("property: no run pulls more loot from a region than it started with", () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom("search", "rest", "move:node.x.b", "move:node.x.a"), { maxLength: 30 }), (script) => {
        let { state, graph } = run();
        const startLoot = state.regions["region.x"]!.loot;
        for (const id of script) {
          const c = availableActions(state, graph).find((x) => x.id === id);
          if (!c) continue;
          state = applyAction(state, c.action, graph).state;
        }
        // region loot never rose above the start; the world is finite.
        expect(state.regions["region.x"]!.loot).toBeLessThanOrEqual(startLoot);
      }),
    );
  });
});
